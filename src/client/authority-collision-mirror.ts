export type AuthorityCollisionCachedChunk = {
  canonical: Uint16Array;
  fluid: Uint8Array;
  chunkRevision: number;
};

export type AuthorityCollisionDelta = Readonly<{
  key: string;
  previousRevision: number;
  revision: number;
  cells: readonly Readonly<{ index: number; voxel: number; fluid: number }>[];
}>;

export type AuthorityCollisionCommit = Readonly<{
  committed: boolean;
  worldRevision: number;
  structuralChange: Readonly<{
    chunks: readonly string[];
    chunkRevisions: readonly Readonly<{ key: string; revision: number }>[];
  }> | null;
  collisionDelta?: readonly AuthorityCollisionDelta[];
}>;

export type AuthorityCollisionBaselineLease = Readonly<{
  key: string;
  generation: number;
}>;

export const AUTHORITY_COMMIT_REORDER_WINDOW = 2_048;

type AuthorityCollisionRevisionState = {
  generation: number;
  minimumRevision: number;
  pending: number;
  released: boolean;
  baselineRequested: boolean;
};

export class AuthorityCollisionRevisionGuard {
  private readonly states = new Map<string, AuthorityCollisionRevisionState>();
  private contiguousCommitRevision: number | null = null;
  private readonly outOfOrderCommits = new Set<number>();
  private highestPublishedCommitRevision: number | null = null;
  private commitResyncRequired = false;

  beginBaseline(key: string): AuthorityCollisionBaselineLease {
    const state = this.stateFor(key);
    state.released = false;
    state.pending += 1;
    return { key, generation: state.generation };
  }

  finishBaseline(lease: AuthorityCollisionBaselineLease): void {
    const state = this.states.get(lease.key);
    if (!state) return;
    state.pending = Math.max(0, state.pending - 1);
    if (lease.generation === state.generation && state.pending === 0) state.baselineRequested = false;
    if (state.pending === 0 && state.released) this.states.delete(lease.key);
  }

  require(key: string, revision: number): boolean {
    const state = this.stateFor(key);
    state.released = false;
    state.minimumRevision = Math.max(revision, state.minimumRevision);
    if (state.baselineRequested) return false;
    state.baselineRequested = true;
    return true;
  }

  accepts(key: string, revision: number, lease?: AuthorityCollisionBaselineLease): boolean {
    const state = this.states.get(key);
    if (!state) return lease === undefined;
    return (
      !state.released &&
      (!lease || (lease.key === key && lease.generation === state.generation)) &&
      revision >= state.minimumRevision
    );
  }

  isReadable(key: string, revision: number): boolean {
    const state = this.states.get(key);
    return !state || (!state.released && revision >= state.minimumRevision);
  }

  satisfy(key: string, revision: number): void {
    const state = this.states.get(key);
    if (!state || !this.accepts(key, revision)) return;
    state.minimumRevision = 0;
    state.baselineRequested = false;
  }

  release(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    state.generation += 1;
    state.minimumRevision = 0;
    state.released = true;
    state.baselineRequested = false;
    if (state.pending === 0) this.states.delete(key);
  }

  clear(): void {
    this.states.clear();
    this.contiguousCommitRevision = null;
    this.outOfOrderCommits.clear();
    this.highestPublishedCommitRevision = null;
    this.commitResyncRequired = false;
  }

  initializeCommitDelivery(worldRevision: number): void {
    if (this.contiguousCommitRevision === null) {
      this.contiguousCommitRevision = worldRevision;
      this.highestPublishedCommitRevision = worldRevision;
    }
  }

  shouldPublishCommit(worldRevision: number): boolean {
    if (this.contiguousCommitRevision === null) this.contiguousCommitRevision = worldRevision - 1;
    if (worldRevision <= this.contiguousCommitRevision || this.outOfOrderCommits.has(worldRevision)) return false;
    this.outOfOrderCommits.add(worldRevision);
    this.highestPublishedCommitRevision = Math.max(this.highestPublishedCommitRevision ?? worldRevision, worldRevision);
    while (this.outOfOrderCommits.delete(this.contiguousCommitRevision + 1)) this.contiguousCommitRevision += 1;
    if (this.outOfOrderCommits.size > AUTHORITY_COMMIT_REORDER_WINDOW) {
      this.contiguousCommitRevision = this.highestPublishedCommitRevision;
      this.outOfOrderCommits.clear();
      this.commitResyncRequired = true;
    }
    return true;
  }

  takeCommitResyncRequired(): boolean {
    const required = this.commitResyncRequired;
    this.commitResyncRequired = false;
    return required;
  }

  private stateFor(key: string): AuthorityCollisionRevisionState {
    let state = this.states.get(key);
    if (!state) {
      state = { generation: 0, minimumRevision: 0, pending: 0, released: false, baselineRequested: false };
      this.states.set(key, state);
    }
    return state;
  }
}

