export const DEFAULT_CANONICAL_CHUNK_TARGET = 256;
export const DEFAULT_CANONICAL_CHUNK_HARD_LIMIT = 2_048;
export const DEFAULT_CANONICAL_CHUNK_EVICTION_BATCH = 32;

export class CanonicalChunkResidencyPressureError extends Error {
  constructor(readonly chunkKey: string) {
    super(`Canonical Chunk admission is paused under residency pressure: ${chunkKey}.`);
    this.name = 'CanonicalChunkResidencyPressureError';
  }
}

export type CanonicalChunkResidencyLimits = Readonly<{
  target: number;
  hardLimit: number;
  evictionBatch: number;
}>;

export type CanonicalResidencyChunk = {
  key: string;
  accessEpoch: number;
  revision: number;
  persistedRevision: number;
  dirty: boolean;
};

export type CanonicalChunkEviction = Readonly<{
  key: string;
  chunk: CanonicalResidencyChunk;
  accessEpoch: number;
  revision: number;
}>;

export type CanonicalChunkResidencyDiagnostics = Readonly<{
  residentCount: number;
  target: number;
  hardLimit: number;
  pinnedCount: number;
  dirtyCount: number;
  evictableCleanCount: number;
  evictionCount: number;
  rejectedAdmissionCount: number;
  oversubscribed: boolean;
}>;

type PinOwner = 'streaming' | 'physics' | 'fluid';

const assertLimit = (value: number, name: string, allowZero = false) => {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new RangeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer.`);
};

export class CanonicalChunkResidency {
  readonly limits: CanonicalChunkResidencyLimits;
  private readonly pins: Record<PinOwner, Set<string>> = {
    streaming: new Set(),
    physics: new Set(),
    fluid: new Set(),
  };
  private readonly meshPins = new Map<string, number>();
  private readonly preparationPins = new Map<string, number>();
  private evictionCount = 0;
  private rejectedAdmissionCount = 0;

  constructor(limits: Partial<CanonicalChunkResidencyLimits> = {}) {
    const target = limits.target ?? DEFAULT_CANONICAL_CHUNK_TARGET;
    const hardLimit = limits.hardLimit ?? DEFAULT_CANONICAL_CHUNK_HARD_LIMIT;
    const evictionBatch = limits.evictionBatch ?? DEFAULT_CANONICAL_CHUNK_EVICTION_BATCH;
    assertLimit(target, 'Canonical Chunk target', true);
    assertLimit(hardLimit, 'Canonical Chunk hard limit');
    assertLimit(evictionBatch, 'Canonical Chunk eviction batch');
    if (hardLimit < target) throw new RangeError('Canonical Chunk hard limit must be at least the target.');
    this.limits = Object.freeze({ target, hardLimit, evictionBatch });
  }

  replacePins(owner: PinOwner, keys: Iterable<string>): void {
    this.pins[owner] = new Set(keys);
  }

  retainMesh(key: string): void {
    this.meshPins.set(key, (this.meshPins.get(key) ?? 0) + 1);
  }

  releaseMesh(key: string): void {
    const count = this.meshPins.get(key);
    if (!count) return;
    if (count === 1) this.meshPins.delete(key);
    else this.meshPins.set(key, count - 1);
  }

  retainPreparation(key: string): void {
    this.preparationPins.set(key, (this.preparationPins.get(key) ?? 0) + 1);
  }

  releasePreparation(key: string): void {
    const count = this.preparationPins.get(key);
    if (!count) return;
    if (count === 1) this.preparationPins.delete(key);
    else this.preparationPins.set(key, count - 1);
  }

  isPinned(key: string): boolean {
    return (
      Boolean(this.meshPins.get(key)) ||
      Boolean(this.preparationPins.get(key)) ||
      Object.values(this.pins).some((keys) => keys.has(key))
    );
  }

  planEvictions<Chunk extends CanonicalResidencyChunk>(chunks: ReadonlyMap<string, Chunk>): CanonicalChunkEviction[] {
    const count = Math.min(this.limits.evictionBatch, Math.max(0, chunks.size - this.limits.target));
    if (!count) return [];
    return [...chunks.values()]
      .filter((chunk) => this.isCleanAndUnpinned(chunk))
      .sort((left, right) => left.accessEpoch - right.accessEpoch || left.key.localeCompare(right.key))
      .slice(0, count)
      .map((chunk) => ({ key: chunk.key, chunk, accessEpoch: chunk.accessEpoch, revision: chunk.revision }));
  }

  isEvictionStillValid<Chunk extends CanonicalResidencyChunk>(
    chunks: ReadonlyMap<string, Chunk>,
    candidate: CanonicalChunkEviction,
  ): boolean {
    const current = chunks.get(candidate.key);
    return (
      current === candidate.chunk &&
      current.accessEpoch === candidate.accessEpoch &&
      current.revision === candidate.revision &&
      this.isCleanAndUnpinned(current)
    );
  }

  recordEviction(): void {
    this.evictionCount += 1;
  }

  canAdmit(chunks: ReadonlyMap<string, CanonicalResidencyChunk>, key: string): boolean {
    return chunks.has(key) || chunks.size < this.limits.hardLimit;
  }

  recordRejectedAdmission(): void {
    this.rejectedAdmissionCount += 1;
  }

  diagnostics(chunks: ReadonlyMap<string, CanonicalResidencyChunk>): CanonicalChunkResidencyDiagnostics {
    let pinnedCount = 0;
    let dirtyCount = 0;
    let evictableCleanCount = 0;
    chunks.forEach((chunk) => {
      if (this.isPinned(chunk.key)) pinnedCount += 1;
      if (chunk.dirty) dirtyCount += 1;
      if (this.isCleanAndUnpinned(chunk)) evictableCleanCount += 1;
    });
    return {
      residentCount: chunks.size,
      target: this.limits.target,
      hardLimit: this.limits.hardLimit,
      pinnedCount,
      dirtyCount,
      evictableCleanCount,
      evictionCount: this.evictionCount,
      rejectedAdmissionCount: this.rejectedAdmissionCount,
      oversubscribed: chunks.size > this.limits.target,
    };
  }

  private isCleanAndUnpinned(chunk: CanonicalResidencyChunk): boolean {
    return !chunk.dirty && chunk.persistedRevision === chunk.revision && !this.isPinned(chunk.key);
  }
}

export function maintainCanonicalChunks<Chunk extends CanonicalResidencyChunk>(
  residency: CanonicalChunkResidency,
  chunks: ReadonlyMap<string, Chunk>,
  evict: (candidate: CanonicalChunkEviction) => boolean,
): number {
  let evicted = 0;
  for (const candidate of residency.planEvictions(chunks)) {
    if (!residency.isEvictionStillValid(chunks, candidate) || !evict(candidate)) continue;
    residency.recordEviction();
    evicted += 1;
  }
  return evicted;
}
