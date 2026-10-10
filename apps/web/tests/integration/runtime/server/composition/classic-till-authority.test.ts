import type { ModuleInvocationValue } from '@seedlands/stdlib/mod-api';
import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';

type Runtime = Awaited<ReturnType<typeof create>>;
type Hoe = { id: string; durability: number };
const hoes: Hoe[] = [
  { id: 'wood-hoe', durability: 60 },
  { id: 'stone-hoe', durability: 132 },
  { id: 'iron-hoe', durability: 250 },
  { id: 'gold-hoe', durability: 32 },
  { id: 'diamond-hoe', durability: 1561 },
];
const hit: [number, number, number] = [1, 59, 0];
const top: [number, number, number] = [1, 60, 0];
const side: [number, number, number] = [1, 59, 1];

const create = (
  platform: CorePlatformPorts = testCorePlatform,
  initialPlayerBodyPosition: [number, number, number] = [0.5, 60, 0.5],
) =>
  AuthorityRuntime.create({
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform,
    epoch: 'classic-till-authority',
    seedText: 'classic-till-authority',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition,
  });

const load = (runtime: Runtime, edits: readonly { x: number; y: number; z: number; value: number }[]) =>
  expect(runtime.editWorld('till-fixture', edits)).resolves.toMatchObject({ committed: true });
const put = (position: readonly [number, number, number], value: number) => ({
  x: position[0],
  y: position[1],
  z: position[2],
  value,
});
const giveHoe = (runtime: Runtime, id: string, durability: number) =>
  runtime.server.giveItem(runtime.playerId, { itemId: id, count: 1, instance: { durability } });
const selection = (runtime: Runtime) => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  return {
    inventoryRevision: inventory.revision,
    modeRevision: player.mode!.revision,
    creativeCatalogRevision: player.creativeCatalog!.revision,
    selectedSlot: player.mode!.value === 'creative' ? player.creativeCatalog!.selectedSlot : player.selectedSlot,
  };
};
const till = (
  runtime: Runtime,
  target: [number, number, number] = hit,
  adjacent: [number, number, number] = top,
): AuthorityAction => ({
  type: 'interact',
  intent: 'use',
  target: {
    kind: 'voxel',
    hit: [...target] as [number, number, number],
    adjacent: [...adjacent] as [number, number, number],
  },
  expectedSelection: selection(runtime),
});
const loadSoil = (runtime: Runtime, source: number = Voxel.Grass, adjacentValue: number = Voxel.Air) =>
  load(runtime, [put(hit, source), put(top, adjacentValue), put(side, Voxel.Air)]);
const state = (runtime: Runtime) => ({
  inventory: runtime.server.getInventoryPointerView(runtime.playerId),
  worldRevision: runtime.server.worldRevision,
  gameplayRevision: runtime.server.gameplayRevision,
  inventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
  commitSequence: runtime.server.commitSequence,
  target: runtime.server.getVoxel(...hit),
  above: runtime.server.getVoxel(...top),
});
const expectNoPartialChange = (
  runtime: Runtime,
  before: ReturnType<typeof state>,
  response: Awaited<ReturnType<Runtime['performAction']>>,
) => {
  expect(response.result).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before.inventory);
  expect(runtime.server.worldRevision).toBe(before.worldRevision);
  expect(runtime.server.gameplayRevision).toBe(before.gameplayRevision);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(before.inventoryRevision);
  expect(runtime.server.commitSequence).toBe(before.commitSequence);
  expect(runtime.server.getVoxel(...hit)).toBe(before.target);
  expect(runtime.server.getVoxel(...top)).toBe(before.above);
};
const invoke = (runtime: Runtime, operationId: string, input: ModuleInvocationValue) =>
  runtime.server.invokeActorModuleOperation(runtime.playerId, {
    operationId,
    target: { kind: 'entity', entityId: runtime.playerId },
    input,
  });

it.each(hoes.flatMap((hoe) => ([Voxel.Grass, Voxel.Dirt] as const).map((source) => [hoe, source] as const)))(
  'tills Grass/Dirt through Authority with %s and spends one durability',
  async (hoe, source) => {
    const runtime = await create();
    await loadSoil(runtime, source);
    giveHoe(runtime, hoe.id, hoe.durability);
    runtime.takeCommits();
    const before = runtime.server.getInventoryPointerView(runtime.playerId);

    const response = await runtime.performAction(till(runtime));

    expect(response.result).toMatchObject({ success: true, handled: true });
    expect(response.commits).toHaveLength(1);
    expect(runtime.server.getVoxel(...hit)).toBe(Voxel.Farmland);
    expect(runtime.server.getInventory(runtime.playerId).slots[0]).toEqual({
      itemId: hoe.id,
      count: 1,
      instance: { durability: hoe.durability - 1 },
    });
    expect(runtime.server.worldRevision).toBeGreaterThan(before.revision);
    expect(runtime.server.gameplayRevision).toBeGreaterThan(0);
  },
);

