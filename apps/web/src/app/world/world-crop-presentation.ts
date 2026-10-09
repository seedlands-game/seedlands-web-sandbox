import type { AuthorityCropStageProjection } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { CropStagePresenter } from './crop-stage-presenter';
import type { CropRenderResource, PlayCanvasCropPresentation } from './playcanvas-crop-stage-adapter';

export type CropPresentationBindings = Readonly<{
  resources: PlayCanvasCropPresentation;
  onError(error: Error): void;
}>;
type ChunkLighting = Parameters<PlayCanvasCropPresentation['bindChunkLight']>[1];

/** Couples derived crop resources to the existing terrain lifetime and borrowed lighting. */
export class WorldCropPresentation {
  private readonly presenter: CropStagePresenter<CropRenderResource>;
  private failed = false;
  private disposed = false;

  constructor(
    private readonly bindings: CropPresentationBindings,
    private readonly lighting: (key: string) => ChunkLighting,
    private readonly residentKeys: () => Iterable<string>,
  ) {
    this.presenter = new CropStagePresenter(bindings.resources.definitions, {
      create: (batch) => {
        const resource = bindings.resources.create(batch);
        try {
          bindings.resources.bindChunkLight(batch.chunkKey, lighting(batch.chunkKey));
          return resource;
        } catch (error) {
          bindings.resources.destroy(resource);
          throw error;
        }
      },
      destroy: (resource) => bindings.resources.destroy(resource),
    });
  }

  update(epoch: string, crops: readonly AuthorityCropStageProjection[]) {
    if (this.failed || this.disposed) return;
    try {
      this.presenter.update(epoch, crops, this.residentKeys());
    } catch (error) {
      this.fail(error);
    }
  }

  bindLight(key: string) {
    if (this.failed || this.disposed) return;
    try {
      this.bindings.resources.bindChunkLight(key, this.lighting(key));
    } catch (error) {
      this.fail(error);
    }
  }

  reset() {
    if (this.disposed) return;
    this.presenter.clear();
    this.failed = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.presenter.dispose();
  }

  private fail(error: unknown) {
    this.failed = true;
    this.presenter.clear();
    this.bindings.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
