import { CHUNK_SIZE, chunkKey, floorDiv } from '@seedlands/stdlib/world/voxel';
import type { AuthorityCropStageProjection } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type {
  PackPresentationCrop,
  PackPresentationCropStage,
} from '../../client/presentation/pack-presentation-loader';

export type CropStageBatch = Readonly<{
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  presentationId: string;
  stage: number;
  definition: PackPresentationCropStage;
  positions: readonly (readonly [number, number, number])[];
}>;
export type CropStageAdapter<Resource> = Readonly<{
  create(batch: CropStageBatch): Resource;
  destroy(resource: Resource): void;
}>;

/** Only derived GPU resources are retained. Crop state stays in the accepted authority view. */
export class CropStagePresenter<Resource> {
  private readonly resources = new Map<string, { signature: string; resource: Resource }>();
  private epoch: string | null = null;
  private disposed = false;

  constructor(
    private readonly definitions: Readonly<Record<string, PackPresentationCrop>>,
    private readonly adapter: CropStageAdapter<Resource>,
  ) {}

  update(epoch: string, projections: readonly AuthorityCropStageProjection[], residentChunkKeys: Iterable<string>) {
    if (this.disposed) return;
    if (epoch !== this.epoch) {
      this.clear();
      this.epoch = epoch;
    }
    const pending = new Map<string, { signature: string; resource: Resource }>();
    try {
      const resident = new Set(residentChunkKeys);
      const batches = new Map<string, CropStageBatch>();
      const cells = new Set<string>();
      for (const crop of projections) {
        if (crop.presentationId === undefined) continue;
        const { position, stage, presentationId } = crop;
        if (
          !Array.isArray(position) ||
          position.length !== 3 ||
          !position.every(Number.isSafeInteger) ||
          !Number.isSafeInteger(stage) ||
          stage < 0 ||
          stage > 7 ||
          !Object.hasOwn(this.definitions, presentationId)
        )
          throw new TypeError('Crop presentation projection is invalid.');
        const definition = this.definitions[presentationId]!.stages[stage];
        if (!definition || cells.has(position.join(','))) throw new TypeError('Crop presentation cell is invalid.');
        cells.add(position.join(','));
        const [cx, cy, cz] = position.map((coordinate) => floorDiv(coordinate, CHUNK_SIZE)) as [number, number, number];
        const key = chunkKey(cx, cy, cz);
        if (!resident.has(key)) continue;
        const id = JSON.stringify([key, presentationId, stage]);
        const previous = batches.get(id);
        const detached = Object.freeze([...position] as [number, number, number]);
        batches.set(id, {
          chunkKey: key,
          cx,
          cy,
          cz,
          presentationId,
          stage,
          definition,
          positions: [...(previous?.positions ?? []), detached],
        });
      }
      const desired = new Map<string, string>();
      for (const [id, batch] of batches) {
        const positions = Object.freeze([...batch.positions].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]));
        const frozen = Object.freeze({ ...batch, positions });
        const signature = JSON.stringify(frozen);
        desired.set(id, signature);
        if (this.resources.get(id)?.signature !== signature)
          pending.set(id, { signature, resource: this.adapter.create(frozen) });
      }
      for (const [id, current] of this.resources) {
        if (desired.get(id) === current.signature) continue;
        this.adapter.destroy(current.resource);
        this.resources.delete(id);
      }
      for (const [id, next] of pending) this.resources.set(id, next);
    } catch (error) {
      for (const next of pending.values()) this.adapter.destroy(next.resource);
      this.clear();
      throw error;
    }
  }

  clear() {
    for (const current of this.resources.values()) this.adapter.destroy(current.resource);
    this.resources.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }
}
