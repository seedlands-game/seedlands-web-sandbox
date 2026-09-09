import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { runWorldComputeTask } from '../../compute/world-compute-task';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import { AuthorityRuntime, type AuthorityFrequencies } from '../authority/authority-runtime';
import {
  ALL_COMMAND_CAPABILITIES,
  commandCategory,
  type CommandResult,
  type CommandSource,
  type CommandSuccess,
} from '../commands/command-contract';
import { parseSlashCommand, type SlashCommandExecution } from '../commands/slash-command-parser';
import { computeFluidCandidate } from '../fluid/fluid-transaction';
import { decideLogicIntents } from '../logic/logic-decision';
import { MemoryGamePersistence } from '../persistence/memory-game-persistence';
import type { CorePlatformPorts } from '../../runtime/platform-ports';
import type { FrozenGameSaveSnapshot } from '../persistence/game-save-snapshot';
import { AuthorityWorldHarness, type AuthorityWorldOwner } from '../harness/authority-world-harness';
import {
  WorldResourceAuthorizer,
  commandAuthorizationRequests,
  developmentWorldAuthorizationPolicy,
  type WorldAuthorizationPolicy,
} from '../harness/world-authorization';
import { HeadlessClockScheduler } from './headless-clock-scheduler';
import { transactionFailure } from './headless-command-result';
import { advanceHeadlessSession, type HeadlessAdvanceResult } from './headless-session-advance';

export type { HeadlessAdvanceResult, HeadlessLaneDelta } from './headless-session-advance';

export type HeadlessFrequencies = AuthorityFrequencies;

export type HeadlessSessionOptions = Readonly<{
  seedText: string;
  platform: CorePlatformPorts;
  epoch?: string;
  initialWorldTime?: number;
  frequencies?: HeadlessFrequencies;
  worldHarness?: Readonly<{ principalId: string; authorization: WorldAuthorizationPolicy }>;
}>;

