import { expect, it } from 'vitest';
import { GameServer, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const setup = () => {
  const server = new GameServer({ seedText: 'fluid-buckets', platform: testCorePlatform, ...classicOptions() });
  server.spawnPlayer({ id: 'player', position: [0.5, 40, 0.5] });
  server.getChunk(0, 1, 0);
  return server;
};

it.each([
  [Voxel.Water, 'water-bucket'],
  [Voxel.Lava, 'lava-bucket'],
] as const)('空桶拾取 source voxel %s 并由满桶放回', (voxel, filled) => {
  const server = setup();
  server.edit(1, 40, 0, voxel, 'fixture');
  expect(server.getFluidCell(1, 40, 0)).toEqual({ level: 8, source: true });
  server.giveItem('player', { itemId: 'bucket', count: 1 });
  expect(server.useFluidContainer('player', [1, 40, 0])).toEqual(expect.objectContaining({ success: true }));
  expect(server.getVoxel(1, 40, 0)).toBe(Voxel.Air);
  const filledSlot = server.getInventory('player').slots.findIndex((stack) => stack?.itemId === filled);
  expect(filledSlot).toBeGreaterThanOrEqual(0);
  server.selectHotbarSlot('player', filledSlot);
  expect(server.useFluidContainer('player', [2, 40, 0])).toMatchObject({ success: true });
  expect(server.getVoxel(2, 40, 0)).toBe(voxel);
  expect(server.getFluidCell(2, 40, 0)).toEqual({ level: 8, source: true });
  expect(server.getInventory('player').slots.some((stack) => stack?.itemId === 'bucket')).toBe(true);
});

it('流动流体拒绝装桶且世界与库存不变', () => {
  const server = setup();
  server.edit(1, 40, 0, Voxel.Water, 'fixture');
  const chunk = server.getChunk(0, 1, 0);
  const index = 1 + 32 * (0 + 32 * 8);
  chunk.fluid[index] = 7;
  server.giveItem('player', { itemId: 'bucket', count: 1 });
  const before = server.getInventory('player');
  expect(server.useFluidContainer('player', [1, 40, 0])).toEqual({ success: false, reason: 'not-fluid-source' });
  expect(server.getVoxel(1, 40, 0)).toBe(Voxel.Water);
  expect(server.getInventory('player')).toEqual(before);
});
