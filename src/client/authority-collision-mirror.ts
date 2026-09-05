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

export class AuthorityCollisionRevisionGuard {
  private readonly minimum = new Map<string, number>();
  private readonly pending = new Map<string, number>();
  private readonly released = new Set<string>();

  beginBaseline(key: string): () => void {
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    return () => {
      const remaining = (this.pending.get(key) ?? 1) - 1;
      if (remaining > 0) this.pending.set(key, remaining);
      else {
        this.pending.delete(key);
        if (this.released.delete(key)) this.minimum.delete(key);
      }
    };
  }

  require(key: string, revision: number): void {
    this.minimum.set(key, Math.max(revision, this.minimum.get(key) ?? 0));
  }

  accepts(key: string, revision: number): boolean {
    return revision >= (this.minimum.get(key) ?? 0);
  }

  satisfy(key: string, revision: number): void {
    if (this.accepts(key, revision)) this.minimum.delete(key);
    this.released.delete(key);
  }

  release(key: string): void {
    if (this.pending.has(key)) this.released.add(key);
    else this.minimum.delete(key);
  }

  clear(): void {
    this.minimum.clear();
    this.pending.clear();
    this.released.clear();
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
  const finish = options.guard.beginBaseline(options.key);
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
    );
    return true;
  } finally {
    finish();
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
): boolean {
  if (guard && !guard.accepts(key, baseline.chunkRevision)) return false;
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
