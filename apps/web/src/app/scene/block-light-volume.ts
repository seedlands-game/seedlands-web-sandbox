import { buildBlockLightVolume, sampleBlockLight, type BlockLightVolume } from '@seedlands/stdlib/world/voxel-light';
import type { VoxelSemanticsResolver } from '@seedlands/stdlib/world/voxel-semantics';
import { chunkKey, floorDiv } from '@seedlands/stdlib/world/voxel';

/**
 * The camera stays in the middle 32 cells, with a 16-cell propagation halo on
 * each side. Snapping to eight cells leaves at least eight guaranteed cells in
 * either horizontal direction before the camera crosses an inner boundary.
 */
export const BLOCK_LIGHT_VOLUME_SIZE = 64;
export const BLOCK_LIGHT_VOLUME_INNER_SIZE = 32;
export const BLOCK_LIGHT_VOLUME_GRID = 8;
export const BLOCK_LIGHT_MAX_LEVEL = 15;
export const BLOCK_LIGHT_R8_SCALE = 255 / BLOCK_LIGHT_MAX_LEVEL;
/** A rendered chunk has a 32-cell core and a 16-cell propagation halo per side. */
export const BLOCK_LIGHT_CHUNK_CORE_SIZE = 32;
export const BLOCK_LIGHT_CHUNK_HALO_SIZE = 16;
export const BLOCK_LIGHT_CHUNK_BRICK_BYTES = BLOCK_LIGHT_VOLUME_SIZE ** 3;

/** Encodes the stdlib's 0..15 light levels for a WebGL2 R8 UNORM texture. */
export const encodeBlockLightLevelForR8 = (level: number) => {
  if (!Number.isInteger(level) || level < 0 || level > BLOCK_LIGHT_MAX_LEVEL)
    throw new RangeError(`Invalid block light level: ${level}.`);
  return level * BLOCK_LIGHT_R8_SCALE;
};

export type BlockLightVoxelReader = Readonly<{
  getVoxelIfLoaded(x: number, y: number, z: number): number | undefined;
  blockLightRevision(origin: readonly [number, number, number], size: number): string;
  voxelSemantics?: VoxelSemanticsResolver;
}>;

export type CameraBlockLightVolume = Readonly<{
  volume: BlockLightVolume;
  revision: string;
  anchor: readonly [number, number, number];
}>;

const anchorAxis = (value: number) => Math.floor(Math.floor(value) / BLOCK_LIGHT_VOLUME_GRID) * BLOCK_LIGHT_VOLUME_GRID;

export const blockLightAnchorForCamera = (position: readonly [number, number, number]) =>
  [anchorAxis(position[0]), anchorAxis(position[1]), anchorAxis(position[2])] as const;

export const blockLightOriginForAnchor = (anchor: readonly [number, number, number]) =>
  [
    anchor[0] - BLOCK_LIGHT_VOLUME_INNER_SIZE,
    anchor[1] - BLOCK_LIGHT_VOLUME_INNER_SIZE,
    anchor[2] - BLOCK_LIGHT_VOLUME_INNER_SIZE,
  ] as const;

export function buildCameraBlockLightVolume(
  reader: BlockLightVoxelReader,
  position: readonly [number, number, number],
): CameraBlockLightVolume {
  const anchor = blockLightAnchorForCamera(position);
  const origin = blockLightOriginForAnchor(anchor);
  return {
    volume: buildBlockLightVolume(
      BLOCK_LIGHT_VOLUME_SIZE,
      origin,
      (x, y, z) => reader.getVoxelIfLoaded(x, y, z),
      reader.voxelSemantics,
    ),
    revision: reader.blockLightRevision(origin, BLOCK_LIGHT_VOLUME_SIZE),
    anchor,
  };
}

export const cameraBlockLightNeedsRefresh = (
  previous: CameraBlockLightVolume | null,
  reader: BlockLightVoxelReader,
  position: readonly [number, number, number],
) => {
  const anchor = blockLightAnchorForCamera(position);
  if (!previous || previous.anchor.some((value, axis) => value !== anchor[axis])) return true;
  return previous.revision !== reader.blockLightRevision(previous.volume.origin, previous.volume.size);
};

export const sampleCameraBlockLight = (
  snapshot: CameraBlockLightVolume | null,
  position: readonly [number, number, number],
) => (snapshot ? sampleBlockLight(snapshot.volume, position[0], position[1], position[2]) : 0);

export type ChunkBlockLightVolume = Readonly<{
  volume: BlockLightVolume;
  revision: string;
  chunk: readonly [number, number, number];
}>;

export const blockLightOriginForChunk = (cx: number, cy: number, cz: number) =>
  [
    cx * BLOCK_LIGHT_CHUNK_CORE_SIZE - BLOCK_LIGHT_CHUNK_HALO_SIZE,
    cy * BLOCK_LIGHT_CHUNK_CORE_SIZE - BLOCK_LIGHT_CHUNK_HALO_SIZE,
    cz * BLOCK_LIGHT_CHUNK_CORE_SIZE - BLOCK_LIGHT_CHUNK_HALO_SIZE,
  ] as const;

