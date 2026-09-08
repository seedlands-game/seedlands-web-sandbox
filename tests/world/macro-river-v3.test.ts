import { describe, expect, it } from 'vitest';
import { macroAt, riverDescriptorsNear } from '../../packages/game-core/src/world/macro-world';
import { waterSurfaceHeight } from '../../packages/game-core/src/world/water-mesh-height';

const surfaceTop = (terrainHeight: number) => terrainHeight + 1;

describe('generator v3 自然河流', () => {
  it('保留 generator v2 的已知河岸与水列数值', () => {
    const water = macroAt(1, 447, -46, 2);
    const bank = macroAt(1, 446, -46, 2);
    expect(water.hydrology.waterLevel).toBe(14);
    expect(water.terrainHeight).toBe(12);
    expect(bank.terrainHeight).toBe(13);
  });

  it('v3 已知横断面的满级水面不高于紧邻岸顶', () => {
    const water = macroAt(1, 447, -46, 3);
    const bank = macroAt(1, 446, -46, 3);
    expect(water.hydrology.water).toBe(true);
    expect(bank.hydrology.water).toBe(false);
    expect(water.hydrology.waterLevel).not.toBeNull();
    const waterTop = water.hydrology.waterLevel! + waterSurfaceHeight(8, false);
    expect(waterTop).toBeLessThanOrEqual(surfaceTop(bank.terrainHeight));
    expect(water.hydrology.waterLevel! - water.terrainHeight).toBeGreaterThanOrEqual(2);
  });

  it('多 seed 的路径节点、段中点与跨 Chunk 邻域保持岸高和确定性', () => {
    let checked = 0;
    let crossedChunk = false;
    for (const seed of [1, 7, 19, 68, 2026, 7819]) {
      const descriptors = riverDescriptorsNear(seed, 0, 0, 3);
      for (const descriptor of descriptors) {
        const samples = descriptor.path.flatMap((point, index) => {
          const next = descriptor.path[index + 1];
          return next
            ? [point, [Math.round((point[0] + next[0]) / 2), Math.round((point[1] + next[1]) / 2)] as const]
            : [point];
        });
        for (const [x, z] of samples) {
          const center = macroAt(seed, x, z, 3);
          expect(macroAt(seed, x, z, 3)).toEqual(center);
          if (!center.hydrology.water || center.hydrology.waterLevel === null) continue;
          const direction = center.hydrology.direction ?? descriptor.direction;
          const normal: readonly [number, number] = [-direction[1], direction[0]];
          const bankDistance = descriptor.width + 1;
          for (const sign of [-1, 1]) {
            const bx = Math.round(x + normal[0] * bankDistance * sign);
            const bz = Math.round(z + normal[1] * bankDistance * sign);
            const bank = macroAt(seed, bx, bz, 3);
            if (bank.hydrology.water || bank.hydrology.waterLevel !== center.hydrology.waterLevel) continue;
            const waterTop = center.hydrology.waterLevel + waterSurfaceHeight(8, false);
            expect(surfaceTop(bank.terrainHeight)).toBeGreaterThanOrEqual(waterTop);
            crossedChunk ||= Math.floor(x / 32) !== Math.floor(bx / 32) || Math.floor(z / 32) !== Math.floor(bz / 32);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(12);
    expect(crossedChunk).toBe(true);
  });
});
