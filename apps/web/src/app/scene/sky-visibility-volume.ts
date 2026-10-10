import { CHUNK_SIZE, chunkKey } from '@seedlands/stdlib/world/voxel';

export const SKY_VISIBILITY_VOLUME_SIZE = CHUNK_SIZE;
export const SKY_VISIBILITY_VOLUME_BYTES = SKY_VISIBILITY_VOLUME_SIZE ** 3;
export const SKY_VISIBILITY_MAX_COLUMN_HEIGHT = 512;
export const SKY_VISIBILITY_MAX_DEPENDENCIES = 64;

export type SkyVisibilityDependency = Readonly<{
  key: string;
  resident: boolean;
  revision: number | null;
}>;

export type SkyColumnObstructionSample = Readonly<{
  localX: number;
  localZ: number;
  bottomY: number;
  /** Zero is transparent and 255 is fully obstructed. */
  obstruction: Uint8Array;
  /** 0 is unknown, 1 is current loaded data, 2 is authoritative proven empty (zero obstruction). */
  loaded: Uint8Array;
}>;

export type SkyLightingFrame = Readonly<{
  worldTime: number;
  profileScalar: number;
}>;

export type SkyVisibilityVolume = Readonly<{
  chunk: readonly [number, number, number];
  origin: readonly [number, number, number];
  size: typeof SKY_VISIBILITY_VOLUME_SIZE;
  sourceRevision: string;
  visibility: Uint8Array;
}>;

export type SkyVisibilityBuildTicket = Readonly<{
  buildId: number;
  generation: number;
  key: string;
  chunk: readonly [number, number, number];
  sourceRevision: string;
  dependencies: readonly SkyVisibilityDependency[];
  frame: SkyLightingFrame;
  worldTopY: number;
  columns: readonly SkyColumnObstructionSample[];
}>;

export type SkyVisibilityBuildResult =
  | Readonly<{
      ready: false;
      buildId: number;
      generation: number;
      key: string;
      sourceRevision: string;
      reason: 'source-unavailable';
    }>
  | Readonly<{
      ready: true;
      buildId: number;
      generation: number;
      key: string;
      sourceRevision: string;
      volume: SkyVisibilityVolume;
    }>;

export type SkyVisibilitySink = Readonly<{
  failDark(): void;
  publish(volume: SkyVisibilityVolume): void;
  dispose(): void;
}>;

type SkyVisibilityEntry = {
  key: string;
  chunk: readonly [number, number, number];
  dependencyKeys: readonly string[];
  sink: SkyVisibilitySink;
  generation: number;
  latestBuildId: number | null;
  dirty: boolean;
  volume: SkyVisibilityVolume | null;
};

export type SkyVisibilityCacheDiagnostics = Readonly<{
  disposed: boolean;
  dependencyCount: number;
  registeredChunkCount: number;
  readyChunkCount: number;
  dirtyChunkCount: number;
  buildingChunkCount: number;
  allocatedBytes: number;
  maximumBytes: number;
  frame: SkyLightingFrame;
}>;

const canonicalChunkKey = (value: string): boolean => {
  const coordinates = value.split(',').map(Number);
  return (
    coordinates.length === 3 &&
    coordinates.every(Number.isSafeInteger) &&
    value === chunkKey(coordinates[0]!, coordinates[1]!, coordinates[2]!)
  );
};
const validRevision = (value: number | null) => value === null || (Number.isSafeInteger(value) && value >= 0);
const volumeIndex = (x: number, y: number, z: number) =>
  x + SKY_VISIBILITY_VOLUME_SIZE * (y + SKY_VISIBILITY_VOLUME_SIZE * z);

const freezeFrame = (frame: SkyLightingFrame): SkyLightingFrame => {
  if (!Number.isFinite(frame.worldTime)) throw new TypeError('Sky world time must be finite.');
  if (!Number.isFinite(frame.profileScalar) || frame.profileScalar < 0 || frame.profileScalar > 16)
    throw new RangeError('Sky profile scalar must be within 0..16.');
  return Object.freeze({ worldTime: frame.worldTime, profileScalar: frame.profileScalar });
};

const freezeDependency = (dependency: SkyVisibilityDependency): SkyVisibilityDependency => {
  if (
    !canonicalChunkKey(dependency.key) ||
    typeof dependency.resident !== 'boolean' ||
    !validRevision(dependency.revision) ||
    dependency.resident !== (dependency.revision !== null)
  )
    throw new TypeError('Sky visibility dependency is invalid.');
  return Object.freeze({ ...dependency });
};

const sourceRevision = (dependencies: readonly SkyVisibilityDependency[]) =>
  JSON.stringify(dependencies.map(({ key, resident, revision }) => [key, resident ? revision : null]));

