import type { ChunkPersistence } from './persistence/chunk-persistence';
import type { EntityStore } from './gameplay/entity-store';
import type { CanonicalChunkResidency } from './chunk-residency';
import { stationChunkKeys } from './station-world-integrity';

/** Stations stay simulated in this phase, so their canonical voxel chunks remain resident too. */
export class StationWorldResidency {
  constructor(
    private readonly entities: EntityStore,
    private readonly residency: CanonicalChunkResidency,
  ) {}
  refresh(): void {
    this.residency.replacePins('stations', stationChunkKeys(this.entities));
  }
  async restore(
    persistence: ChunkPersistence | undefined,
    load: (cx: number, cy: number, cz: number) => unknown,
  ): Promise<void> {
    this.refresh();
    for (const key of stationChunkKeys(this.entities)) {
      const [cx, cy, cz] = key.split(',').map(Number);
      if (persistence?.ensureSnapshot) await persistence.ensureSnapshot(cx, cy, cz);
      else await persistence?.ensureNeighborhood?.(cx, cy, cz);
      load(cx, cy, cz);
    }
  }
}
