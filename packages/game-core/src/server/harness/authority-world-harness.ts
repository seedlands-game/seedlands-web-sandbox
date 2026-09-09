import type { WorldModuleBinding } from '../commands/module-command';
import type { ServerCommand } from '../commands/command-contract';
import type { AuthorityRuntime } from '../authority/authority-runtime';
import type { CorePlatformPorts } from '../../runtime/platform-ports';
import { chunkKey } from '../../world/voxel';
import type { FrozenGameSaveSnapshot } from '../persistence/game-save-snapshot';
import {
  WORLD_HARNESS_MAX_ADVANCE_MS,
  WORLD_HARNESS_PROTOCOL_VERSION,
  type WorldActionQuery,
  type WorldBarrierRequest,
  type WorldCheckpointRequest,
  type WorldClockRequest,
  type WorldCommandOptions,
  type WorldFrontier,
  type WorldHarnessError,
  type WorldHarnessPort,
  type WorldHarnessResult,
  type WorldIdentity,
  type WorldInspectRequest,
  type WorldLogicRequest,
  type WorldPrepareRequest,
  type WorldTraceRequest,
} from './world-harness-contract';
import {
  WorldResourceAuthorizer,
  commandAuthorizationRequests,
  type WorldAuthorizationRequest,
  type WorldPrincipal,
} from './world-authorization';
import { integerTuple, validateWorldLogicRequest } from './world-harness-validation';
import { WorldBarrierRuntime } from './world-barrier-runtime';
import { WorldCheckpointRuntime, WorldOperationFailure, WorldTraceRuntime } from './world-harness-state';
import {
  authorizationRequest,
  commandSourceForPrincipal,
  inspectAuthorizationRequest,
} from './world-harness-operations';
import { worldHarnessError } from './world-harness-errors';

export { validatePortableCheckpoint } from './world-harness-validation';
export { chunkForVoxel } from './world-harness-operations';
export type AuthorityWorldOwner = Readonly<{
  runtime: AuthorityRuntime;
  epoch: string;
  worldId: string;
}>;

export type AuthorityWorldHarnessOptions = Readonly<{
  platform: CorePlatformPorts;
  principalId: string;
  authorization: WorldResourceAuthorizer;
  owner: () => AuthorityWorldOwner;
  prepareChunk: (chunk: readonly [number, number, number]) => Promise<void>;
  advance: (elapsedMs: number) => Promise<ReturnType<AuthorityRuntime['advancePausedSession']>>;
  restore: (snapshot: FrozenGameSaveSnapshot) => Promise<void>;
  complete?: <Result>(operation: Promise<Result>) => Promise<Result>;
  clockNow?: () => number;
  moduleCommandBinding?: (command: ServerCommand) => WorldModuleBinding;
}>;

type Operation = Readonly<{
  name: string;
  authorization: WorldAuthorizationRequest | readonly WorldAuthorizationRequest[];
}>;

const error = (code: string, message: string, kind: WorldHarnessError['kind']): WorldHarnessError => ({
  code,
  message,
  kind,
});

export class AuthorityWorldHarness implements WorldHarnessPort {
  private readonly traces = new WorldTraceRuntime();
  private commandSequence = 0;
  private logicModeValue: 'automatic' | 'scripted' = 'automatic';
  private readonly checkpoints: WorldCheckpointRuntime;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly barriers: WorldBarrierRuntime;

  constructor(private readonly options: AuthorityWorldHarnessOptions) {
    this.checkpoints = new WorldCheckpointRuntime({
      runtime: () => options.owner().runtime,
      clone: options.platform.clone,
      restore: options.restore,
    });
    this.barriers = new WorldBarrierRuntime({
      timers: options.platform.timers,
      frontier: () => this.frontier(),
      checkpointCommitSequence: () => this.checkpoints.lastAcknowledgedCommitSequence,
      settled: (frontier) => {
        const runtime = this.options.owner().runtime;
        const diagnostics = runtime.settlementDiagnostics;
        return (
          diagnostics.fluidSettledWorkCount >= frontier.fluidWorkSequence &&
          !runtime.hasPendingLogicObservationThrough(frontier.logicObservationSequence)
        );
      },
    });
  }