function snapshotColumns(
  columns: readonly SkyColumnObstructionSample[],
  bottomY: number,
  worldTopY: number,
): readonly SkyColumnObstructionSample[] {
  const sampleCount = worldTopY - bottomY + 1;
  if (
    !Number.isSafeInteger(worldTopY) ||
    sampleCount < SKY_VISIBILITY_VOLUME_SIZE ||
    sampleCount > SKY_VISIBILITY_MAX_COLUMN_HEIGHT ||
    !Array.isArray(columns) ||
    columns.length !== SKY_VISIBILITY_VOLUME_SIZE ** 2
  )
    throw new TypeError('Sky visibility column coverage is invalid.');
  const seen = new Set<number>();
  return Object.freeze(
    columns.map((column) => {
      if (
        !Number.isInteger(column.localX) ||
        column.localX < 0 ||
        column.localX >= SKY_VISIBILITY_VOLUME_SIZE ||
        !Number.isInteger(column.localZ) ||
        column.localZ < 0 ||
        column.localZ >= SKY_VISIBILITY_VOLUME_SIZE ||
        column.bottomY !== bottomY ||
        !(column.obstruction instanceof Uint8Array) ||
        !(column.loaded instanceof Uint8Array) ||
        column.obstruction.length !== sampleCount ||
        column.loaded.length !== sampleCount
      )
        throw new TypeError('Sky visibility column sample is invalid.');
      const key = column.localX + SKY_VISIBILITY_VOLUME_SIZE * column.localZ;
      if (seen.has(key)) throw new TypeError('Sky visibility columns are duplicated.');
      seen.add(key);
      return Object.freeze({
        localX: column.localX,
        localZ: column.localZ,
        bottomY,
        obstruction: column.obstruction.slice(),
        loaded: column.loaded.slice(),
      });
    }),
  );
}

const sameBuild = (ticket: SkyVisibilityBuildTicket, result: SkyVisibilityBuildResult) =>
  ticket.buildId === result.buildId &&
  ticket.generation === result.generation &&
  ticket.key === result.key &&
  ticket.sourceRevision === result.sourceRevision;

export function buildSkyVisibilityVolume(ticket: SkyVisibilityBuildTicket): SkyVisibilityBuildResult {
  const base = {
    buildId: ticket.buildId,
    generation: ticket.generation,
    key: ticket.key,
    sourceRevision: ticket.sourceRevision,
  };
  if (
    ticket.dependencies.some(({ resident }) => !resident) ||
    ticket.columns.some(({ loaded, obstruction }) =>
      loaded.some((value, index) => value !== 1 && (value !== 2 || obstruction[index] !== 0)),
    )
  )
    return Object.freeze({ ...base, ready: false, reason: 'source-unavailable' });

  const visibility = new Uint8Array(SKY_VISIBILITY_VOLUME_BYTES);
  for (const column of ticket.columns) {
    let transmission = 1;
    for (let offset = column.obstruction.length - 1; offset >= 0; offset -= 1) {
      transmission *= 1 - column.obstruction[offset]! / 255;
      if (offset < SKY_VISIBILITY_VOLUME_SIZE)
        visibility[volumeIndex(column.localX, offset, column.localZ)] = Math.round(transmission * 255);
    }
  }
  return Object.freeze({
    ...base,
    ready: true,
    volume: Object.freeze({
      chunk: ticket.chunk,
      origin: Object.freeze([
        ticket.chunk[0] * SKY_VISIBILITY_VOLUME_SIZE,
        ticket.chunk[1] * SKY_VISIBILITY_VOLUME_SIZE,
        ticket.chunk[2] * SKY_VISIBILITY_VOLUME_SIZE,
      ] as const),
      size: SKY_VISIBILITY_VOLUME_SIZE,
      sourceRevision: ticket.sourceRevision,
      visibility,
    }),
  });
}

export class SkyVisibilityCache {
  private readonly entries = new Map<string, SkyVisibilityEntry>();
  private readonly retiredEntries = new Set<SkyVisibilityEntry>();
  private readonly dependencies = new Map<string, SkyVisibilityDependency>();
  private buildSequence = 0;
  private disposed = false;
  private frame: SkyLightingFrame;

  constructor(
    private readonly maximumChunks: number,
    initialFrame: SkyLightingFrame,
  ) {
    if (!Number.isSafeInteger(maximumChunks) || maximumChunks < 1 || maximumChunks > 4_096)
      throw new RangeError('Sky visibility chunk capacity is invalid.');
    this.frame = freezeFrame(initialFrame);
  }

