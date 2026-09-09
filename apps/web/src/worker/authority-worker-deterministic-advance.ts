import { bodyConfigFor, bodyKindForEntity } from '@seedlands/game-core/physics/body-registry';
import type { AuthorityRuntime } from '@seedlands/game-core/server/authority/authority-runtime';
import type { AuthorityAdvanceResult } from '@seedlands/game-core/server/authority/authority-runtime-types';
import type { LogicIntentBatch, LogicObservation } from '@seedlands/game-core/server/logic/logic-protocol';
import type { WorldCommitResult } from '@seedlands/game-core/server/game-server-types';
import { CHUNK_SIZE, floorDiv } from '@seedlands/game-core/world/voxel';

const ADVANCE_SLICE_MS = 100;
const LOGIC_RESPONSE_TIMEOUT_MS = 5_000;

type PendingLogic = {
  epoch: string;
  sequence: number;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: unknown;
};

type Options = Readonly<{
  runtime: () => AuthorityRuntime;
  postLogicObservation: (observation: LogicObservation) => void;
  yieldTurn: () => Promise<void>;
  timers: Readonly<{
    set: (callback: () => void, delayMs: number) => unknown;
    clear: (handle: unknown) => void;
  }>;
}>;

function entityCollisionChunks(runtime: AuthorityRuntime): readonly (readonly [number, number, number])[] {
  const chunks = new Map<string, readonly [number, number, number]>();
  for (const entity of runtime.server.queryEntities()) {
    const config = bodyConfigFor(bodyKindForEntity(entity));
    const min = [config.localAabb.min.x, config.localAabb.min.y, config.localAabb.min.z] as const;
    const max = [config.localAabb.max.x, config.localAabb.max.y, config.localAabb.max.z] as const;
    const lower = entity.position.map((value, axis) => floorDiv(value + min[axis] - 0.05, CHUNK_SIZE));
    const upper = entity.position.map((value, axis) => floorDiv(value + max[axis] + 0.05, CHUNK_SIZE));
    for (let cy = lower[1]; cy <= upper[1]; cy += 1)
      for (let cz = lower[2]; cz <= upper[2]; cz += 1)
        for (let cx = lower[0]; cx <= upper[0]; cx += 1) chunks.set(`${cx},${cy},${cz}`, [cx, cy, cz]);
  }
  return [...chunks.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, chunk]) => chunk);
}

/** Interleaves paused Authority slices with the existing external Browser Logic owner. */
export class BrowserAuthorityDeterministicAdvance {
  private pendingLogic: PendingLogic | null = null;
  private advancing = false;

  constructor(private readonly options: Options) {}

  get isAdvancing(): boolean {
    return this.advancing;
  }

  publishLogicObservation(observation: LogicObservation): void {
    if (this.advancing) {
      if (this.pendingLogic) {
        this.pendingLogic.reject(new Error('Deterministic advance published overlapping Logic observations.'));
        this.options.timers.clear(this.pendingLogic.timeout);
      }
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((complete, fail) => {
        resolve = complete;
        reject = fail;
      });
      const timeout = this.options.timers.set(() => {
        const pending = this.pendingLogic;
        if (!pending || pending.promise !== promise) return;
        this.pendingLogic = null;
        pending.reject(
          new Error(`Browser Logic response timed out for observation ${observation.observationSequence}.`),
        );
      }, LOGIC_RESPONSE_TIMEOUT_MS);
      this.pendingLogic = {
        epoch: observation.epoch,
        sequence: observation.observationSequence,
        promise,
        resolve,
        reject,
        timeout,
      };
    }
    try {
      this.options.postLogicObservation(observation);
    } catch (error) {
      const pending = this.pendingLogic;
      if (pending?.sequence === observation.observationSequence && pending.epoch === observation.epoch) {
        this.pendingLogic = null;
        this.options.timers.clear(pending.timeout);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  acceptLogicIntentBatch(batch: LogicIntentBatch): boolean {
    const accepted = this.options.runtime().receiveLogicIntentBatch(batch);
    const pending = this.pendingLogic;
    if (!pending || pending.epoch !== batch.epoch || pending.sequence !== batch.observationSequence) return accepted;
    this.pendingLogic = null;
    this.options.timers.clear(pending.timeout);
    if (accepted) pending.resolve();
    else pending.reject(new Error(`Authority rejected Logic response for observation ${batch.observationSequence}.`));
    return accepted;
  }

  async advancePaused(elapsedMs: number, automaticLogic: boolean): Promise<AuthorityAdvanceResult> {
    if (this.advancing) throw new Error('Browser deterministic advance is already running.');
    this.advancing = true;
    const runtime = this.options.runtime();
    const commits: WorldCommitResult[] = [];
    const lanes = { physicsSteps: 0, gameplayPeriods: 0, fluidPeriods: 0 };
    let remaining = elapsedMs;
    let latest: AuthorityAdvanceResult;
    try {
      do {
        const chunks = entityCollisionChunks(runtime);
        if (chunks.length && !(await runtime.prepareHarnessChunks(chunks)))
          throw new Error('Browser deterministic advance could not prepare entity collision Chunks.');
        if (automaticLogic) runtime.requestLogicObservation();
        const slice = Math.min(remaining, ADVANCE_SLICE_MS);
        latest = runtime.advancePausedSession(slice);
        lanes.physicsSteps += latest.lanes.physicsSteps;
        lanes.gameplayPeriods += latest.lanes.gameplayPeriods;
        lanes.fluidPeriods += latest.lanes.fluidPeriods;
        commits.push(...latest.commits);
        remaining -= slice;
        const pending = this.pendingLogic;
        if (pending) await pending.promise;
        else if (automaticLogic) await this.options.yieldTurn();
      } while (remaining > 0);
      return { ...latest, lanes, commits, gameplay: runtime.view() };
    } finally {
      const pending = this.pendingLogic;
      this.pendingLogic = null;
      if (pending) {
        this.options.timers.clear(pending.timeout);
        pending.reject(new Error('Browser deterministic advance ended before its Logic response.'));
      }
      this.advancing = false;
    }
  }
}
