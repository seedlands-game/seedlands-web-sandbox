import { prepareHeadlessCheckpointCandidate } from './headless-checkpoint-candidate';
import {
  createHeadlessGameplayAuthorities,
  headlessModuleCommandBinding,
  resolveHeadlessWorldHarness,
} from './headless-gameplay-authority';
import { runWorldComputeTask } from '../compute/world-compute-task';
import { chunkKey } from '../../world/voxel';
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
  type WorldAuthorizationPolicy,
} from '../harness/world-authorization';
import { HeadlessClockScheduler } from './headless-clock-scheduler';
import { transactionFailure } from './headless-command-result';
import type { WorldComposition } from '../composition/contracts';
import { resolveHeadlessComposition } from './headless-composition';
import { advanceHeadlessSession, type HeadlessAdvanceResult } from './headless-session-advance';
import { drainHeadlessUnknownChunks, loadHeadlessChunk, loadHeadlessEntityChunks } from './headless-chunk-loader';
import { createWorldgenProviderRegistry } from '@seedlands/kernel/spatial';

export type { HeadlessAdvanceResult, HeadlessLaneDelta } from './headless-session-advance';

export type HeadlessFrequencies = AuthorityFrequencies;

export type HeadlessSessionOptions = Readonly<{
  seedText: string;
  generatorVersion?: number;
  platform: CorePlatformPorts;
  createComposition?: () => WorldComposition;
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
  private pendingChunkKeys: Set<string>;
  private loadedChunkKeys: Set<string>;
  private nextCommandSequence = 1;
  private logicBatchCount = 0;
  private fluidCandidateCount = 0;
  private readonly clock: HeadlessClockScheduler;
  private disposed = false;
  private readonly worldAuthorization: WorldResourceAuthorizer;
  private readonly worldPrincipalId: string;
  private retiredRuntimeDisposalFailureValue: Error | null = null;

  private constructor(
    runtime: AuthorityRuntime,
    persistence: MemoryGamePersistence,
    epoch: string,
    source: CommandSource,
    platform: CorePlatformPorts,
    frequencies: HeadlessFrequencies,
    worldHarness: NonNullable<HeadlessSessionOptions['worldHarness']>,
    pendingChunkKeys: Set<string>,
    loadedChunkKeys: Set<string>,
    private readonly createComposition?: () => WorldComposition,
    private readonly customWorldHarness?: HeadlessSessionOptions['worldHarness'],
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
    this.pendingChunkKeys = pendingChunkKeys;
    this.loadedChunkKeys = loadedChunkKeys;
    this.worldAuthorization = new WorldResourceAuthorizer(worldHarness.authorization, runtime.server.gameplayResources);
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
      moduleCommandBinding: (command) => this.moduleCommandBinding(command),
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
    const pendingChunkKeys = new Set<string>();
    const loadedChunkKeys = new Set<string>();
    const holder: { session?: HeadlessSession; pendingChunkKeys: Set<string> } = { pendingChunkKeys };
    const runtime = await HeadlessSession.createRuntime(options, persistence, epoch, holder, frequencies);
    const source: CommandSource = {
      actorId: runtime.playerId,
      sourceType: 'local-developer',
      entityId: runtime.playerId,
      capabilities: ALL_COMMAND_CAPABILITIES,
    };
    const worldHarness = resolveHeadlessWorldHarness(options.worldHarness);
    const session = new HeadlessSession(
      runtime,
      persistence,
      epoch,
      source,
      options.platform,
      frequencies,
      worldHarness,
      pendingChunkKeys,
      loadedChunkKeys,
      options.createComposition,
      options.worldHarness,
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
    holder: { session?: HeadlessSession; pendingChunkKeys: Set<string> },
    frequencies: HeadlessFrequencies,
  ): Promise<AuthorityRuntime> {
    const { composition, starterEcology, worldgenProvider } = resolveHeadlessComposition(options.createComposition);
    return AuthorityRuntime.create({
      epoch,
      seedText: options.seedText,
      generatorVersion: options.generatorVersion,
      platform: options.platform,
      composition,
      worldgenProvider,
      ...createHeadlessGameplayAuthorities(
        composition,
        resolveHeadlessWorldHarness(options.worldHarness).authorization,
      ),
      persistence,
      initialWorldTime: options.initialWorldTime ?? 9,
      startTimeMs: 0,
      frequencies,
      findInitialWorldBootstrap: async (seed, generatorVersion) => {
        if (!worldgenProvider)
          throw new Error('Headless world creation requires an explicit world-generation provider.');
        const result = await runWorldComputeTask(
          { kind: 'find-safe-spawn', seed, generatorVersion, provider: worldgenProvider.identity, starterEcology },
          () => false,
          undefined,
          { now: options.platform.now, providers: createWorldgenProviderRegistry([worldgenProvider]) },
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
      onUnknownChunk: (key) => holder.pendingChunkKeys.add(key),
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

  get retiredRuntimeDisposalFailure(): Error | null {
    return this.retiredRuntimeDisposalFailureValue;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clock.dispose();
    await this.world.idle();
    this.runtime.server.disposeGameplay();
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
    const pendingChunkKeys = new Set<string>();
    const loadedChunkKeys = new Set<string>();
    const holder: { session?: HeadlessSession; pendingChunkKeys: Set<string> } = { pendingChunkKeys };
    const { candidate, persistence, nextEpoch } = await prepareHeadlessCheckpointCandidate(
      snapshot,
      {
        platform: this.platform,
        createComposition: this.createComposition,
        worldHarness: this.customWorldHarness,
        epoch: this.epoch,
        frequencies: this.frequenciesValue,
      },
      (options, persistence, epoch) =>
        HeadlessSession.createRuntime(options, persistence, epoch, holder, this.frequenciesValue),
    );
    try {
      candidate.commitHostActivation();
      candidate.pause(candidate.sessionTimeMs);
      candidate.clearPlayerInput();
      await this.loadEntityChunksFor(candidate, pendingChunkKeys, loadedChunkKeys);
    } catch (error) {
      try {
        candidate.server.disposeGameplay();
      } catch {
        // The preparation failure remains authoritative; the candidate was never published.
      }
      throw error;
    }
    const retired = this.runtime;
    this.persistenceValue = persistence;
    this.ownerValue = {
      runtime: candidate,
      epoch: nextEpoch,
      worldId: `seedlands:g${candidate.server.generatorVersion}:${snapshot.seedText}`,
    };
    this.pendingChunkKeys = pendingChunkKeys;
    this.loadedChunkKeys = loadedChunkKeys;
    holder.session = this;
    this.source.actorId = candidate.playerId;
    this.source.entityId = candidate.playerId;
    this.retiredRuntimeDisposalFailureValue = null;
    try {
      retired.server.disposeGameplay();
    } catch (error) {
      this.retiredRuntimeDisposalFailureValue = error instanceof Error ? error : new Error(String(error));
    }
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

  private moduleCommandBinding(command: import('../commands/command-contract').ServerCommand) {
    return headlessModuleCommandBinding(
      this.runtime,
      command,
      { authorizer: this.worldAuthorization, principalId: this.worldPrincipalId },
      !!this.customWorldHarness,
    );
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
            : this.runtime.executeCommand(this.source, parsed.command, this.moduleCommandBinding(parsed.command)),
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
    return this.loadEntityChunksFor(this.runtime, this.pendingChunkKeys, this.loadedChunkKeys);
  }

  private async loadEntityChunksFor(
    runtime: AuthorityRuntime,
    pendingChunkKeys: Set<string>,
    loadedChunkKeys: Set<string>,
  ): Promise<void> {
    await loadHeadlessEntityChunks(runtime, this.platform, { pending: pendingChunkKeys, loaded: loadedChunkKeys });
  }

  private async drainUnknownChunks(): Promise<void> {
    return this.drainUnknownChunksFor(this.runtime, this.pendingChunkKeys, this.loadedChunkKeys);
  }

  private async drainUnknownChunksFor(
    runtime: AuthorityRuntime,
    pendingChunkKeys: Set<string>,
    loadedChunkKeys: Set<string>,
  ): Promise<void> {
    await drainHeadlessUnknownChunks(runtime, this.platform, {
      pending: pendingChunkKeys,
      loaded: loadedChunkKeys,
    });
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
    return this.loadChunkFor(this.runtime, this.loadedChunkKeys, key);
  }

  private async loadChunkFor(runtime: AuthorityRuntime, loadedChunkKeys: Set<string>, key: string): Promise<void> {
    await loadHeadlessChunk(runtime, this.platform, loadedChunkKeys, key);
  }
}
