import { CHUNK_SIZE, chunkKey, floorDiv } from '../world/voxel';
import type { CanonicalChunkResidency } from './chunk-residency';

type Position = readonly [number, number, number];

/** Media revisions remain authoritative while their device voxel exists. */
export class MediaWorldResidency {
  constructor(
    private readonly positions: () => readonly Position[],
    private readonly residency: CanonicalChunkResidency,
  ) {}

  refresh(): void {
    this.residency.replacePins(
      'media',
      this.positions().map(([x, y, z]) =>
        chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)),
      ),
    );
  }
}
