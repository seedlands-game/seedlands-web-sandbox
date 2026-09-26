import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';

it('places water through the formal Classic interaction exactly once', async () => {
  const runtime = await AuthorityRuntime.create({
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    epoch: 'classic-water-bucket-red',
    seedText: 'classic-water-bucket-red',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
  });
  await expect(
    runtime.editWorld('water-bucket-fixture', [
      { x: 1, y: 59, z: 0, value: Voxel.Stone },
      { x: 1, y: 60, z: 0, value: Voxel.Air },
    ]),
  ).resolves.toMatchObject({ committed: true });
  runtime.server.giveItem(runtime.playerId, { itemId: 'water-bucket', count: 1 });
  const beforeInventory = runtime.server.getInventoryPointerView(runtime.playerId);
  const beforeWorldRevision = runtime.server.worldRevision;
  const beforeGameplayRevision = runtime.server.gameplayRevision;
  const response = await runtime.performAction({
    type: 'interact',
    intent: 'use',
    target: { kind: 'voxel', hit: [1, 59, 0], adjacent: [1, 60, 0] },
    expectedSelection: {
      inventoryRevision: beforeInventory.revision,
      modeRevision: runtime.server.getPlayerState(runtime.playerId).mode!.revision,
      creativeCatalogRevision: runtime.server.getPlayerState(runtime.playerId).creativeCatalog!.revision,
      selectedSlot: runtime.server.getPlayerState(runtime.playerId).selectedSlot,
    },
  });

  if (
    !response.result ||
    typeof response.result !== 'object' ||
    !('success' in response.result) ||
    !response.result.success
  )
    throw new Error(`Expected water interaction success; received ${JSON.stringify(response.result)}`);
  expect(response.result).toMatchObject({ success: true, handled: true });
  expect(runtime.server.getVoxel(1, 60, 0)).toBe(Voxel.Water);
  const afterInventory = runtime.server.getInventoryPointerView(runtime.playerId);
  expect(afterInventory.slots[beforeInventory.slots.findIndex((slot) => slot?.itemId === 'water-bucket')]).toEqual({
    itemId: 'bucket',
    count: 1,
  });
  expect(runtime.server.worldRevision).toBe(beforeWorldRevision + 1);
  expect(runtime.server.gameplayRevision).toBe(beforeGameplayRevision + 1);
  expect(afterInventory.revision).toBe(beforeInventory.revision + 1);
});
