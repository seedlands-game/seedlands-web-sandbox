import { describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, chunkKey } from '@seedlands/stdlib/world/voxel';
import type { AuthorityCropStageProjection } from '../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { PackPresentationCrop } from '../../../src/client/presentation/pack-presentation-loader';
import type {
  CropRenderBatchSnapshot,
  CropRenderResource,
  PlayCanvasCropPresentation,
} from '../../../src/app/world/playcanvas-crop-stage-adapter';
import { WorldCropPresentation } from '../../../src/app/world/world-crop-presentation';

const key = chunkKey(0, 0, 0);
const crop: PackPresentationCrop = {
  id: 'sample:crop',
  stages: Array.from({ length: 8 }, (_, stage) => ({ texture: `crop/${stage}.svg`, height: 0.5, width: 0.4 })),
};
const definitions = { 'sample:crop': crop };
const projection = (position: readonly [number, number, number] = [1, 2, 3]): AuthorityCropStageProjection => ({
  position,
  stage: 0,
  presentationId: 'sample:crop',
});

function fixture() {
  const resources: CropRenderResource[] = [];
  const snapshots = new Map<CropRenderResource, CropRenderBatchSnapshot>();
  const lightTexture = (id: string) => ({ id, destroy: vi.fn() });
  const lights = new Map<string, NonNullable<Parameters<PlayCanvasCropPresentation['bindChunkLight']>[1]>>();
  const firstLight = {
    blockLightTexture: lightTexture('first'),
    blockLightOrigin: new Float32Array([0, 0, 0]),
    blockLightSize: 34,
  } as unknown as NonNullable<Parameters<PlayCanvasCropPresentation['bindChunkLight']>[1]>;
  const secondLight = {
    blockLightTexture: lightTexture('replacement'),
    blockLightOrigin: new Float32Array([1, 0, 0]),
    blockLightSize: 34,
  } as unknown as NonNullable<Parameters<PlayCanvasCropPresentation['bindChunkLight']>[1]>;
  lights.set(key, firstLight);
  const create = vi.fn((batch) => {
    const resource = {
      chunkKey: batch.chunkKey,
      entity: { destroy: vi.fn() },
      mesh: { destroy: vi.fn() },
      instance: { setParameter: vi.fn() },
    } as unknown as CropRenderResource;
    resources.push(resource);
    snapshots.set(resource, {
      chunkKey: batch.chunkKey,
      presentationId: batch.presentationId,
      stage: batch.stage,
      positions: batch.positions,
      vertexCount: batch.positions.length * 8,
      indexCount: batch.positions.length * 12,
      enabled: true,
      lightingBound: true,
    });
    return resource;
  });
  const destroy = vi.fn((resource: CropRenderResource) => {
    snapshots.delete(resource);
    resource.entity.destroy();
    resource.mesh.destroy();
  });
  const bindChunkLight = vi.fn((_chunkKey: string, light: typeof firstLight | undefined) => {
    if (!light) throw new Error('light brick is not resident');
  });
  const adapterDispose = vi.fn();
  const onError = vi.fn();
  const presentation: PlayCanvasCropPresentation = {
    definitions,
    create,
    destroy,
    bindChunkLight,
    snapshot: vi.fn(() => Object.freeze([...snapshots.values()])),
    dispose: adapterDispose,
  };
  const world = new WorldCropPresentation(
    { resources: presentation, onError },
    (chunkKey) => lights.get(chunkKey),
    () => [key],
  );
  return {
    world,
    create,
    destroy,
    bindChunkLight,
    adapterDispose,
    onError,
    resources,
    lights,
    firstLight,
    secondLight,
  };
}

describe('World crop presentation resource coordination', () => {
  it('binds resident crop batches to borrowed terrain light and replaces that binding without rebuilding', () => {
    const test = fixture();
    test.world.update('epoch-a', [projection()]);
    expect(test.create).toHaveBeenCalledTimes(1);
    expect(test.world.snapshot).toEqual([
      {
        chunkKey: key,
        presentationId: 'sample:crop',
        stage: 0,
        positions: [[1, 2, 3]],
        vertexCount: 8,
        indexCount: 12,
        enabled: true,
        lightingBound: true,
      },
    ]);
    expect(test.bindChunkLight).toHaveBeenCalledWith(key, test.firstLight);

    test.lights.set(key, test.secondLight);
    test.world.bindLight(key);

    expect(test.bindChunkLight).toHaveBeenCalledTimes(2);
    expect(test.bindChunkLight).toHaveBeenLastCalledWith(key, test.secondLight);
    expect(test.create).toHaveBeenCalledTimes(1);
    expect(test.destroy).not.toHaveBeenCalled();
    expect(test.firstLight.blockLightTexture!.destroy).not.toHaveBeenCalled();
    expect(test.secondLight.blockLightTexture!.destroy).not.toHaveBeenCalled();

    test.world.update('epoch-a', []);
    expect(test.destroy).toHaveBeenCalledTimes(1);
    expect(test.world.snapshot).toEqual([]);
    expect(test.adapterDispose).not.toHaveBeenCalled();
  });

  it('clears all batches and reports once on bind failure, then reset permits a fresh update', () => {
    const test = fixture();
    let failBind = true;
    test.bindChunkLight.mockImplementation((_chunkKey, light) => {
      if (!light || failBind) throw new Error('terrain bind failed');
    });

    test.world.update('epoch-a', [projection()]);

    expect(test.onError).toHaveBeenCalledTimes(1);
    expect(test.world.snapshot).toEqual([]);
    expect(test.create).toHaveBeenCalledTimes(1);
    expect(test.destroy).toHaveBeenCalledTimes(1);
    expect(test.resources[0]!.entity.destroy).toHaveBeenCalledTimes(1);
    expect(test.resources[0]!.mesh.destroy).toHaveBeenCalledTimes(1);
    test.world.update('epoch-a', [projection([2, 2, 3])]);
    test.world.bindLight(key);
    expect(test.create).toHaveBeenCalledTimes(1);
    expect(test.bindChunkLight).toHaveBeenCalledTimes(1);
    expect(test.onError).toHaveBeenCalledTimes(1);

    failBind = false;
    test.world.reset();
    test.world.update('epoch-a', [projection([2, 2, 3])]);
    expect(test.create).toHaveBeenCalledTimes(2);
    expect(test.onError).toHaveBeenCalledTimes(1);
    expect(test.destroy).toHaveBeenCalledTimes(1);
    test.world.dispose();
    expect(test.destroy).toHaveBeenCalledTimes(2);
    expect(test.world.snapshot).toEqual([]);
  });

  it('terminates late update, bind, and reset work after dispose without disposing shared presentation assets', () => {
    const test = fixture();
    test.world.update('epoch-a', [projection()]);
    test.world.dispose();
    expect(test.world.snapshot).toEqual([]);
    expect(test.destroy).toHaveBeenCalledTimes(1);
    expect(test.adapterDispose).not.toHaveBeenCalled();

    test.world.update('epoch-b', [projection([CHUNK_SIZE, 0, 0])]);
    test.world.bindLight(key);
    test.world.reset();

    expect(test.create).toHaveBeenCalledTimes(1);
    expect(test.bindChunkLight).toHaveBeenCalledTimes(1);
    expect(test.destroy).toHaveBeenCalledTimes(1);
  });
});