  get logicMode(): 'automatic' | 'scripted' {
    return this.logicModeValue;
  }

  acceptsAutomaticLogic(): boolean {
    return this.logicModeValue === 'automatic';
  }

  identity() {
    return this.run(
      { name: 'identity', authorization: authorizationRequest('world.identity', 'read') },
      async (): Promise<WorldIdentity> => {
        const owner = this.options.owner();
        return {
          protocolVersion: WORLD_HARNESS_PROTOCOL_VERSION,
          worldId: owner.worldId,
          epoch: owner.epoch,
          seed: owner.runtime.server.seed,
          seedText: owner.runtime.server.options.seedText,
          generatorVersion: owner.runtime.server.generatorVersion,
          playerId: owner.runtime.playerId,
          runtime: 'authority',
          supported: { player: true, scriptedLogic: true, existingNpcSimulation: true },
        };
      },
    );
  }

  inspect(request: WorldInspectRequest) {
    return this.run(
      () => ({ name: `inspect:${request.kind}`, authorization: inspectAuthorizationRequest(request) }),
      async () => {
        const server = this.options.owner().runtime.server;
        if (request.kind === 'entity') {
          const entity = server.getEntity(request.entityId);
          if (!entity)
            throw new WorldOperationFailure('WORLD_ENTITY_UNAVAILABLE', 'Entity is unavailable.', 'unavailable');
          return { kind: 'entity' as const, entity };
        }
        if (request.kind === 'actor') {
          const actor = server.getActorState(request.entityId);
          if (!actor)
            throw new WorldOperationFailure('WORLD_ACTOR_UNAVAILABLE', 'Actor is unavailable.', 'unavailable');
          return { kind: 'actor' as const, actor };
        }
        if (request.kind === 'voxel') {
          if (!integerTuple(request.position)) throw new TypeError('Voxel position must contain three integers.');
          const loaded = server.peekLoadedVoxel(...request.position);
          if (!loaded)
            throw new WorldOperationFailure(
              'WORLD_CHUNK_UNPREPARED',
              'Voxel inspection does not implicitly generate unknown terrain.',
              'unavailable',
            );
          return {
            kind: 'voxel' as const,
            position: request.position,
            voxel: loaded.voxel,
            chunkRevision: loaded.revision,
          };
        }
        if (!integerTuple(request.chunk)) throw new TypeError('Chunk position must contain three integers.');
        const key = chunkKey(...request.chunk);
        const baseline = server.readCollisionBaseline(key, 0);
        if (baseline.status === 'unavailable')
          throw new WorldOperationFailure(
            'WORLD_CHUNK_UNPREPARED',
            'Chunk inspection does not implicitly generate unknown terrain.',
            'unavailable',
          );
        const chunk = server.getChunk(...request.chunk);
        return {
          kind: 'chunk' as const,
          chunk: request.chunk,
          key,
          revision: chunk.revision,
          materialized: chunk.materialized,
        };
      },
    );
  }

  prepare(request: WorldPrepareRequest) {
    return this.run(
      () => ({ name: 'prepare', authorization: authorizationRequest('world.prepare', 'execute') }),
      async () => {
        const chunks = request.kind === 'chunk' ? [request.chunk] : request.chunks;
        if (!Array.isArray(chunks) || chunks.length > 256 || !chunks.every(integerTuple))
          throw new TypeError('Preparation must contain at most 256 integer Chunk coordinates.');
        const unique = new Map(chunks.map((chunk) => [chunkKey(...chunk), chunk] as const));
        for (const chunk of unique.values()) await this.options.prepareChunk(chunk);
        return { prepared: [...unique.keys()].sort() };
      },
    );
  }