export async function acceptAuthorityCollisionBaseline(
  options: Readonly<{
    key: string;
    chunkRevision: number;
    generatorVersion: number;
    result: Readonly<{ canonical?: ArrayBuffer; generatorVersion?: number }>;
    preparedFluid?: Uint8Array;
    chunks: Map<string, AuthorityCollisionCachedChunk>;
    guard: AuthorityCollisionRevisionGuard;
    accept(canonical: Uint16Array): Promise<boolean>;
  }>,
): Promise<boolean> {
  if (!options.result.canonical || options.result.generatorVersion !== options.generatorVersion) return false;
  const lease = options.guard.beginBaseline(options.key);
  try {
    const canonical = new Uint16Array(options.result.canonical).slice();
    if (!(await options.accept(canonical.slice()))) return false;
    cacheAuthorityCollisionBaseline(
      options.chunks,
      options.key,
      {
        canonical,
        fluid: options.preparedFluid?.slice() ?? legacyFluid(canonical),
        chunkRevision: options.chunkRevision,
      },
      options.guard,
      lease,
    );
    return true;
  } finally {
    options.guard.finishBaseline(lease);
  }
}

export function installAuthorityCollisionBaseline(
  current: AuthorityCollisionCachedChunk | undefined,
  baseline: AuthorityCollisionCachedChunk,
): AuthorityCollisionCachedChunk {
  return current && current.chunkRevision > baseline.chunkRevision ? current : baseline;
}

export function cacheAuthorityCollisionBaseline(
  chunks: Map<string, AuthorityCollisionCachedChunk>,
  key: string,
  baseline: AuthorityCollisionCachedChunk,
  guard?: AuthorityCollisionRevisionGuard,
  lease?: AuthorityCollisionBaselineLease,
): boolean {
  if (guard && !guard.accepts(key, baseline.chunkRevision, lease)) return false;
  chunks.set(key, installAuthorityCollisionBaseline(chunks.get(key), baseline));
  guard?.satisfy(key, chunks.get(key)!.chunkRevision);
  return true;
}

export function applyAuthorityCollisionCommit(
  commit: AuthorityCollisionCommit,
  target: Readonly<{
    getChunk(key: string): AuthorityCollisionCachedChunk | undefined;
    invalidateChunk(key: string): void;
    requestBaseline(key: string): void;
  }>,
): void {
  if (!commit.committed || !commit.structuralChange) return;
  const deltas = new Map((commit.collisionDelta ?? []).map((delta) => [delta.key, delta] as const));

  for (const { key, revision } of commit.structuralChange.chunkRevisions) {
    const cached = target.getChunk(key);
    if (cached && cached.chunkRevision >= revision) continue;
    const delta = deltas.get(key);
    if (!cached || !delta || delta.revision !== revision || cached.chunkRevision !== delta.previousRevision) {
      if (cached) target.invalidateChunk(key);
      target.requestBaseline(key);
      continue;
    }
    const cellsValid = delta.cells.every(
      (cell) =>
        Number.isInteger(cell.index) &&
        cell.index >= 0 &&
        cell.index < cached.canonical.length &&
        cell.index < cached.fluid.length,
    );
    if (!cellsValid) {
      target.invalidateChunk(key);
      target.requestBaseline(key);
      continue;
    }
    for (const cell of delta.cells) {
      cached.canonical[cell.index] = cell.voxel;
      cached.fluid[cell.index] = cell.fluid;
    }
    cached.chunkRevision = revision;
  }
}

export function publishAuthorityCollisionCommits<Commit extends AuthorityCollisionCommit>(
  commits: readonly Commit[] | undefined,
  chunks: Map<string, AuthorityCollisionCachedChunk>,
  callbacks: Readonly<{
    onCommit?(commit: Commit): void;
    onUnknownChunk?(key: string): void;
  }>,
  guard?: AuthorityCollisionRevisionGuard,
): void {
  if (!commits?.length) return;
  const requestedBaselines = new Set<string>();
  for (const commit of commits) {
    if (guard && !guard.shouldPublishCommit(commit.worldRevision)) continue;
    if (guard?.takeCommitResyncRequired()) {
      for (const key of [...chunks.keys()]) {
        guard.release(key);
        chunks.delete(key);
        callbacks.onUnknownChunk?.(key);
      }
    }
    const newlyRequired = new Set<string>();
    commit.structuralChange?.chunkRevisions.forEach(({ key, revision }) => {
      if (!guard || guard.require(key, revision)) newlyRequired.add(key);
    });
    applyAuthorityCollisionCommit(commit, {
      getChunk: (key) => chunks.get(key),
      invalidateChunk: (key) => chunks.delete(key),
      requestBaseline: (key) => {
        if (requestedBaselines.has(key)) return;
        requestedBaselines.add(key);
        if (!newlyRequired.has(key)) return;
        callbacks.onUnknownChunk?.(key);
      },
    });
    commit.structuralChange?.chunkRevisions.forEach(({ key, revision }) => {
      if ((chunks.get(key)?.chunkRevision ?? -1) >= revision) guard?.satisfy(key, revision);
    });
    callbacks.onCommit?.(commit);
  }
}
import { legacyFluid } from '../server/fluid/fluid-cell-state';
