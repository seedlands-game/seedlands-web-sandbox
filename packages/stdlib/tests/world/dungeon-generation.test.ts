import { expect, it } from 'vitest';
import { dungeonFor, dungeonLoot, dungeonVoxel } from '../../src/world/dungeon-generation';
import { Voxel } from '../../src/world/voxel';
it('V8地牢按region稳定且V7无地牢', () => {
  let found;
  for (let x = -512; x <= 512 && !found; x += 64)
    for (let z = -512; z <= 512 && !found; z += 64) found = dungeonFor(42, x, z, 8);
  expect(found).toBeTruthy();
  expect(dungeonFor(42, found!.center[0], found!.center[2], 7)).toBeNull();
  expect(dungeonFor(42, found!.center[0], found!.center[2], 8)).toEqual(found);
  expect(dungeonVoxel(found!, ...found!.center)).toBe(Voxel.Air);
  expect(dungeonVoxel(found!, found!.center[0], found!.center[1] - 1, found!.center[2])).toBe(Voxel.Spawner);
  expect(
    dungeonVoxel(
      found!,
      found!.center[0] + found!.radiusX - 1,
      found!.center[1] - 1,
      found!.center[2] + found!.radiusZ - 1,
    ),
  ).toBe(Voxel.DungeonChest);
});
it('地牢战利品由seed/id/index确定且有界', () => {
  expect(dungeonLoot(7, 'dungeon:1,2', 0)).toEqual(dungeonLoot(7, 'dungeon:1,2', 0));
  expect(dungeonLoot(7, 'dungeon:1,2', 0)[0].count).toBeLessThanOrEqual(3);
});
