import {
  FluidTransactionAuthority,
  type FluidAuthoritySnapshot,
  type FluidCandidate,
  type FluidCellValue,
  type FluidChunkSnapshot,
  type FluidPosition,
} from './fluid-transaction';

export class FluidTransactionRuntime<TCommit> {
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

  private lastCommit: TCommit | undefined;

  takeLastCommit(): TCommit | undefined {
    const commit = this.lastCommit;
    this.lastCommit = undefined;
    return commit;
  }

  recordCommit(commit: TCommit): void {
    this.lastCommit = commit;
  }

  get diagnostics() {
    return this.authority.diagnostics;
  }

  get leasedChunkKeys() {
    return this.authority.leasedChunkKeys;
  }
}