it('removes a hoe when tilling spends its final durability point', async () => {
  const runtime = await create();
  await loadSoil(runtime, Voxel.Dirt);
  giveHoe(runtime, 'wood-hoe', 1);
  runtime.takeCommits();

  const response = await runtime.performAction(till(runtime));

  expect(response.result, JSON.stringify(response.result)).toMatchObject({ success: true, handled: true });
  expect(response.commits).toHaveLength(1);
  expect(runtime.server.getVoxel(...hit)).toBe(Voxel.Farmland);
  expect(runtime.server.getInventory(runtime.playerId).slots[0]).toBeNull();
});

it('uses the selected hoe in Creative without changing inventory or tool durability', async () => {
  const runtime = await create();
  await loadSoil(runtime);
  expect(invoke(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
  expect(invoke(runtime, 'seedlands:set-creative-catalog', { slot: 0, itemId: 'iron-hoe' })).toMatchObject({
    ok: true,
  });
  expect(runtime.server.getPlayerState(runtime.playerId).mode!.value).toBe('creative');
  expect(runtime.server.getPlayerState(runtime.playerId).creativeCatalog!.hotbar[0]).toBe('iron-hoe');
  runtime.takeCommits();
  const beforeInventory = runtime.server.getInventoryPointerView(runtime.playerId);
  const gameplayRevision = runtime.server.gameplayRevision;
  const worldRevision = runtime.server.worldRevision;

  const response = await runtime.performAction(till(runtime));

  expect(response.result, JSON.stringify(response.result)).toMatchObject({ success: true, handled: true });
  expect(response.commits).toHaveLength(1);
  expect(runtime.server.getVoxel(...hit)).toBe(Voxel.Farmland);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(beforeInventory);
  expect(runtime.server.worldRevision).toBe(worldRevision + 1);
  expect(runtime.server.gameplayRevision).toBe(gameplayRevision + 1);
});

it.each(['inventory', 'slot', 'mode', 'creative-catalog'] as const)(
  'rejects stale %s selection atomically',
  async (kind) => {
    const runtime = await create();
    await loadSoil(runtime);
    giveHoe(runtime, 'iron-hoe', 250);
    if (kind === 'creative-catalog') {
      expect(invoke(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
      expect(invoke(runtime, 'seedlands:set-creative-catalog', { slot: 0, itemId: 'iron-hoe' })).toMatchObject({
        ok: true,
      });
    }
    const request = till(runtime);
    if (kind === 'inventory') runtime.server.giveItem(runtime.playerId, { itemId: 'stone-block', count: 1 });
    if (kind === 'slot') {
      giveHoe(runtime, 'stone-hoe', 132);
      runtime.server.selectHotbarSlot(runtime.playerId, 1);
    }
    if (kind === 'mode')
      expect(invoke(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
    if (kind === 'creative-catalog')
      expect(invoke(runtime, 'seedlands:set-creative-catalog', { slot: 1, itemId: 'stone-hoe' })).toMatchObject({
        ok: true,
      });
    runtime.takeCommits();
    const before = state(runtime);

    const response = await runtime.performAction(request);

    expect(response.result).toEqual({ success: false, reason: 'stale-selection' });
    expectNoPartialChange(runtime, before, response);
  },
);

it.each([
  ['wrong tool', 'iron-pickaxe', Voxel.Grass, Voxel.Air, top],
  ['stone target', 'iron-hoe', Voxel.Stone, Voxel.Air, top],
  ['occupied soil above via side face', 'iron-hoe', Voxel.Grass, Voxel.Stone, side],
] as const)('rejects %s without partial changes', async (_label, itemId, source, above, adjacent) => {
  const runtime = await create();
  await loadSoil(runtime, source, above);
  if (itemId === 'iron-hoe') giveHoe(runtime, itemId, 250);
  else runtime.server.giveItem(runtime.playerId, { itemId, count: 1, instance: { durability: 250 } });
  runtime.takeCommits();
  const before = state(runtime);

  const response = await runtime.performAction(till(runtime, hit, adjacent));

  expectNoPartialChange(runtime, before, response);
});

it('rejects out-of-range and occluded targets without partial changes', async () => {
  const runtime = await create();
  await load(runtime, [
    put([8, 59, 0], Voxel.Grass),
    put([8, 60, 0], Voxel.Air),
    put(hit, Voxel.Grass),
    put(top, Voxel.Air),
  ]);
  giveHoe(runtime, 'iron-hoe', 250);
  runtime.takeCommits();
  const before = state(runtime);
  const far = await runtime.performAction(till(runtime, [8, 59, 0], [8, 60, 0]));
  expectNoPartialChange(runtime, before, far);

  await load(runtime, [put([0, 60, 0], Voxel.Stone)]);
  runtime.takeCommits();
  const beforeOccluded = state(runtime);
  const blocked = await runtime.performAction(till(runtime));
  expectNoPartialChange(runtime, beforeOccluded, blocked);
});

it('rejects an unloaded target when it is outside the loaded region', async () => {
  const runtime = await create();
  giveHoe(runtime, 'iron-hoe', 250);
  const unloaded: [number, number, number] = [40, 59, 0];
  expect(runtime.server.peekLoadedVoxel(...unloaded)).toBeNull();
  runtime.takeCommits();
  const before = state(runtime);
  const response = await runtime.performAction(till(runtime, unloaded, [40, 60, 0]));
  expectNoPartialChange(runtime, before, response);
});

it('rejects when hit and side face are loaded but the independent soil-above cell is unloaded', async () => {
  const runtime = await create(testCorePlatform, [0.5, 29.2, 0.5]);
  const boundaryHit: [number, number, number] = [1, 31, 0];
  const boundarySide: [number, number, number] = [1, 31, 1];
  const boundaryAbove: [number, number, number] = [1, 32, 0];
  await load(runtime, [put(boundaryHit, Voxel.Grass), put(boundarySide, Voxel.Air)]);
  giveHoe(runtime, 'iron-hoe', 250);
  expect(runtime.server.peekLoadedVoxel(...boundaryHit)).not.toBeNull();
  expect(runtime.server.peekLoadedVoxel(...boundarySide)).not.toBeNull();
  expect(runtime.server.peekLoadedVoxel(...boundaryAbove)).toBeNull();
  runtime.takeCommits();
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  const worldRevision = runtime.server.worldRevision;
  const gameplayRevision = runtime.server.gameplayRevision;
  const inventoryRevision = inventory.revision;
  const commitSequence = runtime.server.commitSequence;

  const response = await runtime.performAction(till(runtime, boundaryHit, boundarySide));

  expect(response.result).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(runtime.server.peekLoadedVoxel(...boundaryHit)?.voxel).toBe(Voxel.Grass);
  expect(runtime.server.peekLoadedVoxel(...boundarySide)?.voxel).toBe(Voxel.Air);
  expect(runtime.server.peekLoadedVoxel(...boundaryAbove)).toBeNull();
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventory);
  expect(runtime.server.worldRevision).toBe(worldRevision);
  expect(runtime.server.gameplayRevision).toBe(gameplayRevision);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(inventoryRevision);
  expect(runtime.server.commitSequence).toBe(commitSequence);
});

it('keeps till target and inventory unchanged when a concurrent world commit makes the prepared interaction stale', async () => {
  const fixture: { runtime?: Runtime } = {};
  let armed = false;
  let externalCommit: ReturnType<Runtime['server']['editBatch']> | null = null;
  const platform: CorePlatformPorts = {
    ...testCorePlatform,
    clone: <Value>(value: Value): Value => {
      if (
        armed &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.hasOwn(value, 'commit')
      ) {
        armed = false;
        if (!fixture.runtime) throw new Error('Stale fixture runtime is unavailable.');
        externalCommit = fixture.runtime.server.editBatch({
          actorId: 'external-stale-till-fixture',
          edits: [{ x: 40, y: 59, z: 0, value: Voxel.Dirt }],
        });
      }
      return structuredClone(value);
    },
  };
  const runtime = await create(platform);
  fixture.runtime = runtime;
  await loadSoil(runtime);
  await load(runtime, [put([40, 59, 0], Voxel.Stone)]);
  giveHoe(runtime, 'iron-hoe', 250);
  runtime.takeCommits();
  const beforeInventory = runtime.server.getInventoryPointerView(runtime.playerId);
  const worldRevision = runtime.server.worldRevision;
  const gameplayRevision = runtime.server.gameplayRevision;
  armed = true;

  const response = await runtime.performAction(till(runtime));

  expect(response.result).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(externalCommit).toMatchObject({ committed: true, worldRevision: worldRevision + 1 });
  expect(runtime.server.getVoxel(...hit)).toBe(Voxel.Grass);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(beforeInventory);
  expect(runtime.server.worldRevision).toBe(worldRevision + 1);
  expect(runtime.server.gameplayRevision).toBe(gameplayRevision);
});
