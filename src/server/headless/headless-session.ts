import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { runWorldComputeTask } from '../../worker/world-compute-task';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import {
  AuthorityRuntime,
  type AuthorityAdvanceResult,
  type AuthorityFrequencies,
  type AuthorityTransactionReceipt,
} from '../authority/authority-runtime';
import type { AuthoritySnapshot } from '../authority/authority-session';
import {
  ALL_COMMAND_CAPABILITIES,
  commandCategory,
  type CommandFailure,
  type CommandResult,
  type CommandSource,
  type CommandSuccess,
  type ServerCommand,
} from '../commands/command-contract';
import { parseSlashCommand, type SlashCommandExecution } from '../commands/slash-command-parser';
import { computeFluidCandidate } from '../fluid/fluid-transaction';
import type { WorldCommitResult } from '../game-server-types';
import { decideLogicIntents } from '../logic/logic-decision';
import { MemoryGamePersistence } from '../persistence/memory-game-persistence';

export type HeadlessFrequencies = AuthorityFrequencies;

export type HeadlessLaneDelta = Readonly<{
  physicsSteps: number;
  gameplayPeriods: number;
  fluidPeriods: number;
  logicBatches: number;
}>;

export type HeadlessAdvanceResult = Readonly<{
  elapsedMs: number;
  snapshot: AuthoritySnapshot;
  lanes: HeadlessLaneDelta;
  gameplay: AuthorityAdvanceResult['gameplay'];
  commits: readonly WorldCommitResult[];
  fluidCandidates: number;
}>;

export type HeadlessSessionOptions = Readonly<{
  seedText: string;
  epoch?: string;
  initialWorldTime?: number;
  frequencies?: HeadlessFrequencies;
}>;

const DEFAULT_FREQUENCIES: HeadlessFrequencies = Object.freeze({
  physicsHz: 60,
  gameplayHz: 20,
  fluidHz: 30,
});
const MAX_AUTHORITY_ADVANCE_MS = 60_000;

