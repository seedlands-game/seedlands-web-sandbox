import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';

type Runtime = Awaited<ReturnType<typeof create>>;
const hit: [number, number, number] = [1, 59, 0];
const create = (platform: CorePlatformPorts = testCorePlatform, persistence?: MemoryGamePersistence) =>
  AuthorityRuntime.create({
    ...classicOptions(),
    ...(persistence ? { persistence } : {}),
    worldgenProvider: classicWorldgenProvider,
    platform,
    epoch: 'classic-crop-harvest',
    seedText: 'classic-crop-harvest',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
  });
const action = (runtime: Runtime, intent: 'use' | 'alternate' = 'use') => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  return {
    type: 'interact' as const,
    intent,
    target: {
      kind: 'voxel' as const,
      hit: [...hit] as [number, number, number],
      adjacent: [1, 60, 0] as [number, number, number],
    },
    expectedSelection: {
      inventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
      modeRevision: player.mode!.revision,
      creativeCatalogRevision: player.creativeCatalog!.revision,
      selectedSlot: player.mode!.value === 'creative' ? player.creativeCatalog!.selectedSlot : player.selectedSlot,
    },
  };
};
const planted = async (platform: CorePlatformPorts = testCorePlatform, persistence?: MemoryGamePersistence) => {
  const runtime = await create(platform, persistence);
  await expect(
    runtime.editWorld('crop-harvest-fixture', [
      { x: 0, y: 59, z: 0, value: Voxel.Stone },
      { x: 1, y: 59, z: 0, value: Voxel.Farmland },
      { x: 1, y: 60, z: 0, value: Voxel.Air },
      { x: 3, y: 59, z: 0, value: Voxel.Water },
    ]),
  ).resolves.toMatchObject({ committed: true });
  runtime.server.giveItem(runtime.playerId, { itemId: 'wheat-seeds', count: 2 });
  expect((await runtime.performAction(action(runtime))).result).toMatchObject({ success: true });
  return runtime;
};
const total = (runtime: Runtime, itemId: string) =>
  runtime.server
    .getInventoryPointerView(runtime.playerId)
    .slots.reduce((sum, slot) => sum + (slot?.itemId === itemId ? slot.count : 0), 0);

it('harvests a normally grown crop through the real Authority target-first interaction with empty hands', async () => {
  const runtime = await planted();
  runtime.advanceSession(30_000);
  expect(runtime.server.crops.at(hit)?.stage).toBe(7);
  expect((await runtime.performAction({ type: 'select-hotbar', slot: 1 })).result).toMatchObject({ success: true });
  runtime.takeCommits();
  const before = {
    world: runtime.server.worldRevision,
    gameplay: runtime.server.gameplayRevision,
    inventory: runtime.server.getInventoryPointerView(runtime.playerId).revision,
  };
  const response = await runtime.performAction(action(runtime));
  expect(response.result).toMatchObject({ success: true, handled: true });
  expect(runtime.server.crops.at(hit)).toBeNull();
  expect(total(runtime, 'wheat')).toBe(1);
  expect(total(runtime, 'wheat-seeds')).toBe(2);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(before.inventory + 1);
  expect(runtime.server.gameplayRevision).toBe(before.gameplay + 1);
  expect(runtime.server.worldRevision).toBe(before.world);
  expect(response.commits).toEqual([]);
  expect(runtime.view().cropStages).toEqual([]);
});

it('uses the registered Classic bone-derived white dye as fertilizer through the normal player action', async () => {
  const runtime = await planted();
  runtime.server.giveItem(runtime.playerId, { itemId: 'white-dye', count: 1 });
  expect((await runtime.performAction({ type: 'select-hotbar', slot: 1 })).result).toMatchObject({ success: true });
  const response = await runtime.performAction(action(runtime));
  expect(response.result).toMatchObject({ success: true, handled: true });
  expect(runtime.server.crops.at(hit)).toMatchObject({ stage: 7, subSeconds: 0 });
  expect(total(runtime, 'white-dye')).toBe(0);
  expect(runtime.view().cropStages).toEqual([{ position: hit, stage: 7 }]);
});

const capture = (runtime: Runtime) => ({
  crops: runtime.server.crops.checkpoint(),
  inventory: runtime.server.getInventoryPointerView(runtime.playerId),
  world: runtime.server.worldRevision,
  gameplay: runtime.server.gameplayRevision,
  sequence: runtime.server.commitSequence,
});
const rejected = async (runtime: Runtime, submitted = action(runtime)) => {
  const before = capture(runtime);
  const response = await runtime.performAction(submitted);
  expect(response.result).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(capture(runtime)).toEqual(before);
};

it('returns only seeds for immature alternate harvesting while normal seed use still rejects duplicate planting', async () => {
  const runtime = await planted();
  await rejected(runtime);
  expect((await runtime.performAction(action(runtime, 'alternate'))).result).toMatchObject({ success: true });
  expect(total(runtime, 'wheat-seeds')).toBe(2);
  expect(total(runtime, 'wheat')).toBe(0);
  expect(runtime.server.crops.at(hit)).toBeNull();
});