export function buildChunkBlockLightVolume(
  reader: BlockLightVoxelReader,
  cx: number,
  cy: number,
  cz: number,
): ChunkBlockLightVolume {
  const origin = blockLightOriginForChunk(cx, cy, cz);
  return {
    volume: buildBlockLightVolume(
      BLOCK_LIGHT_VOLUME_SIZE,
      origin,
      (x, y, z) => reader.getVoxelIfLoaded(x, y, z),
      reader.voxelSemantics,
    ),
    revision: reader.blockLightRevision(origin, BLOCK_LIGHT_VOLUME_SIZE),
    chunk: [cx, cy, cz],
  };
}

export const chunkBlockLightNeedsRefresh = (
  previous: ChunkBlockLightVolume | null,
  reader: BlockLightVoxelReader,
  cx: number,
  cy: number,
  cz: number,
) => {
  if (!previous || previous.chunk.some((value, axis) => value !== [cx, cy, cz][axis])) return true;
  return previous.revision !== reader.blockLightRevision(previous.volume.origin, previous.volume.size);
};

export type ChunkBlockLightSink = Readonly<{
  apply: (volume: BlockLightVolume) => void;
}>;

type ChunkBlockLightEntry = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  sink: ChunkBlockLightSink;
  snapshot: ChunkBlockLightVolume | null;
};

export type ChunkBlockLightCacheSnapshot = Readonly<{
  brickCount: number;
  allocatedBrickCount: number;
  allocatedBytes: number;
  pendingBrickCount: number;
  ready: boolean;
  rebuildCount: number;
}>;

/**
 * Owns only reconstructible presentation state.  At most one stale brick is
 * rebuilt per call, selected by squared distance to the presentation camera.
 */
export class ChunkBlockLightCache {
  private readonly entries = new Map<string, ChunkBlockLightEntry>();
  private readonly dirty = new Set<string>();
  private rebuildCount = 0;

  constructor(private readonly reader: BlockLightVoxelReader) {}

  register(key: string, cx: number, cy: number, cz: number, sink: ChunkBlockLightSink): () => void {
    const entry = { key, cx, cy, cz, sink, snapshot: null };
    this.entries.set(key, entry);
    this.invalidateAround(cx, cy, cz);
    // Replacement resources share a chunk key. An old resource's delayed
    // destruction must never unregister the newer resource.
    return () => {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
        this.dirty.delete(key);
        this.invalidateAround(cx, cy, cz);
      }
    };
  }

  unregister(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.dirty.delete(key);
    this.invalidateAround(entry.cx, entry.cy, entry.cz);
  }

  invalidateAround(cx: number, cy: number, cz: number): void {
    for (const entry of this.entries.values())
      if (Math.abs(entry.cx - cx) <= 1 && Math.abs(entry.cy - cy) <= 1 && Math.abs(entry.cz - cz) <= 1)
        this.dirty.add(entry.key);
  }

  rebuildNearest(position: readonly [number, number, number]): boolean {
    let selected: ChunkBlockLightEntry | null = null;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (const key of this.dirty) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      const dx = entry.cx * BLOCK_LIGHT_CHUNK_CORE_SIZE + BLOCK_LIGHT_CHUNK_CORE_SIZE / 2 - position[0];
      const dy = entry.cy * BLOCK_LIGHT_CHUNK_CORE_SIZE + BLOCK_LIGHT_CHUNK_CORE_SIZE / 2 - position[1];
      const dz = entry.cz * BLOCK_LIGHT_CHUNK_CORE_SIZE + BLOCK_LIGHT_CHUNK_CORE_SIZE / 2 - position[2];
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < selectedDistance || (distance === selectedDistance && entry.key < (selected?.key ?? ''))) {
        selected = entry;
        selectedDistance = distance;
      }
    }
    if (!selected) return false;
    const snapshot = buildChunkBlockLightVolume(this.reader, selected.cx, selected.cy, selected.cz);
    selected.sink.apply(snapshot.volume);
    selected.snapshot = snapshot;
    this.dirty.delete(selected.key);
    this.rebuildCount += 1;
    return true;
  }

  sample(position: readonly [number, number, number]): number {
    const key = chunkKey(
      floorDiv(position[0], BLOCK_LIGHT_CHUNK_CORE_SIZE),
      floorDiv(position[1], BLOCK_LIGHT_CHUNK_CORE_SIZE),
      floorDiv(position[2], BLOCK_LIGHT_CHUNK_CORE_SIZE),
    );
    const snapshot = this.entries.get(key)?.snapshot;
    return snapshot ? sampleBlockLight(snapshot.volume, position[0], position[1], position[2]) : 0;
  }

  get snapshot(): ChunkBlockLightCacheSnapshot {
    const allocatedBrickCount = this.entries.size;
    const pendingBrickCount = this.dirty.size;
    return {
      brickCount: this.entries.size,
      allocatedBrickCount,
      allocatedBytes: this.entries.size * BLOCK_LIGHT_CHUNK_BRICK_BYTES,
      pendingBrickCount,
      ready: allocatedBrickCount > 0 && pendingBrickCount === 0,
      rebuildCount: this.rebuildCount,
    };
  }

  clear(): void {
    this.entries.clear();
    this.dirty.clear();
  }
}