  setLightingFrame(frame: SkyLightingFrame): void {
    this.assertActive();
    this.frame = freezeFrame(frame);
  }

  setDependency(dependency: SkyVisibilityDependency): void {
    this.assertActive();
    const next = freezeDependency(dependency);
    const consumers = [...this.entries.values(), ...this.retiredEntries];
    if (!consumers.some((entry) => entry.dependencyKeys.includes(next.key)))
      throw new RangeError('Sky visibility dependency has no registered consumer.');
    const previous = this.dependencies.get(next.key);
    if (previous?.resident === next.resident && previous.revision === next.revision) return;
    this.dependencies.set(next.key, next);
    for (const entry of consumers) if (entry.dependencyKeys.includes(next.key)) this.invalidateEntry(entry);
  }

  register(
    key: string,
    chunk: readonly [number, number, number],
    dependencyKeys: readonly string[],
    sink: SkyVisibilitySink,
  ): () => void {
    this.assertActive();
    if (
      !canonicalChunkKey(key) ||
      chunk.length !== 3 ||
      !chunk.every(
        (coordinate) =>
          Number.isSafeInteger(coordinate) && Number.isSafeInteger(coordinate * SKY_VISIBILITY_VOLUME_SIZE),
      ) ||
      key !== chunkKey(...chunk)
    )
      throw new TypeError('Sky visibility chunk registration is invalid.');
    if (
      dependencyKeys.length < 1 ||
      dependencyKeys.length > SKY_VISIBILITY_MAX_DEPENDENCIES ||
      dependencyKeys.some((dependency) => !canonicalChunkKey(dependency)) ||
      new Set(dependencyKeys).size !== dependencyKeys.length
    )
      throw new TypeError('Sky visibility dependency keys are invalid.');
    const previous = this.entries.get(key);
    if (!previous && this.entries.size >= this.maximumChunks)
      throw new RangeError('Sky visibility chunk capacity is exhausted.');
    if (previous) {
      this.entries.delete(key);
      previous.latestBuildId = null;
      previous.volume = null;
      this.retiredEntries.add(previous);
    }
    const entry: SkyVisibilityEntry = {
      key,
      chunk: Object.freeze([...chunk]) as readonly [number, number, number],
      dependencyKeys: Object.freeze([...dependencyKeys].sort()),
      sink,
      generation: 1,
      latestBuildId: null,
      dirty: true,
      volume: null,
    };
    this.entries.set(key, entry);
    this.dropUnusedDependencies();
    sink.failDark();
    return () => {
      if (!this.disposed) this.disposeEntry(entry);
    };
  }

  beginBuild(key: string, worldTopY: number, columns: readonly SkyColumnObstructionSample[]): SkyVisibilityBuildTicket {
    this.assertActive();
    const entry = this.entries.get(key);
    if (!entry) throw new RangeError('Unknown sky visibility chunk: ' + key);
    if (!entry.dirty) throw new Error('Sky visibility chunk is not dirty: ' + key);
    if (this.buildSequence >= Number.MAX_SAFE_INTEGER)
      throw new RangeError('Sky visibility build sequence is exhausted.');
    const dependencies = entry.dependencyKeys.map(
      (dependencyKey) =>
        this.dependencies.get(dependencyKey) ?? Object.freeze({ key: dependencyKey, resident: false, revision: null }),
    );
    const buildId = ++this.buildSequence;
    entry.latestBuildId = buildId;
    return Object.freeze({
      buildId,
      generation: entry.generation,
      key,
      chunk: entry.chunk,
      sourceRevision: sourceRevision(dependencies),
      dependencies: Object.freeze(dependencies),
      frame: this.frame,
      worldTopY,
      columns: snapshotColumns(columns, entry.chunk[1] * SKY_VISIBILITY_VOLUME_SIZE, worldTopY),
    });
  }

  publish(ticket: SkyVisibilityBuildTicket, result: SkyVisibilityBuildResult): boolean {
    this.assertActive();
    const entry = this.entries.get(ticket.key);
    if (
      !entry ||
      entry.generation !== ticket.generation ||
      entry.latestBuildId !== ticket.buildId ||
      sourceRevision(
        entry.dependencyKeys.map((key) => this.dependencies.get(key) ?? { key, resident: false, revision: null }),
      ) !== ticket.sourceRevision ||
      !sameBuild(ticket, result)
    )
      return false;
    entry.latestBuildId = null;
    if (!result.ready || !this.validVolume(entry, result.volume)) return false;
    const cached = this.cloneVolume(result.volume);
    entry.sink.publish(this.cloneVolume(cached));
    entry.volume = cached;
    entry.dirty = false;
    return true;
  }

