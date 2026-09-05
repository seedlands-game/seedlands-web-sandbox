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
  structuralChange: Readonly<{
    chunks: readonly string[];
    chunkRevisions: readonly Readonly<{ key: string; revision: number }>[];
  }> | null;
  collisionDelta?: readonly AuthorityCollisionDelta[];
}>;

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
): void {
  chunks.set(key, installAuthorityCollisionBaseline(chunks.get(key), baseline));
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
): void {
  if (!commits?.length) return;
  const requestedBaselines = new Set<string>();
  for (const commit of commits) {
    applyAuthorityCollisionCommit(commit, {
      getChunk: (key) => chunks.get(key),
      invalidateChunk: (key) => chunks.delete(key),
      requestBaseline: (key) => {
        if (requestedBaselines.has(key)) return;
        requestedBaselines.add(key);
        callbacks.onUnknownChunk?.(key);
      },
    });
    callbacks.onCommit?.(commit);
  }
}