  command(command: ServerCommand, commandOptions: WorldCommandOptions = {}) {
    return this.run(
      () => {
        if (!command || typeof command !== 'object' || typeof command.type !== 'string')
          throw new TypeError('World command must be an object with a command type.');
        const owner = this.options.owner();
        const principal = this.requirePrincipal();
        const source = commandSourceForPrincipal(principal, owner.runtime);
        return {
          name: `command:${command.type}`,
          authorization: commandAuthorizationRequests(
            source,
            command,
            (actionId) => owner.runtime.server.getAction(actionId)?.actorId ?? null,
          ),
        };
      },
      async () => {
        const owner = this.options.owner();
        const principal = this.requirePrincipal();
        const source = commandSourceForPrincipal(principal, owner.runtime);
        const sequence = commandOptions.sequence ?? ++this.commandSequence;
        if (!Number.isSafeInteger(sequence) || sequence < 0)
          throw new TypeError('World command sequence must be a non-negative safe integer.');
        this.commandSequence = Math.max(this.commandSequence, sequence);
        const current = this.options.owner();
        const operation = current.runtime.executeTransaction(
          {
            epoch: current.runtime.snapshot().epoch,
            issuer: this.options.principalId,
            stream: 'world-harness-command',
            sequence,
            ...(commandOptions.expectedCommitSequence === undefined
              ? {}
              : { expectedCommitSequence: commandOptions.expectedCommitSequence }),
          },
          () =>
            current.runtime.executeCommand(
              source,
              command,
              this.options.moduleCommandBinding?.(command) ?? {
                authorizer: this.options.authorization,
                principalId: this.options.principalId,
              },
            ),
        );
        const receipt = await (this.options.complete ? this.options.complete(operation) : operation);
        if (receipt.status !== 'executed')
          throw new WorldOperationFailure(
            `WORLD_TRANSACTION_${receipt.status.toUpperCase()}`,
            `World transaction was ${receipt.status} at commit ${receipt.commitSequence}.`,
            'conflict',
          );
        return receipt.result;
      },
    );
  }

  clock(request: WorldClockRequest) {
    return this.run(
      () => {
        if (!request || typeof request !== 'object' || !['status', 'pause', 'run', 'advance'].includes(request.kind))
          throw new TypeError('World clock request is invalid.');
        return {
          name: `clock:${request.kind}`,
          authorization: authorizationRequest('world.clock', request.kind === 'status' ? 'read' : 'control'),
        };
      },
      async () => {
        const runtime = this.options.owner().runtime;
        if (request.kind === 'status') return { paused: runtime.snapshot().paused, snapshot: runtime.snapshot() };
        if (request.kind === 'pause') {
          runtime.pause(this.options.clockNow?.() ?? this.options.platform.now());
          runtime.clearPlayerInput();
          return { paused: true, snapshot: runtime.snapshot() };
        }
        if (request.kind === 'run') {
          runtime.resume(this.options.clockNow?.() ?? this.options.platform.now());
          return { paused: false, snapshot: runtime.snapshot() };
        }
        if (!runtime.snapshot().paused)
          throw new WorldOperationFailure(
            'WORLD_CLOCK_RUNNING',
            'Deterministic advance requires a paused Authority.',
            'conflict',
          );
        if (
          !Number.isFinite(request.elapsedMs) ||
          request.elapsedMs < 0 ||
          request.elapsedMs > WORLD_HARNESS_MAX_ADVANCE_MS
        )
          throw new RangeError(`World advance must be within 0..${WORLD_HARNESS_MAX_ADVANCE_MS} ms.`);
        const advanced = await this.options.advance(request.elapsedMs);
        return {
          paused: true,
          snapshot: advanced.snapshot,
          lanes: advanced.lanes,
          gameplay: advanced.gameplay,
        };
      },
    );
  }