  sample(key: string, localX: number, localY: number, localZ: number) {
    this.assertActive();
    const entry = this.entries.get(key);
    if (
      !entry ||
      entry.dirty ||
      !entry.volume ||
      ![localX, localY, localZ].every(
        (coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate < SKY_VISIBILITY_VOLUME_SIZE,
      )
    )
      return Object.freeze({ ready: false as const, visibility: 0, receivedSky: 0, ...this.frame });
    const visibility = entry.volume.visibility[volumeIndex(localX, localY, localZ)]! / 255;
    return Object.freeze({
      ready: true as const,
      visibility,
      receivedSky: visibility * this.frame.profileScalar,
      ...this.frame,
    });
  }

  resetForRestore(): void {
    this.assertActive();
    this.dependencies.clear();
    for (const entry of this.entries.values()) this.invalidateEntry(entry);
    for (const entry of this.retiredEntries) this.invalidateEntry(entry);
  }

  unregister(key: string): void {
    if (this.disposed) return;
    const entry = this.entries.get(key);
    if (entry) this.disposeEntry(entry);
  }

  get diagnostics(): SkyVisibilityCacheDiagnostics {
    const values = [...this.entries.values()];
    return Object.freeze({
      disposed: this.disposed,
      dependencyCount: this.dependencies.size,
      registeredChunkCount: values.length,
      readyChunkCount: values.filter((entry) => !entry.dirty && entry.volume !== null).length,
      dirtyChunkCount: values.filter((entry) => entry.dirty).length,
      buildingChunkCount: values.filter((entry) => entry.latestBuildId !== null).length,
      allocatedBytes: values.filter((entry) => entry.volume !== null).length * SKY_VISIBILITY_VOLUME_BYTES,
      maximumBytes: this.maximumChunks * SKY_VISIBILITY_VOLUME_BYTES,
      frame: this.frame,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    for (const entry of [...this.entries.values()]) this.disposeEntry(entry);
    for (const entry of [...this.retiredEntries]) this.disposeEntry(entry);
    this.dependencies.clear();
    this.disposed = true;
  }

  private invalidateEntry(entry: SkyVisibilityEntry): void {
    if (entry.generation >= Number.MAX_SAFE_INTEGER) throw new RangeError('Sky visibility generation is exhausted.');
    const wasPublished = entry.volume !== null || !entry.dirty;
    entry.generation += 1;
    entry.latestBuildId = null;
    entry.dirty = true;
    entry.volume = null;
    if (wasPublished) entry.sink.failDark();
  }

  private disposeEntry(entry: SkyVisibilityEntry): void {
    const active = this.entries.get(entry.key) === entry;
    const retired = this.retiredEntries.delete(entry);
    if (!active && !retired) return;
    if (active) this.entries.delete(entry.key);
    entry.volume = null;
    entry.latestBuildId = null;
    entry.sink.failDark();
    entry.sink.dispose();
    this.dropUnusedDependencies();
  }

  private dropUnusedDependencies(): void {
    const used = new Set([...this.entries.values(), ...this.retiredEntries].flatMap((entry) => entry.dependencyKeys));
    for (const key of this.dependencies.keys()) if (!used.has(key)) this.dependencies.delete(key);
  }

  private validVolume(entry: SkyVisibilityEntry, volume: SkyVisibilityVolume): boolean {
    const expectedOrigin = entry.chunk.map((coordinate) => coordinate * SKY_VISIBILITY_VOLUME_SIZE);
    return (
      volume.size === SKY_VISIBILITY_VOLUME_SIZE &&
      volume.visibility instanceof Uint8Array &&
      volume.visibility.length === SKY_VISIBILITY_VOLUME_BYTES &&
      Array.isArray(volume.chunk) &&
      volume.chunk.length === 3 &&
      volume.chunk.every(Number.isSafeInteger) &&
      Array.isArray(volume.origin) &&
      volume.origin.length === 3 &&
      volume.origin.every(Number.isSafeInteger) &&
      volume.sourceRevision ===
        sourceRevision(
          entry.dependencyKeys.map((key) => this.dependencies.get(key) ?? { key, resident: false, revision: null }),
        ) &&
      volume.chunk.every((coordinate, axis) => coordinate === entry.chunk[axis]) &&
      volume.origin.every((coordinate, axis) => coordinate === expectedOrigin[axis])
    );
  }

  private cloneVolume(volume: SkyVisibilityVolume): SkyVisibilityVolume {
    return Object.freeze({
      ...volume,
      chunk: Object.freeze([...volume.chunk]) as readonly [number, number, number],
      origin: Object.freeze([...volume.origin]) as readonly [number, number, number],
      visibility: volume.visibility.slice(),
    });
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Sky visibility cache is disposed.');
  }
}
