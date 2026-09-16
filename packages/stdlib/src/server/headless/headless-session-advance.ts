import type { AuthorityAdvanceResult } from '../authority/authority-runtime';
import type { AuthoritySnapshot } from '../authority/authority-session';
import type { WorldCommitResult } from '../game-server-types';

const MAX_AUTHORITY_ADVANCE_MS = 60_000;

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

type AdvanceOptions = Readonly<{
  elapsedMs: number;
  advance: (slice: number) => AuthorityAdvanceResult;
  loadEntityChunks: () => Promise<void>;
  drainUnknownChunks: () => Promise<void>;
  logicBatchCount: () => number;
  fluidCandidateCount: () => number;
}>;

export async function advanceHeadlessSession(options: AdvanceOptions): Promise<HeadlessAdvanceResult> {
  if (!Number.isFinite(options.elapsedMs) || options.elapsedMs < 0)
    throw new RangeError('Headless elapsed time must be finite and non-negative.');
  const beforeLogic = options.logicBatchCount();
  const beforeFluid = options.fluidCandidateCount();
  const lanes = { physicsSteps: 0, gameplayPeriods: 0, fluidPeriods: 0 };
  const commits: WorldCommitResult[] = [];
  let latest: AuthorityAdvanceResult;
  let remaining = options.elapsedMs;

  do {
    await options.loadEntityChunks();
    const slice = Math.min(remaining, MAX_AUTHORITY_ADVANCE_MS);
    latest = options.advance(slice);
    lanes.physicsSteps += latest.lanes.physicsSteps;
    lanes.gameplayPeriods += latest.lanes.gameplayPeriods;
    lanes.fluidPeriods += latest.lanes.fluidPeriods;
    commits.push(...latest.commits);
    remaining -= slice;
    await options.drainUnknownChunks();
  } while (remaining > 0);
  return {
    elapsedMs: options.elapsedMs,
    snapshot: latest.snapshot,
    lanes: { ...lanes, logicBatches: options.logicBatchCount() - beforeLogic },
    gameplay: latest.gameplay,
    commits,
    fluidCandidates: options.fluidCandidateCount() - beforeFluid,
  };
}
