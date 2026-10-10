import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicPreNavigationV4CompositionIdentity } from '../../../../../../../playbooks/classic/src/pre-navigation-v4-composition-identity';
import { classicOptions } from '../../../../fixtures/classic/content';
import { preTransportGameplayFixture } from '../../../../fixtures/classic/pre-transport-schedule';

type Runtime = Awaited<ReturnType<typeof create>>;
const create = (platform: CorePlatformPorts = testCorePlatform, persistence?: MemoryGamePersistence) =>
  AuthorityRuntime.create({
    ...classicOptions(),
    ...(persistence ? { persistence } : {}),
    worldgenProvider: classicWorldgenProvider,
    platform,
    epoch: 'classic-navigation-authority',
    seedText: 'classic-navigation-authority',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [4.5, 4, 0.5],
  });

const selection = (runtime: Runtime) => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  return {
    inventoryRevision: inventory.revision,
    modeRevision: player.mode!.revision,
    creativeCatalogRevision: player.creativeCatalog!.revision,
    selectedSlot: player.selectedSlot,
  };
};

const selectItem = async (runtime: Runtime, itemId: string) => {
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  const slot = inventory.slots.findIndex((entry) => entry?.itemId === itemId);
  expect(slot, `missing ${itemId} in Authority inventory`).toBeGreaterThanOrEqual(0);
  const result = await runtime.performAction({ type: 'select-hotbar', slot });
  expect(result.result, JSON.stringify(result.result)).toMatchObject({ success: true });
  return result;
};

const exploreMap = (runtime: Runtime, expectedSelection = selection(runtime)): AuthorityAction => ({
  type: 'interact',
  intent: 'use',
  target: { kind: 'self' },
  expectedSelection,
});

it('routes real Authority self-interaction through the registered map owner into the accepted view', async () => {
  const runtime = await create();
  await runtime.editWorld('navigation-authority-fixture', [
    { x: 4, y: 3, z: 0, value: Voxel.Grass },
    { x: 5, y: 3, z: 0, value: Voxel.Water },
    { x: 4, y: 3, z: 1, value: Voxel.Stone },
  ]);
  runtime.server.giveItem(runtime.playerId, { itemId: 'map', count: 1 });
  runtime.server.giveItem(runtime.playerId, { itemId: 'compass', count: 1 });
  runtime.server.giveItem(runtime.playerId, { itemId: 'clock', count: 1 });

  const inventoryBefore = runtime.server.getInventoryPointerView(runtime.playerId);
  await selectItem(runtime, 'map');
  const selectedInventory = runtime.server.getInventoryPointerView(runtime.playerId);
  const selectedGameplayRevision = runtime.server.gameplayRevision;
  const explored = await runtime.performAction(exploreMap(runtime));
  expect(explored.result, JSON.stringify(explored.result)).toMatchObject({ success: true, handled: true });
  expect(runtime.server.navigationItems.checkpoint().maps).toHaveLength(1);
  const map = runtime.server.navigationItems.checkpoint().maps[0]!;
  expect(map).toMatchObject({ id: 'map-1', playerId: runtime.playerId, center: [4, 0] });
  expect(map.pixels).toContainEqual({ x: 0, z: 0, color: 2 });
  expect(map.pixels).toContainEqual({ x: 1, z: 0, color: 1 });
  expect(runtime.server.gameplayRevision).toBeGreaterThan(selectedGameplayRevision);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(selectedInventory);
  expect(runtime.view().navigation).toMatchObject({ itemId: 'map', kind: 'map', map });

  const navigationBefore = runtime.server.navigationItems.checkpoint();
  const gameplayBefore = runtime.server.gameplayRevision;
  const inventoryAfterMap = runtime.server.getInventoryPointerView(runtime.playerId);
  for (const [field, delta] of [
    ['inventoryRevision', 1],
    ['modeRevision', 1],
    ['creativeCatalogRevision', 1],
    ['selectedSlot', 1],
  ] as const) {
    const stale = { ...selection(runtime), [field]: selection(runtime)[field] + delta };
    const rejected = await runtime.performAction(exploreMap(runtime, stale));
    expect(rejected.result, JSON.stringify(rejected.result)).toMatchObject({ success: false });
    expect(runtime.server.navigationItems.checkpoint()).toEqual(navigationBefore);
    expect(runtime.server.gameplayRevision).toBe(gameplayBefore);
    expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventoryAfterMap);
  }

  for (const itemId of ['compass', 'clock', 'map']) {
    await selectItem(runtime, itemId);
    const held = runtime.view().navigation;
    expect(held?.itemId).toBe(itemId);
    expect(held?.kind).toBe(itemId);
    expect(runtime.server.navigationItems.checkpoint()).toEqual(navigationBefore);
  }
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventoryBefore);
});