  logic(request: WorldLogicRequest) {
    return this.run(
      () => {
        validateWorldLogicRequest(request);
        return {
          name: `logic:${request.kind}`,
          authorization: authorizationRequest(
            'world.logic',
            request.kind === 'observe' ? 'read' : request.kind === 'submit' ? 'execute' : 'control',
          ),
        };
      },
      async () => {
        const runtime = this.options.owner().runtime;
        if (request.kind === 'mode') {
          if (request.mode !== this.logicModeValue) {
            this.logicModeValue = request.mode;
            runtime.invalidateLogicCandidates();
          }
          return { mode: this.logicModeValue };
        }
        if (request.kind === 'observe')
          return { observation: runtime.createLogicObservation(), mode: this.logicModeValue };
        if (this.logicModeValue !== 'scripted')
          throw new WorldOperationFailure(
            'WORLD_LOGIC_AUTOMATIC',
            'Scripted Logic submission requires scripted mode.',
            'conflict',
          );
        return { accepted: runtime.receiveLogicIntentBatch(request.batch), mode: this.logicModeValue };
      },
    );
  }

  actions(query: WorldActionQuery = {}) {
    return this.run(
      () => {
        if (!query || typeof query !== 'object') throw new TypeError('World action query is invalid.');
        const action = query.actionId ? this.options.owner().runtime.server.getAction(query.actionId) : null;
        if ((query.actionId && !action) || (action && query.entityId && action.actorId !== query.entityId))
          throw new WorldOperationFailure('WORLD_PERMISSION_DENIED', 'World resource access was denied.', 'permission');
        const entityId = action?.actorId ?? query.entityId;
        const target = entityId ? ({ kind: 'entity', entityId } as const) : ({ kind: 'world' } as const);
        return { name: 'actions', authorization: authorizationRequest('world.action', 'read', target) };
      },
      async () => {
        const runtime = this.options.owner().runtime;
        const actions = query.actionId
          ? [runtime.server.getAction(query.actionId)].filter((value) => value !== null)
          : query.entityId
            ? [runtime.server.getActorAction(query.entityId)].filter((value) => value !== null)
            : runtime.server.simulationSnapshot().actions.actions;
        return { actions };
      },
    );
  }

  barrier(request: WorldBarrierRequest) {
    return Promise.resolve().then(
      async (): Promise<WorldHarnessResult<{ reached: true; kind: WorldBarrierRequest['kind'] }>> => {
        let operationName = 'barrier:invalid';
        try {
          if (!request || typeof request !== 'object' || !['committed', 'settled', 'checkpoint'].includes(request.kind))
            throw new TypeError('World barrier request is invalid.');
          operationName = `barrier:${request.kind}`;
          const decision = this.options.authorization.authorize(
            this.options.principalId,
            authorizationRequest('world.barrier', 'read'),
          );
          if (!decision.allowed) throw new WorldOperationFailure(decision.code, decision.message, 'permission');
          await this.barriers.wait(request);
          const frontier = this.frontier();
          this.record(operationName, true, frontier);
          return { ok: true, data: { reached: true, kind: request.kind }, frontier };
        } catch (cause) {
          const frontier = this.safeFrontier();
          const failure = worldHarnessError(cause);
          if (frontier) this.record(operationName, false, frontier, failure.code);
          return { ok: false, error: failure, ...(frontier ? { frontier } : {}) };
        }
      },
    );
  }

  trace(request: WorldTraceRequest) {
    return this.run(
      () => {
        if (!request || typeof request !== 'object' || !['read', 'export'].includes(request.kind))
          throw new TypeError('World trace request is invalid.');
        return {
          name: `trace:${request.kind}`,
          authorization: authorizationRequest('world.trace', request.kind === 'export' ? 'export' : 'read'),
        };
      },
      async () => {
        return this.traces.read(request);
      },
    );
  }

