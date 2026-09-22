import { expect, it } from 'vitest';
import { macroAt } from '../../src/world/macro-world';
import { saplingGrowthEdits, vegetationAt } from '../../src/world/vegetation';
import { Voxel, normalizeSeed } from '../../src/world/voxel';

it('自然植被按 seed/坐标稳定且只在地表上方', () => {
  const seed = normalizeSeed('vegetation');
  let found = 0;
  for (let x = -200; x <= 200; x++)
    for (let z = -200; z <= 200; z++) {
      const c = macroAt(seed, x, z, 7);
      const a = vegetationAt(seed, x, c.terrainHeight + 1, z, c, 10);
      expect(a).toBe(vegetationAt(seed, x, c.terrainHeight + 1, z, c, 10));
      expect(vegetationAt(seed, x, c.terrainHeight + 2, z, c, 10)).toBeNull();
      if (a !== null) found++;
    }
  expect(found).toBeGreaterThan(0);
});
it('树苗只在完整已加载空域成长并输出稳定树形', () => {
  const cells = new Map<string, number>([
    ['0,0,0', Voxel.Dirt],
    ['0,1,0', Voxel.Sapling],
  ]);
  const get = (x: number, y: number, z: number) => cells.get([x, y, z].join(',')) ?? Voxel.Air;
  const edits = saplingGrowthEdits([0, 1, 0], get)!;
  expect(edits.filter((e) => e.value === Voxel.Wood)).toHaveLength(5);
  expect(edits.some((e) => e.value === Voxel.Leaves)).toBe(true);
  cells.set('1,4,0', Voxel.Stone);
  expect(saplingGrowthEdits([0, 1, 0], get)).toBeNull();
  expect(
    saplingGrowthEdits([0, 1, 0], (x, y, z) => (x === 2 && y === 5 && z === 0 ? undefined : get(x, y, z))),
  ).toBeNull();
});
