import {
  FLUID_FRONTIER_BATCH_SIZE,
  FluidTransactionAuthority,
  computeFluidCandidate,
  type FluidAuthoritySnapshot,
  type FluidCandidate,
  type FluidCellValue,
  type FluidChunkSnapshot,
  type FluidPosition,
} from './fluid-transaction';

const STEP_SECONDS = 1 / 30;
const MAX_STEPS = 8;

export class FluidTransactionRuntime<TCommit> {
  private accumulator = 0;
  readonly authority: FluidTransactionAuthority;

  constructor(options: {
    epoch: number;
    readChunk(key: string): FluidChunkSnapshot | null;
    readCell(position: FluidPosition): FluidCellValue | null;
    apply(candidate: FluidCandidate): TCommit;
  }) {
    this.authority = new FluidTransactionAuthority({
      ...options,
      apply: (candidate) => this.recordCommit(options.apply(candidate)),
    });
  }

  activate(position: FluidPosition): boolean {
    return this.authority.activate(position);
  }

  removeSource(position: FluidPosition): boolean {
    return this.authority.removeSource(position);
  }

  requestFluidWork(): FluidAuthoritySnapshot | null {
    return this.authority.requestFluidWork();
  }

  commitFluidCandidate(candidate: FluidCandidate) {
    return this.authority.commitFluidCandidate(candidate);
  }

  abortLease(workId: string, reason: string): boolean {
    return this.authority.abortLease(workId, reason);
  }

  advance(seconds: number): { steps: number; processed: number; pending: number; commits: TCommit[] } {
    this.accumulator += Math.max(0, seconds);
    const requested = Math.floor(this.accumulator / STEP_SECONDS);
    const steps = Math.min(requested, MAX_STEPS);
    this.accumulator = requested > MAX_STEPS ? 0 : this.accumulator - steps * STEP_SECONDS;
    const commits: TCommit[] = [];
    let processed = 0;
    for (let step = 0; step < steps; step += 1) {
      const snapshot = this.authority.requestFluidWork();
      if (!snapshot) continue;
      processed += snapshot.frontier.length + (snapshot.cleanupFrontier?.length ?? 0);
      const candidate = computeFluidCandidate(snapshot);
      const result = this.authority.commitFluidCandidate(candidate);
      if (result.accepted) {
        // TCommit is supplied by the adapter through takeLastCommit.
        const applied = this.takeLastCommit();
        if (applied !== undefined) commits.push(applied);
      }
    }
    return { steps, processed, pending: this.authority.pending, commits };
  }

  private lastCommit: TCommit | undefined;

  takeLastCommit(): TCommit | undefined {
    const commit = this.lastCommit;
    this.lastCommit = undefined;
    return commit;
  }

  recordCommit(commit: TCommit): void {
    this.lastCommit = commit;
  }

  get batchSize(): number {
    return FLUID_FRONTIER_BATCH_SIZE;
  }
}
