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

type AuthorityCollisionRevisionState = {
  generation: number;
  minimumRevision: number;
  pending: number;
  released: boolean;
};

export class AuthorityCollisionRevisionGuard {
  private readonly states = new Map<string, AuthorityCollisionRevisionState>();
  private contiguousCommitRevision: number | null = null;
  private readonly outOfOrderCommits = new Set<number>();

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
    if (state.pending === 0 && state.released) this.states.delete(lease.key);
  }

  require(key: string, revision: number): void {
    const state = this.stateFor(key);
    state.released = false;
    state.minimumRevision = Math.max(revision, state.minimumRevision);
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

  satisfy(key: string, revision: number): void {
    const state = this.states.get(key);
    if (!state || !this.accepts(key, revision)) return;
    state.minimumRevision = 0;
  }

  release(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    state.generation += 1;
    state.minimumRevision = 0;
    state.released = true;
    if (state.pending === 0) this.states.delete(key);
  }

  clear(): void {
    this.states.clear();
    this.contiguousCommitRevision = null;
    this.outOfOrderCommits.clear();
  }

  initializeCommitDelivery(worldRevision: number): void {
    if (this.contiguousCommitRevision === null) this.contiguousCommitRevision = worldRevision;
  }

  shouldPublishCommit(worldRevision: number): boolean {
    if (this.contiguousCommitRevision === null) this.contiguousCommitRevision = worldRevision - 1;
    if (worldRevision <= this.contiguousCommitRevision || this.outOfOrderCommits.has(worldRevision)) return false;
    this.outOfOrderCommits.add(worldRevision);
    while (this.outOfOrderCommits.delete(this.contiguousCommitRevision + 1)) this.contiguousCommitRevision += 1;
    return true;
  }

  private stateFor(key: string): AuthorityCollisionRevisionState {
    let state = this.states.get(key);
    if (!state) {
      state = { generation: 0, minimumRevision: 0, pending: 0, released: false };
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
    commit.structuralChange?.chunkRevisions.forEach(({ key, revision }) => guard?.require(key, revision));
    applyAuthorityCollisionCommit(commit, {
      getChunk: (key) => chunks.get(key),
      invalidateChunk: (key) => chunks.delete(key),
      requestBaseline: (key) => {
        if (requestedBaselines.has(key)) return;
        requestedBaselines.add(key);
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
