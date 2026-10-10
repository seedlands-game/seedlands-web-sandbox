import { describe, expect, it, vi } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { ChunkBlockLightCache } from '../../../src/app/scene/block-light-volume';
import { classicContent } from '../../fixtures/classic/content';
import { World } from '../../../src/app/world/world-runtime';
import {
  invalidateChunkBlockLightVolume,
  type PlayCanvasChunkResource,
} from '../../../src/app/world/playcanvas-chunk-adapter';
import { BLOCK_LIGHT_VOLUME_SIZE } from '../../../src/app/scene/block-light-volume';

function fixture() {
  let revision = 'resident:1';
  const cache = new ChunkBlockLightCache({
    getVoxelIfLoaded: (x, y, z) => (x === 1 && y === 0 && z === 0 ? Voxel.Torch : Voxel.Air),
    blockLightRevision: () => revision,
    voxelSemantics: classicContent.voxelSemantics,
  });
  const dark = vi.fn();
  cache.register('0,0,0', 0, 0, 0, { apply: vi.fn(), failDark: dark });
  cache.rebuildNearest([0, 0, 0]);
  return { cache, dark, edit: () => (revision = 'resident:2') };
}

describe('同owner block-light sink立即失效', () => {
  it('实际World drain先刷新source新鲜度，再发布mesh/crop及请求重建', () => {
    const order: string[] = [];
    const receiver = {
      blockLightCache: { invalidateStale: () => order.push('invalidate') },
      repository: { drain: () => order.push('mesh') },
      crops: { update: () => order.push('crop') },
      scenarioId: 'invalidation-boundary',
      authority: { gameplay: { cropStages: [] } },
      blockLightRebuildPump: { request: () => order.push('pump') },
    };
    World.prototype.drainCommits.call(receiver as unknown as World, [0, 0, 0]);
    expect(order).toEqual(['invalidate', 'mesh', 'crop', 'pump']);
  });

  it('显式编辑在下一次重建前暗化一次，同revision控制及重复通知保持幂等', () => {
    const { cache, dark, edit } = fixture();
    cache.invalidateAround(0, 0, 0);
    expect(dark).not.toHaveBeenCalled();
    edit();
    cache.invalidateAround(0, 0, 0);
    expect(dark).toHaveBeenCalledTimes(1);
    cache.invalidateAround(0, 0, 0);
    expect(dark).toHaveBeenCalledTimes(1);
  });

  it('另一陈旧brick先重建时，原brick也必须先暗化', () => {
    const { cache, dark, edit } = fixture();
    cache.register('4,0,0', 4, 0, 0, { apply: vi.fn(), failDark: vi.fn() });
    cache.rebuildNearest([128, 0, 0]);
    edit();
    expect(cache.rebuildNearest([128, 0, 0])).toBe(true);
    expect(dark).toHaveBeenCalledTimes(1);
    expect(cache.snapshot.pendingBrickCount).toBe(1);
  });

  it('只读diagnostics不触发失效，显式source刷新在通知前暗化且幂等', () => {
    const { cache, dark, edit } = fixture();
    edit();
    expect(cache.diagnostics.pendingBrickCount).toBe(1);
    expect(dark).not.toHaveBeenCalled();
    cache.invalidateStale();
    cache.invalidateStale();
    expect(dark).toHaveBeenCalledTimes(1);
    expect(cache.rebuildNearest([0, 0, 0])).toBe(true);
    expect(cache.sample([0, 0, 0])).toBe(13);
    expect(cache.snapshot.ready).toBe(true);
  });

  it('失效上传失败继续暴露错误，下次调用可重试且未伪造重建成功', () => {
    let revision = 'resident:1';
    const dark = vi.fn().mockImplementationOnce(() => {
      throw new Error('upload failed');
    });
    const cache = new ChunkBlockLightCache({
      getVoxelIfLoaded: () => Voxel.Air,
      blockLightRevision: () => revision,
      voxelSemantics: classicContent.voxelSemantics,
    });
    cache.register('0,0,0', 0, 0, 0, { apply: vi.fn(), failDark: dark });
    cache.rebuildNearest([0, 0, 0]);
    revision = 'resident:2';
    expect(() => cache.invalidateAround(0, 0, 0)).toThrow('upload failed');
    expect(cache.snapshot).toMatchObject({ ready: false, rebuildCount: 1 });
    expect(() => cache.invalidateStale()).not.toThrow();
    expect(dark).toHaveBeenCalledTimes(2);
    expect(cache.snapshot).toMatchObject({ ready: false, rebuildCount: 1 });
  });

  it('实际R8清零桥保留借用texture及原origin/size，只提交一次清零', () => {
    const pixels = new Uint8Array(BLOCK_LIGHT_VOLUME_SIZE ** 3).fill(255);
    const texture = { lock: vi.fn(() => pixels), unlock: vi.fn() };
    const origin = new Float32Array([-16, -16, -16]);
    const resource = {
      blockLightTexture: texture,
      blockLightOrigin: origin,
      blockLightSize: BLOCK_LIGHT_VOLUME_SIZE,
    } as unknown as PlayCanvasChunkResource;
    const borrower = { texture: resource.blockLightTexture };
    invalidateChunkBlockLightVolume(resource);
    expect(pixels.every((value) => value === 0)).toBe(true);
    expect(texture.lock).toHaveBeenCalledTimes(1);
    expect(texture.unlock).toHaveBeenCalledTimes(1);
    expect(borrower.texture).toBe(resource.blockLightTexture);
    expect(resource.blockLightOrigin).toBe(origin);
    expect(resource.blockLightSize).toBe(BLOCK_LIGHT_VOLUME_SIZE);
  });
});
