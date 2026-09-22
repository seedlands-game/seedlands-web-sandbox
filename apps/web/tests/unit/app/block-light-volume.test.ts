import { describe, expect, it } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import {
  BLOCK_LIGHT_MAX_LEVEL,
  BLOCK_LIGHT_VOLUME_SIZE,
  BLOCK_LIGHT_CHUNK_BRICK_BYTES,
  ChunkBlockLightCache,
  buildCameraBlockLightVolume,
  buildChunkBlockLightVolume,
  blockLightOriginForChunk,
  cameraBlockLightNeedsRefresh,
  encodeBlockLightLevelForR8,
  sampleCameraBlockLight,
} from '../../../src/app/scene/block-light-volume';

describe('浏览器方块光体积', () => {
  it('将CPU的0到15光级精确编码为R8 UNORM采样值', () => {
    for (const level of [0, 1, 7, BLOCK_LIGHT_MAX_LEVEL]) {
      const sampledByWebGl = encodeBlockLightLevelForR8(level) / 255;
      expect(sampledByWebGl).toBeCloseTo(level / BLOCK_LIGHT_MAX_LEVEL);
    }
  });

  it('用64格体积保留传播halo，并从已加载区块的多个光源合成光照', () => {
    const reader = {
      getVoxelIfLoaded: (x: number, y: number, z: number) =>
        y === 0 && z === 0 && (x === -1 || x === 1) ? Voxel.Torch : Voxel.Air,
      blockLightRevision: () => '0,0,0:7',
    };
    const snapshot = buildCameraBlockLightVolume(reader, [0, 0, 0]);
    expect(snapshot.volume.size).toBe(BLOCK_LIGHT_VOLUME_SIZE);
    expect(snapshot.volume.origin).toEqual([-32, -32, -32]);
    expect(sampleCameraBlockLight(snapshot, [0, 0, 0])).toBe(13);
  });

  it('keeps a negative-direction source in the full propagation halo when the camera is on its positive grid edge', () => {
    const reader = {
      getVoxelIfLoaded: (x: number, y: number, z: number) =>
        x === -30 && y === 0 && z === 0 ? Voxel.Glowstone : Voxel.Air,
      blockLightRevision: () => '0,0,0:9',
    };
    const snapshot = buildCameraBlockLightVolume(reader, [7.9, 0, 0]);
    expect(snapshot.volume.origin[0]).toBe(-32);
    expect(sampleCameraBlockLight(snapshot, [-16, 0, 0])).toBe(1);
  });

  it('对相机锚点、区块revision和未知区块都保持新鲜且fail-closed', () => {
    let revision = '0,0,0:unavailable';
    const reader = {
      getVoxelIfLoaded: () => undefined,
      blockLightRevision: () => revision,
    };
    const snapshot = buildCameraBlockLightVolume(reader, [0, 0, 0]);
    expect(sampleCameraBlockLight(snapshot, [0, 0, 0])).toBe(0);
    expect(cameraBlockLightNeedsRefresh(snapshot, reader, [7.9, 0, 0])).toBe(false);
    expect(cameraBlockLightNeedsRefresh(snapshot, reader, [8, 0, 0])).toBe(true);
    revision = '0,0,0:8';
    expect(cameraBlockLightNeedsRefresh(snapshot, reader, [0, 0, 0])).toBe(true);
  });

  it('为每个chunk建立32格core与16格halo的64³ brick，并把未知邻区封闭为无光', () => {
    const volume = buildChunkBlockLightVolume(
      {
        getVoxelIfLoaded: (x, y, z) => (x === 31 && y === 0 && z === 0 ? Voxel.Glowstone : undefined),
        blockLightRevision: () => 'resident-neighbor:3',
      },
      1,
      0,
      0,
    );
    expect(blockLightOriginForChunk(1, 0, 0)).toEqual([16, -16, -16]);
    expect(volume.volume.origin).toEqual([16, -16, -16]);
    expect(volume.volume.size).toBe(BLOCK_LIGHT_VOLUME_SIZE);
    // The source cell itself survives; the unavailable halo cannot pass light onward.
    expect(volume.volume.levels[15 + BLOCK_LIGHT_VOLUME_SIZE * (16 + BLOCK_LIGHT_VOLUME_SIZE * 16)]).toBe(15);
  });

  it('每帧只重建一个失效brick，按相机距离选择，并在卸载时释放其派生缓存', () => {
    let revision = 'initial';
    const applies: string[] = [];
    const cache = new ChunkBlockLightCache({
      getVoxelIfLoaded: () => Voxel.Air,
      blockLightRevision: () => revision,
    });
    cache.register('far', 4, 0, 0, { apply: () => applies.push('far') });
    cache.register('near', 0, 0, 0, { apply: () => applies.push('near') });

    expect(cache.rebuildNearest([0, 0, 0])).toBe(true);
    expect(applies).toEqual(['near']);
    expect(cache.sample([0, 0, 0])).toBe(0);
    expect(cache.snapshot).toMatchObject({
      brickCount: 2,
      allocatedBrickCount: 2,
      allocatedBytes: 2 * BLOCK_LIGHT_CHUNK_BRICK_BYTES,
      rebuildCount: 1,
    });
    expect(cache.rebuildNearest([0, 0, 0])).toBe(true);
    expect(applies).toEqual(['near', 'far']);
    expect(cache.rebuildNearest([0, 0, 0])).toBe(false);

    revision = 'edited-neighbor';
    cache.invalidateAround(0, 0, 0);
    expect(cache.rebuildNearest([0, 0, 0])).toBe(true);
    expect(applies).toEqual(['near', 'far', 'near']);
    const releaseNear = cache.register('near', 0, 0, 0, { apply: () => applies.push('replacement') });
    const staleRelease = cache.register('near', 1, 0, 0, { apply: () => applies.push('replacement-new') });
    releaseNear();
    staleRelease();
    expect(cache.snapshot).toMatchObject({
      brickCount: 1,
      allocatedBrickCount: 1,
      allocatedBytes: BLOCK_LIGHT_CHUNK_BRICK_BYTES,
    });
  });
});
