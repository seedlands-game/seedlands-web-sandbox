import type { Collider, FluidVolume, PhysicsWorld, WorldAabb } from '../../physics';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import { collisionBoxesForVoxel } from '../../world/voxel-model';
import { waterSurfaceHeight } from '../../world/water-mesh-height';

export type LoadedVoxel = Readonly<{
  voxel: number;
  chunkKey: string;
  revision: number;
  fluid?: Readonly<{ level: number; flow?: Readonly<{ x: number; y: number; z: number }> }>;
}>;

export type LoadedVoxelSource = Readonly<{
  getLoadedVoxel: (x: number, y: number, z: number) => LoadedVoxel | null;
  getChunkRevision?: (key: string) => number | null;
}>;

const queryRange = (minimum: number, maximum: number) => {
  const from = Math.floor(minimum);
  const to = Math.floor(maximum - Number.EPSILON);
  return { from, to };
};

export class VoxelCollisionWorld implements PhysicsWorld {
  private readonly revisions = new Map<string, number>();
  private readonly touchedChunkKeys = new Set<string>();

  constructor(
    private readonly source: LoadedVoxelSource,
    private readonly requestUnknownChunk: (chunkKey: string) => void = () => undefined,
  ) {}

  beginStep(): void {
    this.revisions.clear();
    this.touchedChunkKeys.clear();
  }

  get activeChunkKeys(): readonly string[] {
    return [...this.touchedChunkKeys].sort((left, right) => left.localeCompare(right));
  }

  querySolids(bounds: WorldAabb): readonly Collider[] {
    const colliders: Collider[] = [];
    const requested = new Set<string>();
    const xRange = queryRange(bounds.min.x, bounds.max.x);
    const yRange = queryRange(bounds.min.y, bounds.max.y);
    const zRange = queryRange(bounds.min.z, bounds.max.z);
    for (let x = xRange.from; x <= xRange.to; x += 1)
      for (let y = yRange.from; y <= yRange.to; y += 1)
        for (let z = zRange.from; z <= zRange.to; z += 1) {
          this.touch(x, y, z);
          const loaded = this.source.getLoadedVoxel(x, y, z);
          if (!loaded) {
            const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
            if (!requested.has(key)) {
              requested.add(key);
              this.requestUnknownChunk(key);
            }
            colliders.push({
              id: `unknown:${x},${y},${z}`,
              aabb: { min: { x, y, z }, max: { x: x + 1, y: y + 1, z: z + 1 } },
            });
            continue;
          }
          this.revisions.set(loaded.chunkKey, loaded.revision);
          collisionBoxesForVoxel(loaded.voxel).forEach((box, index) => {
            colliders.push({
              id: `voxel:${x},${y},${z}:${index}`,
              aabb: {
                min: { x: x + box.min[0], y: y + box.min[1], z: z + box.min[2] },
                max: { x: x + box.max[0], y: y + box.max[1], z: z + box.max[2] },
              },
            });
          });
        }
    return colliders;
  }

  sampleFluid(bounds: WorldAabb): readonly FluidVolume[] {
    const fluids: FluidVolume[] = [];
    const xRange = queryRange(bounds.min.x, bounds.max.x);
    const yRange = queryRange(bounds.min.y, bounds.max.y);
    const zRange = queryRange(bounds.min.z, bounds.max.z);
    for (let x = xRange.from; x <= xRange.to; x += 1)
      for (let y = yRange.from; y <= yRange.to; y += 1)
        for (let z = zRange.from; z <= zRange.to; z += 1) {
          this.touch(x, y, z);
          const loaded = this.source.getLoadedVoxel(x, y, z);
          if (!loaded?.fluid || loaded.fluid.level <= 0) continue;
          this.touch(x, y + 1, z);
          const above = this.source.getLoadedVoxel(x, y + 1, z);
          const coveredByWater = Boolean(above?.fluid && above.fluid.level > 0);
          const surfaceY = y + waterSurfaceHeight(loaded.fluid.level, coveredByWater);
          this.revisions.set(loaded.chunkKey, loaded.revision);
          fluids.push({
            aabb: {
              min: { x, y, z },
              max: { x: x + 1, y: surfaceY, z: z + 1 },
            },
            velocity: loaded.fluid.flow ?? { x: 0, y: 0, z: 0 },
            ...(above && !coveredByWater ? { surfaceY } : {}),
          });
        }
    return fluids;
  }

  revisionVector(keys?: Iterable<string>): Readonly<Record<string, number>> {
    if (!keys) return Object.fromEntries([...this.revisions].sort(([left], [right]) => left.localeCompare(right)));
    const revisions: Array<[string, number]> = [];
    for (const key of keys) {
      const revision = this.source.getChunkRevision?.(key) ?? this.revisions.get(key);
      if (revision !== undefined && revision !== null) revisions.push([key, revision]);
    }
    return Object.fromEntries(revisions.sort(([left], [right]) => left.localeCompare(right)));
  }

  private touch(x: number, y: number, z: number): void {
    this.touchedChunkKeys.add(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
  }
}