it('accepts only the captured pre-navigation V4 identity without its optional child', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const source = await create(testCorePlatform, persistence);
  source.server.giveItem(source.playerId, { itemId: 'map', count: 1 });
  source.server.giveItem(source.playerId, { itemId: 'compass', count: 1 });
  const inventoryBefore = source.server.getInventoryPointerView(source.playerId);
  await selectItem(source, 'map');
  await source.editWorld('captured-navigation-map-samples', [
    { x: 4, y: 3, z: 0, value: Voxel.Grass },
    { x: 5, y: 3, z: 0, value: Voxel.Water },
  ]);
  const mapAction = await source.performAction(exploreMap(source));
  expect(mapAction.result, JSON.stringify(mapAction.result)).toMatchObject({ success: true, handled: true });
  const current = source.exportPortableCheckpoint();
  const legacyGameplay = {
    ...preTransportGameplayFixture(current.gameplay),
    composition: classicPreNavigationV4CompositionIdentity,
  };
  delete legacyGameplay.navigationItems;
  persistence.saveFrozenSnapshot({ ...current, gameplay: legacyGameplay });

  // This is a logical compatibility fixture: current checkpoint data is paired with the
  // exact captured prior identity and its absent optional child; it is not an old save byte stream.
  const restored = await create(testCorePlatform, persistence);
  await expect(restored.server.prepareCanonicalChunkForMutation(0, 0, 0)).resolves.toBe(true);
  expect(restored.server.navigationItems.checkpoint()).toEqual({ version: 1, sequence: 0, maps: [] });
  expect(restored.view().navigation).toMatchObject({ itemId: 'map', kind: 'map', map: null });
  const restoredInventory = restored.server.getInventoryPointerView(restored.playerId);
  expect(restoredInventory).toMatchObject({
    slots: inventoryBefore.slots,
    hotbarSize: inventoryBefore.hotbarSize,
    armor: inventoryBefore.armor,
    cursor: inventoryBefore.cursor,
    matchedCraftingRecipeIds: inventoryBefore.matchedCraftingRecipeIds,
  });
  expect(restored.server.getPlayerState(restored.playerId).selectedSlot).toBe(
    source.server.getPlayerState(source.playerId).selectedSlot,
  );

  const alteredIdentity = {
    ...classicPreNavigationV4CompositionIdentity,
    packLock: classicPreNavigationV4CompositionIdentity.packLock.map((entry, index) =>
      index === 0 ? { ...entry, integrity: { ...entry.integrity, entryDigest: '0'.repeat(64) } } : entry,
    ),
  };
  const rejectedPersistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  rejectedPersistence.saveFrozenSnapshot({
    ...current,
    gameplay: { ...legacyGameplay, composition: alteredIdentity },
  });
  const savedBeforeRejectedRestore = rejectedPersistence.loadGameCheckpoint();
  const gameplayBeforeRejectedRestore = rejectedPersistence.loadGameplaySnapshot();
  await expect(create(testCorePlatform, rejectedPersistence)).rejects.toThrow(/composition identity/i);
  expect(rejectedPersistence.loadGameCheckpoint()).toEqual(savedBeforeRejectedRestore);
  expect(rejectedPersistence.loadGameplaySnapshot()).toEqual(gameplayBeforeRejectedRestore);
});