const DEFAULT_FREQUENCIES: HeadlessFrequencies = Object.freeze({
  physicsHz: 60,
  gameplayHz: 20,
  fluidHz: 30,
});
function assertStepCount(label: string, steps: number): void {
  if (!Number.isSafeInteger(steps) || steps < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}

function parseChunkKey(key: string): [number, number, number] {
  const coordinates = key.split(',').map(Number);
  if (coordinates.length !== 3 || coordinates.some((value) => !Number.isInteger(value)))
    throw new TypeError(`Invalid chunk key: ${key}`);
  return coordinates as [number, number, number];
}

/**
 * 无 DOM 的本地 Authority 适配。它只编排生产 runtime 与纯计算入口，不拥有第二份游戏状态。
 */
export class HeadlessSession {
  readonly world: AuthorityWorldHarness;
  private ownerValue: AuthorityWorldOwner;
  private persistenceValue: MemoryGamePersistence;
  private readonly source: CommandSource;
  private readonly platform: CorePlatformPorts;
  private readonly frequenciesValue: HeadlessFrequencies;
  private readonly pendingChunkKeys = new Set<string>();
  private readonly loadedChunkKeys = new Set<string>();
  private nextCommandSequence = 1;
  private logicBatchCount = 0;
  private fluidCandidateCount = 0;
  private readonly clock: HeadlessClockScheduler;
  private disposed = false;
  private readonly worldAuthorization: WorldResourceAuthorizer;
  private readonly worldPrincipalId: string;

  private constructor(
    runtime: AuthorityRuntime,
    persistence: MemoryGamePersistence,
    epoch: string,
    source: CommandSource,
    platform: CorePlatformPorts,
    frequencies: HeadlessFrequencies,
    worldHarness: NonNullable<HeadlessSessionOptions['worldHarness']>,
  ) {
    this.ownerValue = {
      runtime,
      epoch,
      worldId: `seedlands:g${runtime.server.generatorVersion}:${runtime.server.options.seedText}`,
    };
    this.persistenceValue = persistence;
    this.source = source;
    this.platform = platform;
    this.frequenciesValue = frequencies;
    this.worldAuthorization = new WorldResourceAuthorizer(worldHarness.authorization);
    this.worldPrincipalId = worldHarness.principalId;
    this.world = new AuthorityWorldHarness({
      platform,
      principalId: worldHarness.principalId,
      authorization: this.worldAuthorization,
      owner: () => this.ownerValue,
      prepareChunk: (chunk) => this.loadChunk(chunkKey(...chunk)),
      advance: (elapsedMs) => this.advancePausedSession(elapsedMs),
      restore: (snapshot) => this.restoreCheckpoint(snapshot),
      complete: (operation) => this.completeWithChunkPreparation(operation),
      clockNow: () => this.runtime.sessionTimeMs,
    });
    this.clock = new HeadlessClockScheduler(platform, (elapsedMs, isCurrent) =>
      this.world.hostOperation(() => (isCurrent() ? this.advanceSessionUnqueued(elapsedMs) : undefined)),
    );
  }

  get runtime(): AuthorityRuntime {
    return this.ownerValue.runtime;
  }

  get persistence(): MemoryGamePersistence {
    return this.persistenceValue;
  }

  private get epoch(): string {
    return this.ownerValue.epoch;
  }

  static async create(options: HeadlessSessionOptions): Promise<HeadlessSession> {
    const epoch = options.epoch ?? `headless:${options.seedText}`;
    const persistence = new MemoryGamePersistence({ clone: options.platform.clone });
    const frequencies = options.frequencies ?? DEFAULT_FREQUENCIES;
    const holder: { session?: HeadlessSession } = {};
    const runtime = await HeadlessSession.createRuntime(options, persistence, epoch, holder, frequencies);
    const source: CommandSource = {
      actorId: runtime.playerId,
      sourceType: 'local-developer',
      entityId: runtime.playerId,
      capabilities: ALL_COMMAND_CAPABILITIES,
    };
    const worldHarness = options.worldHarness ?? {
      principalId: 'headless-developer',
      authorization: developmentWorldAuthorizationPolicy('headless-developer', runtime.playerId),
    };
    const session = new HeadlessSession(
      runtime,
      persistence,
      epoch,
      source,
      options.platform,
      frequencies,
      worldHarness,
    );
    holder.session = session;
    await session.loadEntityChunks();
    runtime.requestLogicObservation();
    return session;
  }

  private static createRuntime(
    options: HeadlessSessionOptions,
    persistence: MemoryGamePersistence,
    epoch: string,
    holder: { session?: HeadlessSession },
    frequencies: HeadlessFrequencies,
  ): Promise<AuthorityRuntime> {
    return AuthorityRuntime.create({
      epoch,
      seedText: options.seedText,
      platform: options.platform,
      persistence,
      initialWorldTime: options.initialWorldTime ?? 9,
      startTimeMs: 0,
      frequencies,
      findInitialWorldBootstrap: async (seed, generatorVersion) => {
        const result = await runWorldComputeTask(
          { kind: 'find-safe-spawn', seed, generatorVersion },
          () => false,
          undefined,
          { now: options.platform.now },
        );
        if (result.kind !== 'safe-spawn-result') throw new Error('安全出生点计算返回了错误的结果类型。');
        return {
          playerBodyPosition: result.playerBodyPosition,
          starterChunks: result.starterChunks.map((chunk) => ({
            ...chunk,
            canonical: new Uint16Array(chunk.canonical),
          })),
        };
      },
      onUnknownChunk: (key) => holder.session?.pendingChunkKeys.add(key),
      onFluidWork: (snapshot) => {
        const session = holder.session;
        if (!session) throw new Error('Headless fluid callback ran before Authority initialization.');
        const candidate = computeFluidCandidate(snapshot);
        const result = session.runtime.commitFluidCandidate(candidate);
        if (!result.accepted) session.runtime.abortFluidWork(snapshot.workId, result.reason);
        session.fluidCandidateCount += 1;
      },
      onLogicObservation: (observation) => {
        const session = holder.session;
        if (!session) throw new Error('Headless logic callback ran before Authority initialization.');
        if (!session.world.acceptsAutomaticLogic()) return;
        const batch = decideLogicIntents(observation, { physicsHz: frequencies.physicsHz });
        session.runtime.receiveLogicIntentBatch(batch);
        session.logicBatchCount += 1;
        session.runtime.requestLogicObservation();
      },
    });
  }

  async advanceSession(elapsedMs: number): Promise<HeadlessAdvanceResult> {
    return this.world.hostOperation(() => this.advanceSessionUnqueued(elapsedMs));
  }

  private advanceSessionUnqueued(elapsedMs: number): Promise<HeadlessAdvanceResult> {
    return this.advanceWith(elapsedMs, (slice) => this.runtime.advanceSession(slice));
  }

  private async advancePausedSession(elapsedMs: number): Promise<HeadlessAdvanceResult> {
    return this.advanceWith(elapsedMs, (slice) => this.runtime.advancePausedSession(slice));
  }

  /** 启用开发宿主 wall clock；暂停态只更新 wall 游标，clock run 后才推进模拟。 */
  startClock(): void {
    this.clock.start();
  }

  stopClock(): void {
    this.clock.stop();
  }

  get clockFailure(): Error | null {
    return this.clock.failure;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clock.dispose();
    await this.world.idle();
  }

  private async advanceWith(
    elapsedMs: number,
    advance: Parameters<typeof advanceHeadlessSession>[0]['advance'],
  ): Promise<HeadlessAdvanceResult> {
    return advanceHeadlessSession({
      elapsedMs,
      advance,
      loadEntityChunks: () => this.loadEntityChunks(),
      drainUnknownChunks: () => this.drainUnknownChunks(),
      logicBatchCount: () => this.logicBatchCount,
      fluidCandidateCount: () => this.fluidCandidateCount,
    });
  }

  private async restoreCheckpoint(snapshot: FrozenGameSaveSnapshot): Promise<void> {
    const persistence = new MemoryGamePersistence({ clone: this.platform.clone });
    persistence.saveFrozenSnapshot(snapshot);
    const nextEpoch = `${this.epoch}:restore:${snapshot.commitSequence}:${snapshot.worldRevision}`;
    const holder = { session: this };
    const candidate = await HeadlessSession.createRuntime(
      {
        seedText: snapshot.seedText,
        platform: this.platform,
        epoch: nextEpoch,
        initialWorldTime: snapshot.gameplay.worldTime ?? 9,
        frequencies: this.frequenciesValue,
      },
      persistence,
      nextEpoch,
      holder,
      this.frequenciesValue,
    );
    candidate.commitHostActivation();
    candidate.pause(candidate.sessionTimeMs);
    candidate.clearPlayerInput();
    this.pendingChunkKeys.clear();
    this.loadedChunkKeys.clear();
    this.persistenceValue = persistence;
    this.ownerValue = {
      runtime: candidate,
      epoch: nextEpoch,
      worldId: `seedlands:g${candidate.server.generatorVersion}:${snapshot.seedText}`,
    };
    this.source.actorId = candidate.playerId;
    this.source.entityId = candidate.playerId;
    await this.loadEntityChunks();
    candidate.requestLogicObservation();
  }

  advancePhysics(steps: number): Promise<HeadlessAdvanceResult> {
    assertStepCount('Physics steps', steps);
    return this.advanceSession((steps * 1_000) / this.runtime.frequencies.physicsHz);
  }

  advanceLogic(steps: number): Promise<HeadlessAdvanceResult> {
    assertStepCount('Logic steps', steps);
    return this.advanceSession((steps * 1_000) / this.runtime.frequencies.gameplayHz);
  }

  advanceFluid(steps: number): Promise<HeadlessAdvanceResult> {
    assertStepCount('Fluid steps', steps);
    return this.advanceSession((steps * 1_000) / this.runtime.frequencies.fluidHz);
  }

  async executeLine(input: string, sequence?: number): Promise<SlashCommandExecution> {
    return this.world.hostOperation(() => this.executeLineUnqueued(input, sequence));
  }

  private async executeLineUnqueued(input: string, sequence?: number): Promise<SlashCommandExecution> {
    const parsed = parseSlashCommand(input);
    if (!parsed.success) return { command: null, result: parsed };
    for (const request of commandAuthorizationRequests(
      this.source,
      parsed.command,
      (actionId) => this.runtime.server.getAction(actionId)?.actorId ?? null,
    )) {
      const decision = this.worldAuthorization.authorize(this.worldPrincipalId, request);
      if (!decision.allowed)
        return {
          command: parsed.command,
          result: {
            success: false,
            message: decision.message,
            error: { kind: 'permission', code: decision.code, message: decision.message },
            affectedChunks: [],
            worldRevision: this.runtime.server.worldRevision,
            observation: {
              commandType: parsed.command.type,
              category: commandCategory(parsed.command) ?? 'administrative',
              actorId: this.source.actorId,
              sourceType: this.source.sourceType,
              durationMs: 0,
              success: false,
              errorKind: 'permission',
              affectedChunks: [],
              worldRevision: this.runtime.server.worldRevision,
              mutationCount: this.runtime.server.mutationCount,
              structuralEventCount: 0,
            },
          },
        };
    }
    const commandSequence = sequence ?? this.nextCommandSequence++;
    if (!Number.isSafeInteger(commandSequence) || commandSequence < 0)
      throw new RangeError('Headless command sequence must be a non-negative safe integer.');
    this.nextCommandSequence = Math.max(this.nextCommandSequence, commandSequence + 1);
    const receipt = await this.completeWithChunkPreparation(
      this.runtime.executeTransaction(
        { epoch: this.epoch, issuer: 'headless-cli', stream: 'commands', sequence: commandSequence },
        () =>
          parsed.command.type === 'advance-gameplay'
            ? this.executeTick(parsed.command.seconds)
            : this.runtime.executeCommand(this.source, parsed.command),
      ),
    );
    if (receipt.status !== 'executed')
      return {
        command: parsed.command,
        result: transactionFailure(this.runtime, this.source, parsed.command, receipt),
      };
    if (receipt.result.success) for (const key of receipt.result.affectedChunks) await this.loadChunk(key);
    await this.loadEntityChunks();
    return { command: parsed.command, result: receipt.result };
  }

  private async executeTick(seconds: number): Promise<CommandResult> {
    const startedAt = this.platform.now();
    if (!Number.isFinite(seconds) || seconds <= 0) {
      const message = 'Gameplay seconds must be positive.';
      return {
        success: false,
        message,
        error: { kind: 'validation', code: 'COMMAND_VALIDATION_FAILED', message },
        affectedChunks: [],
        worldRevision: this.runtime.server.worldRevision,
        observation: {
          commandType: 'advance-gameplay',
          category: 'administrative',
          actorId: this.source.actorId,
          sourceType: this.source.sourceType,
          durationMs: this.platform.now() - startedAt,
          success: false,
          errorKind: 'validation',
          affectedChunks: [],
          worldRevision: this.runtime.server.worldRevision,
          mutationCount: this.runtime.server.mutationCount,
          structuralEventCount: 0,
        },
      };
    }
    const result = this.runtime.snapshot().paused
      ? await this.advancePausedSession(seconds * 1_000)
      : await this.advanceSessionUnqueued(seconds * 1_000);
    const affectedChunks = [...new Set(result.commits.flatMap((commit) => commit.structuralChange?.chunks ?? []))];
    const success: CommandSuccess = {
      success: true,
      message: `Advanced session by ${seconds} second(s).`,
      data: {
        seconds,
        elapsedMs: result.elapsedMs,
        lanes: result.lanes,
        fluidCandidates: result.fluidCandidates,
        physicsTick: result.snapshot.physicsTick,
        gameplayTime: result.gameplay.gameplayTime,
        worldTime: result.snapshot.worldTime,
      },
      affectedChunks,
      worldRevision: this.runtime.server.worldRevision,
      observation: {
        commandType: 'advance-gameplay',
        category: 'administrative',
        actorId: this.source.actorId,
        sourceType: this.source.sourceType,
        durationMs: this.platform.now() - startedAt,
        success: true,
        affectedChunks,
        worldRevision: this.runtime.server.worldRevision,
        mutationCount: this.runtime.server.mutationCount,
        structuralEventCount: result.commits.some((commit) => commit.structuralChange) ? 1 : 0,
      },
    };
    return success;
  }

  private async loadEntityChunks(): Promise<void> {
    for (const entity of this.runtime.server.queryEntities()) {
      const config = bodyConfigFor(bodyKindForEntity(entity));
      const min = [config.localAabb.min.x, config.localAabb.min.y, config.localAabb.min.z] as const;
      const max = [config.localAabb.max.x, config.localAabb.max.y, config.localAabb.max.z] as const;
      const lower = entity.position.map((value, axis) => floorDiv(value + min[axis] - 0.05, CHUNK_SIZE));
      const upper = entity.position.map((value, axis) => floorDiv(value + max[axis] + 0.05, CHUNK_SIZE));
      for (let cy = lower[1]; cy <= upper[1]; cy += 1)
        for (let cz = lower[2]; cz <= upper[2]; cz += 1)
          for (let cx = lower[0]; cx <= upper[0]; cx += 1) await this.loadChunk(chunkKey(cx, cy, cz));
    }
    await this.drainUnknownChunks();
  }

  private async drainUnknownChunks(): Promise<void> {
    while (this.pendingChunkKeys.size > 0) {
      const keys = [...this.pendingChunkKeys].sort();
      this.pendingChunkKeys.clear();
      for (const key of keys) await this.loadChunk(key);
    }
  }

  private async completeWithChunkPreparation<Result>(operation: Promise<Result>): Promise<Result> {
    let completed = false;
    let value: Result | undefined;
    let failure: unknown;
    void operation.then(
      (result) => {
        value = result;
        completed = true;
      },
      (error) => {
        failure = error;
        completed = true;
      },
    );
    while (!completed) {
      await Promise.resolve();
      await this.drainUnknownChunks();
      if (!completed) await this.platform.yieldTurn();
    }
    if (failure !== undefined) throw failure;
    return value!;
  }

  private async loadChunk(key: string): Promise<void> {
    if (this.loadedChunkKeys.has(key) && this.runtime.readCollisionBaseline(key, 0).status === 'available') return;
    this.loadedChunkKeys.delete(key);
    const [cx, cy, cz] = parseChunkKey(key);
    const prepared = await this.runtime.prepareMesh(cx, cy, cz);
    const result = await runWorldComputeTask(
      {
        kind: 'generate-mesh',
        traceId: `headless:${key}:${prepared.chunkRevision}`,
        epoch: 0,
        chunkKey: prepared.key,
        seed: this.runtime.server.seed,
        cx,
        cy,
        cz,
        chunkRevision: prepared.chunkRevision,
        haloRevision: 'headless-compute',
        generatorVersion: prepared.generatorVersion,
        ...(prepared.canonical ? { canonical: prepared.canonical } : {}),
        ...(prepared.fluid ? { fluid: prepared.fluid } : {}),
        overlays: prepared.overlays,
      },
      () => false,
      undefined,
      { now: this.platform.now },
    );
    if (result.kind !== 'mesh-result' || !('canonical' in result))
      throw new Error(`Headless chunk compute returned no canonical data for ${key}.`);
    const accepted = this.runtime.acceptGeneratedChunk({
      key: result.chunkKey,
      cx: result.cx,
      cy: result.cy,
      cz: result.cz,
      chunkRevision: result.chunkRevision,
      generatorVersion: result.generatorVersion,
      canonical: new Uint16Array(result.canonical),
    });
    if (!accepted) throw new Error(`Authority rejected headless chunk ${key}.`);
    this.loadedChunkKeys.add(key);
    this.runtime.setFluidActiveChunks([...this.loadedChunkKeys].sort());
  }
}