const transactionFailure = (
  runtime: AuthorityRuntime,
  source: CommandSource,
  command: ServerCommand,
  receipt: Exclude<AuthorityTransactionReceipt<CommandResult>, { status: 'executed' }>,
): CommandFailure => ({
  success: false,
  message: `Headless transaction was ${receipt.status}.`,
  error: {
    kind: 'execution',
    code: `HEADLESS_TRANSACTION_${receipt.status.toUpperCase()}`,
    message: `Headless transaction was ${receipt.status}.`,
  },
  affectedChunks: [],
  worldRevision: runtime.server.worldRevision,
  observation: {
    commandType: command.type,
    category: commandCategory(command) ?? 'administrative',
    actorId: source.actorId,
    sourceType: source.sourceType,
    durationMs: 0,
    success: false,
    errorKind: 'execution',
    affectedChunks: [],
    worldRevision: runtime.server.worldRevision,
    mutationCount: runtime.server.mutationCount,
    structuralEventCount: 0,
  },
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
  readonly runtime: AuthorityRuntime;
  readonly persistence: MemoryGamePersistence;
  private readonly epoch: string;
  private readonly source: CommandSource;
  private readonly pendingChunkKeys = new Set<string>();
  private readonly loadedChunkKeys = new Set<string>();
  private nextCommandSequence = 1;
  private logicBatchCount = 0;
  private fluidCandidateCount = 0;

  private constructor(
    runtime: AuthorityRuntime,
    persistence: MemoryGamePersistence,
    epoch: string,
    source: CommandSource,
  ) {
    this.runtime = runtime;
    this.persistence = persistence;
    this.epoch = epoch;
    this.source = source;
  }

  static async create(options: HeadlessSessionOptions): Promise<HeadlessSession> {
    const epoch = options.epoch ?? `headless:${options.seedText}`;
    const persistence = new MemoryGamePersistence();
    const frequencies = options.frequencies ?? DEFAULT_FREQUENCIES;
    const holder: { session?: HeadlessSession } = {};
    const runtime = await AuthorityRuntime.create({
      epoch,
      seedText: options.seedText,
      persistence,
      initialWorldTime: options.initialWorldTime ?? 9,
      startTimeMs: 0,
      frequencies,
      findInitialPlayerBodyPosition: async (seed, generatorVersion) => {
        const result = await runWorldComputeTask({ kind: 'find-safe-spawn', seed, generatorVersion });
        if (result.kind !== 'safe-spawn-result') throw new Error('安全出生点计算返回了错误的结果类型。');
        return result.position;
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
        const batch = decideLogicIntents(observation, { physicsHz: frequencies.physicsHz });
        session.runtime.receiveLogicIntentBatch(batch);
        session.logicBatchCount += 1;
        session.runtime.requestLogicObservation();
      },
    });
    const source: CommandSource = {
      actorId: runtime.playerId,
      sourceType: 'local-developer',
      entityId: runtime.playerId,
      capabilities: ALL_COMMAND_CAPABILITIES,
    };
    const session = new HeadlessSession(runtime, persistence, epoch, source);
    holder.session = session;
    await session.loadEntityChunks();
    runtime.requestLogicObservation();
    return session;
  }

  async advanceSession(elapsedMs: number): Promise<HeadlessAdvanceResult> {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
      throw new RangeError('Headless elapsed time must be finite and non-negative.');
    const beforeLogic = this.logicBatchCount;
    const beforeFluid = this.fluidCandidateCount;
    const lanes = { physicsSteps: 0, gameplayPeriods: 0, fluidPeriods: 0 };
    const commits: WorldCommitResult[] = [];
    let latest: AuthorityAdvanceResult;
    let remaining = elapsedMs;

    do {
      await this.loadEntityChunks();
      const slice = Math.min(remaining, MAX_AUTHORITY_ADVANCE_MS);
      const result = this.runtime.advanceSession(slice);
      latest = result;
      lanes.physicsSteps += result.lanes.physicsSteps;
      lanes.gameplayPeriods += result.lanes.gameplayPeriods;
      lanes.fluidPeriods += result.lanes.fluidPeriods;
      commits.push(...result.commits);
      remaining -= slice;
      await this.drainUnknownChunks();
    } while (remaining > 0);
    return {
      elapsedMs,
      snapshot: latest.snapshot,
      lanes: {
        ...lanes,
        logicBatches: this.logicBatchCount - beforeLogic,
      },
      gameplay: latest.gameplay,
      commits,
      fluidCandidates: this.fluidCandidateCount - beforeFluid,
    };
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
    const parsed = parseSlashCommand(input);
    if (!parsed.success) return { command: null, result: parsed };
    const commandSequence = sequence ?? this.nextCommandSequence++;
    if (!Number.isSafeInteger(commandSequence) || commandSequence < 0)
      throw new RangeError('Headless command sequence must be a non-negative safe integer.');
    this.nextCommandSequence = Math.max(this.nextCommandSequence, commandSequence + 1);
    const receipt = await this.runtime.executeTransaction(
      { epoch: this.epoch, issuer: 'headless-cli', stream: 'commands', sequence: commandSequence },
      () =>
        parsed.command.type === 'advance-gameplay'
          ? this.executeTick(parsed.command.seconds)
          : this.runtime.executeCommand(this.source, parsed.command),
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
    const startedAt = performance.now();
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
          durationMs: performance.now() - startedAt,
          success: false,
          errorKind: 'validation',
          affectedChunks: [],
          worldRevision: this.runtime.server.worldRevision,
          mutationCount: this.runtime.server.mutationCount,
          structuralEventCount: 0,
        },
      };
    }
    const result = await this.advanceSession(seconds * 1_000);
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
        durationMs: performance.now() - startedAt,
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

  private async loadChunk(key: string): Promise<void> {
    if (this.loadedChunkKeys.has(key)) return;
    const [cx, cy, cz] = parseChunkKey(key);
    const prepared = await this.runtime.prepareMesh(cx, cy, cz);
    const result = await runWorldComputeTask({
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
    });
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