it('rejects mature fertilizer without consuming a second white dye or publishing partial state', async () => {
  const runtime = await planted();
  runtime.server.giveItem(runtime.playerId, { itemId: 'white-dye', count: 2 });
  await runtime.performAction({ type: 'select-hotbar', slot: 1 });
  expect((await runtime.performAction(action(runtime))).result).toMatchObject({ success: true });
  expect(total(runtime, 'white-dye')).toBe(1);
  await rejected(runtime);
});

it('rejects the complete harvest when wheat fits but its following seed drop cannot fit', async () => {
  const runtime = await planted();
  runtime.advanceSession(30_000);
  expect(runtime.server.crops.at(hit)?.stage).toBe(7);
  runtime.server.giveItem(runtime.playerId, { itemId: 'wheat-seeds', count: 63 });
  runtime.server.giveItem(runtime.playerId, { itemId: 'wheat', count: 63 });
  for (let slot = 2; slot < runtime.server.getInventoryPointerView(runtime.playerId).slots.length; slot++)
    runtime.server.giveItem(runtime.playerId, { itemId: 'stone-block', count: 64 });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).slots.every(Boolean)).toBe(true);
  expect(total(runtime, 'wheat-seeds')).toBe(64);
  expect(total(runtime, 'wheat')).toBe(63);
  await rejected(runtime, action(runtime, 'alternate'));
});

for (const field of ['inventoryRevision', 'modeRevision', 'creativeCatalogRevision', 'selectedSlot'] as const) {
  it(`rejects target-first harvesting with stale ${field}`, async () => {
    const runtime = await planted();
    const submitted = action(runtime, 'alternate');
    submitted.expectedSelection[field] += 1;
    await rejected(runtime, submitted);
  });
}

it('fertilizes and harvests in Creative without changing Survival inventory', async () => {
  const runtime = await planted();
  const invoke = (operationId: string, input: { mode: string } | { slot: number; itemId: string }) =>
    runtime.server.invokeActorModuleOperation(runtime.playerId, {
      operationId,
      target: { kind: 'entity', entityId: runtime.playerId },
      input,
    });
  expect(invoke('seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
  expect(invoke('seedlands:set-creative-catalog', { slot: 0, itemId: 'white-dye' })).toMatchObject({ ok: true });
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  expect((await runtime.performAction(action(runtime))).result).toMatchObject({ success: true });
  expect(runtime.server.crops.at(hit)?.stage).toBe(7);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventory);
  expect((await runtime.performAction(action(runtime, 'alternate'))).result).toMatchObject({ success: true });
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventory);
  expect(runtime.server.crops.at(hit)).toBeNull();
});

it('restores a fertilized crop through portable persistence then harvests through a fresh Authority instance', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const runtime = await planted(testCorePlatform, persistence);
  runtime.server.giveItem(runtime.playerId, { itemId: 'white-dye', count: 1 });
  await runtime.performAction({ type: 'select-hotbar', slot: 1 });
  expect((await runtime.performAction(action(runtime))).result).toMatchObject({ success: true });
  await runtime.persistPortableCheckpoint(runtime.exportPortableCheckpoint());
  const restored = await create(testCorePlatform, persistence);
  await expect(restored.server.prepareCanonicalChunkForMutation(0, 1, 0)).resolves.toBe(true);
  expect(restored.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
  expect(restored.view().cropStages).toEqual([{ position: hit, stage: 7 }]);
  expect((await restored.performAction(action(restored))).result).toMatchObject({ success: true });
  expect(total(restored, 'wheat')).toBe(1);
  expect(restored.view().cropStages).toEqual([]);
});

it('rejects a prepared harvest when its above cell receives a real external WorldCommit', async () => {
  let armed = false;
  let external: unknown;
  const platform: CorePlatformPorts = {
    ...testCorePlatform,
    clone: <Value>(value: Value): Value => {
      if (
        armed &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.hasOwn(value, 'actorId') &&
        !Object.hasOwn(value, 'kind') &&
        (value as { action?: unknown }).action === 'harvest'
      ) {
        armed = false;
        if (!runtime) throw new Error('Harvest race runtime is unavailable.');
        external = runtime.server.editBatch({
          actorId: 'crop-harvest-race',
          edits: [{ x: 1, y: 60, z: 0, value: Voxel.Stone }],
        });
      }
      return structuredClone(value);
    },
  };
  const runtime = await planted(platform);
  runtime.advanceSession(30_000);
  await runtime.performAction({ type: 'select-hotbar', slot: 1 });
  runtime.takeCommits();
  const before = capture(runtime);
  armed = true;
  const response = await runtime.performAction(action(runtime));
  expect(external).toMatchObject({ committed: true, worldRevision: before.world + 1 });
  expect(response.result).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(runtime.server.crops.checkpoint()).toEqual(before.crops);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before.inventory);
  expect(runtime.server.gameplayRevision).toBe(before.gameplay);
  expect(runtime.server.worldRevision).toBe(before.world + 1);
  expect(runtime.server.commitSequence).toBe(before.sequence + 1);
});