  checkpoint(request: WorldCheckpointRequest) {
    return this.run(
      () => {
        if (!request || typeof request !== 'object' || !['export', 'restore'].includes(request.kind))
          throw new TypeError('World checkpoint request is invalid.');
        return {
          name: `checkpoint:${request.kind}`,
          authorization: authorizationRequest('world.checkpoint', request.kind === 'export' ? 'export' : 'restore'),
        };
      },
      async () => {
        const result = await this.checkpoints.execute(request);
        if (request.kind === 'restore') this.logicModeValue = 'automatic';
        return result;
      },
    );
  }

  private run<Data>(
    describe: Operation | (() => Operation),
    execute: () => Promise<Data>,
  ): Promise<WorldHarnessResult<Data>> {
    const submittedEpoch = this.safeFrontier()?.epoch ?? null;
    const result = this.operationQueue.then(async () => {
      let operation: Operation = {
        name: 'invalid-request',
        authorization: authorizationRequest('world.identity', 'read'),
      };
      try {
        if (submittedEpoch !== null && this.options.owner().epoch !== submittedEpoch)
          throw new WorldOperationFailure(
            'WORLD_EPOCH_STALE',
            'World operation was submitted for a stale epoch.',
            'conflict',
          );
        operation = typeof describe === 'function' ? describe() : describe;
        const requests = Array.isArray(operation.authorization) ? operation.authorization : [operation.authorization];
        for (const request of requests) {
          const decision = this.options.authorization.authorize(this.options.principalId, request);
          if (!decision.allowed) {
            const frontier = this.frontier();
            const failure = error(decision.code, decision.message, 'permission');
            this.record(operation.name, false, frontier, failure.code);
            return { ok: false as const, error: failure, frontier };
          }
        }
        const data = await execute();
        const frontier = this.frontier();
        this.record(operation.name, true, frontier);
        this.notifyProgress();
        return { ok: true as const, data: this.options.platform.clone(data), frontier };
      } catch (cause) {
        const frontier = this.safeFrontier();
        const failure = worldHarnessError(cause);
        if (frontier) this.record(operation.name, false, frontier, failure.code);
        return { ok: false as const, error: failure, ...(frontier ? { frontier } : {}) };
      }
    });
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 宿主调度与 Harness 操作共用队列，避免 wall tick 与 restore/advance 竞争。 */
  hostOperation<Result>(operation: () => Result | Promise<Result>): Promise<Result> {
    const result = this.operationQueue.then(async () => {
      const value = await operation();
      this.notifyProgress();
      return value;
    });
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  idle(): Promise<void> {
    return this.operationQueue;
  }

  notifyProgress(): void {
    this.barriers.notify();
  }

  private requirePrincipal(): WorldPrincipal {
    const principal = this.options.authorization.principal(this.options.principalId);
    if (!principal) throw new TypeError(`Unknown world principal: ${this.options.principalId}`);
    return principal;
  }

  private frontier(): WorldFrontier {
    const owner = this.options.owner();
    const snapshot = owner.runtime.snapshot();
    return {
      worldId: owner.worldId,
      epoch: owner.epoch,
      worldRevision: snapshot.worldRevision,
      commitSequence: snapshot.commitSequence,
      physicsTick: snapshot.physicsTick,
      fluidWorkSequence: owner.runtime.settlementDiagnostics.fluidIssuedWorkCount,
      logicObservationSequence: owner.runtime.settlementDiagnostics.logicIssuedObservationSequence,
    };
  }

  private safeFrontier(): WorldFrontier | null {
    try {
      return this.frontier();
    } catch {
      return null;
    }
  }

  private record(name: string, ok: boolean, frontier: WorldFrontier, errorCode?: string): void {
    this.traces.record({
      atMs: this.options.platform.now(),
      principalId: this.options.principalId,
      operation: name,
      ok,
      frontier,
      ...(errorCode ? { errorCode } : {}),
    });
  }
}
