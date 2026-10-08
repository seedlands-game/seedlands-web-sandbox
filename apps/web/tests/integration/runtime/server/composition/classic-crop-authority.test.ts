import type { ModuleInvocationValue } from '@seedlands/stdlib/mod-api';
import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';
import { AuthorityTickPublisher } from '../../../../../src/worker/authority-tick-publisher';
import { BrowserAuthorityClient } from '../../../../../src/client/authority/browser-authority-client';
import { FakeAuthorityWorker } from '../../../../unit/client/fixtures/browser-authority';

type Runtime = Awaited<ReturnType<typeof create>>;
type Position = [number, number, number];
const hit: Position = [1, 59, 0];
const above: Position = [1, 60, 0];
const side: Position = [1, 59, 1];
const create = (
  platform: CorePlatformPorts = testCorePlatform,
  initialPlayerBodyPosition: Position = [0.5, 60, 0.5],
  persistence?: MemoryGamePersistence,
) =>
  AuthorityRuntime.create({
    ...classicOptions(),
    ...(persistence ? { persistence } : {}),
    worldgenProvider: classicWorldgenProvider,
    platform,
    epoch: 'classic-crop-authority',
    seedText: 'classic-crop-authority',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition,
  });

const put = (position: readonly [number, number, number], value: number) => ({
  x: position[0],
  y: position[1],
  z: position[2],
  value,
});
const load = (runtime: Runtime, edits: readonly { x: number; y: number; z: number; value: number }[]) =>
  expect(runtime.editWorld('crop-fixture', edits)).resolves.toMatchObject({ committed: true });
const loadSurface = (runtime: Runtime, soil: number = Voxel.Farmland, top: number = Voxel.Air) =>
  load(runtime, [put(hit, soil), put(above, top), put(side, Voxel.Air)]);
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
const plant = (runtime: Runtime, targetHit: Position = hit, adjacent: Position = above): AuthorityAction => ({
  type: 'interact',
  intent: 'use',
  target: { kind: 'voxel', hit: [...targetHit], adjacent: [...adjacent] },
  expectedSelection: selection(runtime),
});
const invoke = (runtime: Runtime, operationId: string, input: ModuleInvocationValue) =>
  runtime.server.invokeActorModuleOperation(runtime.playerId, {
    operationId,
    target: { kind: 'entity', entityId: runtime.playerId },
    input,
  });
const giveSeeds = (runtime: Runtime, count = 2) =>
  runtime.server.giveItem(runtime.playerId, { itemId: 'wheat-seeds', count });
const capture = (runtime: Runtime, positions: readonly Position[] = [hit, above, side]) => ({
  crops: runtime.server.crops.checkpoint(),
  inventory: runtime.server.getInventoryPointerView(runtime.playerId),
  inventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
  worldRevision: runtime.server.worldRevision,
  gameplayRevision: runtime.server.gameplayRevision,
  commitSequence: runtime.server.commitSequence,
  cells: positions.map((position) => ({ position, value: runtime.server.peekLoadedVoxel(...position) })),
});
const expectNoPartialChange = (
  runtime: Runtime,
  before: ReturnType<typeof capture>,
  response: Awaited<ReturnType<Runtime['performAction']>>,
) => {
  expect(response.result).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(runtime.server.crops.checkpoint()).toEqual(before.crops);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before.inventory);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(before.inventoryRevision);
  expect(runtime.server.worldRevision).toBe(before.worldRevision);
  expect(runtime.server.gameplayRevision).toBe(before.gameplayRevision);
  expect(runtime.server.commitSequence).toBe(before.commitSequence);
  expect(before.cells.map(({ position }) => runtime.server.peekLoadedVoxel(...position))).toEqual(
    before.cells.map(({ value }) => value),
  );
};

it('plants selected wheat seeds through the Classic Authority interaction and checkpoints stage zero', async () => {
  const runtime = await create();
  await loadSurface(runtime);
  expect(runtime.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
  expect(runtime.server.peekLoadedVoxel(...above)?.voxel).toBe(Voxel.Air);
  giveSeeds(runtime);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).slots[0]).toMatchObject({
    itemId: 'wheat-seeds',
    count: 2,
  });
  expect(selection(runtime).selectedSlot).toBe(0);
  runtime.takeCommits();
  const inventoryBefore = runtime.server.getInventoryPointerView(runtime.playerId);

  const response = await runtime.performAction(plant(runtime));

  expect(response.result, JSON.stringify(response.result)).toMatchObject({ success: true, handled: true });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).slots[0]).toMatchObject({
    itemId: 'wheat-seeds',
    count: 1,
  });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBeGreaterThan(inventoryBefore.revision);
  expect(runtime.exportPortableCheckpoint().gameplay.crops).toMatchObject({
    version: 1,
    crops: [{ position: hit, stage: 0, subSeconds: 0 }],
  });
});

it('projects registered crop stages from the sole owner across Authority growth without leaking child state', async () => {
  const runtime = await create();
  expect(runtime.view()).toHaveProperty('cropStages', []);
  await loadSurface(runtime);
  await load(runtime, [put([3, 59, 0], Voxel.Water)]);
  giveSeeds(runtime);
  expect((await runtime.performAction(plant(runtime))).result).toMatchObject({ success: true });
  const planted = runtime.view();
  expect(planted).toHaveProperty('cropStages', [{ position: hit, stage: 0 }]);
  const epoch = runtime.snapshot().epoch;
  const worker = new FakeAuthorityWorker();
  const client = new BrowserAuthorityClient(worker, epoch);
  const starting = client.start({
    seedText: 'classic-crop-authority',
    openMode: 'continue',
    legacySnapshots: [],
    initialWorldTime: 8,
    frequencies: runtime.ready().frequencies,
  });
  worker.emit({ kind: 'authority-ready', protocolVersion: 1, epoch, ready: structuredClone(runtime.ready()) });
  await starting;
  expect(client.gameplay.cropStages).toEqual([{ position: hit, stage: 0 }]);
  runtime.advanceSession(10_000);
  const grown = runtime.view();
  expect(grown.cropStages?.[0]?.stage).toBeGreaterThan(0);
  expect(grown.cropStages).toEqual(runtime.server.crops.list().map(({ position, stage }) => ({ position, stage })));
  expect(grown.cropStages?.[0]).not.toHaveProperty('subSeconds');
  expect(planted.cropStages).toEqual([{ position: hit, stage: 0 }]);
  expect(grown.cropStages?.[0]?.position).not.toBe(runtime.server.crops.list()[0]?.position);
  new AuthorityTickPublisher().publish(runtime, runtime.snapshot(), 10_000, epoch, epoch, (message) =>
    worker.emit(structuredClone(message)),
  );
  expect(client.gameplay.cropStages).toEqual(grown.cropStages);
  expect(client.gameplay.cropStages).not.toBe(grown.cropStages);
  client.dispose();
});

it('plants in Creative while preserving the Survival inventory', async () => {
  const runtime = await create();
  await loadSurface(runtime);
  giveSeeds(runtime);
  expect(invoke(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
  expect(invoke(runtime, 'seedlands:set-creative-catalog', { slot: 0, itemId: 'wheat-seeds' })).toMatchObject({
    ok: true,
  });
  runtime.takeCommits();
  const inventoryBefore = runtime.server.getInventoryPointerView(runtime.playerId);

  const response = await runtime.performAction(plant(runtime));

  expect(response.result, JSON.stringify(response.result)).toMatchObject({ success: true, handled: true });
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventoryBefore);
  expect(runtime.server.crops.checkpoint().crops).toMatchObject([{ position: hit, stage: 0 }]);
});

it.each(['inventory', 'slot', 'mode', 'creative-catalog'] as const)(
  'rejects stale %s selection without partial crop changes',
  async (kind) => {
    const runtime = await create();
    await loadSurface(runtime);
    giveSeeds(runtime);
    if (kind === 'creative-catalog') {
      expect(invoke(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
      expect(invoke(runtime, 'seedlands:set-creative-catalog', { slot: 0, itemId: 'wheat-seeds' })).toMatchObject({
        ok: true,
      });
    }
    const action = plant(runtime);
    if (kind === 'inventory') runtime.server.giveItem(runtime.playerId, { itemId: 'stone-block', count: 1 });
    if (kind === 'slot') {
      runtime.server.giveItem(runtime.playerId, { itemId: 'stone-block', count: 1 });
      runtime.server.selectHotbarSlot(runtime.playerId, 1);
    }
    if (kind === 'mode')
      expect(invoke(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
    if (kind === 'creative-catalog')
      expect(invoke(runtime, 'seedlands:set-creative-catalog', { slot: 1, itemId: 'wheat' })).toMatchObject({
        ok: true,
      });
    runtime.takeCommits();
    const before = capture(runtime);

    const response = await runtime.performAction(action);

    expectNoPartialChange(runtime, before, response);
  },
);

it('rejects planting an already occupied crop cell without a duplicate or extra seed use', async () => {
  const runtime = await create();
  await loadSurface(runtime);
  giveSeeds(runtime, 3);
  expect((await runtime.performAction(plant(runtime))).result).toMatchObject({ success: true });
  runtime.takeCommits();
  const before = capture(runtime);

  const response = await runtime.performAction(plant(runtime));

  expectNoPartialChange(runtime, before, response);
});

const invalidTargetCases: readonly [string, number, number, Position, Position][] = [
  ['wrong soil', Voxel.Dirt, Voxel.Air, hit, above],
  ['wrong item', Voxel.Farmland, Voxel.Air, hit, above],
  ['occupied plant above with a legal side target', Voxel.Farmland, Voxel.Stone, hit, side],
];

it.each(invalidTargetCases)('rejects %s without partial changes', async (label, soil, top, target, adjacent) => {
  const runtime = await create();
  await loadSurface(runtime, soil, top);
  if (label === 'wrong item') runtime.server.giveItem(runtime.playerId, { itemId: 'wheat', count: 1 });
  else giveSeeds(runtime);
  runtime.takeCommits();
  const before = capture(runtime);

  const response = await runtime.performAction(plant(runtime, target, adjacent));

  expectNoPartialChange(runtime, before, response);
});

it('rejects out-of-range and blocked crop targets without partial changes', async () => {
  const runtime = await create();
  const farHit: Position = [8, 59, 0];
  const farAbove: Position = [8, 60, 0];
  await load(runtime, [put(farHit, Voxel.Farmland), put(farAbove, Voxel.Air)]);
  giveSeeds(runtime);
  runtime.takeCommits();
  const beforeFar = capture(runtime, [farHit, farAbove]);

  const far = await runtime.performAction(plant(runtime, farHit, farAbove));

  expectNoPartialChange(runtime, beforeFar, far);
  await load(runtime, [
    put(hit, Voxel.Farmland),
    put(above, Voxel.Air),
    put(side, Voxel.Air),
    put([0, 60, 0], Voxel.Stone),
  ]);
  runtime.takeCommits();
  const beforeBlocked = capture(runtime);

  const blocked = await runtime.performAction(plant(runtime));

  expect(blocked.result).toMatchObject({ success: false, reason: 'blocked' });
  expectNoPartialChange(runtime, beforeBlocked, blocked);
});

it('rejects when hit and side are loaded but the independent crop-above cell is unloaded', async () => {
  const runtime = await create(testCorePlatform, [0.5, 29.2, 0.5]);
  const boundaryHit: Position = [1, 31, 0];
  const boundarySide: Position = [1, 31, 1];
  const boundaryAbove: Position = [1, 32, 0];
  await load(runtime, [put(boundaryHit, Voxel.Farmland), put(boundarySide, Voxel.Air)]);
  giveSeeds(runtime);
  expect(runtime.server.peekLoadedVoxel(...boundaryHit)).not.toBeNull();
  expect(runtime.server.peekLoadedVoxel(...boundarySide)).not.toBeNull();
  expect(runtime.server.peekLoadedVoxel(...boundaryAbove)).toBeNull();
  runtime.takeCommits();
  const positions = [boundaryHit, boundarySide, boundaryAbove];
  const before = capture(runtime, positions);

  const response = await runtime.performAction(plant(runtime, boundaryHit, boundarySide));

  expectNoPartialChange(runtime, before, response);
});

it('restores the planted crop from a fresh portable Authority checkpoint and prevents duplicate planting', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const runtime = await create(testCorePlatform, [0.5, 60, 0.5], persistence);
  await loadSurface(runtime);
  giveSeeds(runtime);
  const planted = await runtime.performAction(plant(runtime));
  expect(planted.result).toMatchObject({ success: true });
  const portable = runtime.exportPortableCheckpoint();
  await runtime.persistPortableCheckpoint(portable);

  const restored = await create(testCorePlatform, [0.5, 60, 0.5], persistence);
  expect(restored.server.crops.checkpoint()).toEqual(runtime.server.crops.checkpoint());
  await expect(restored.server.prepareCanonicalChunkForMutation(0, 1, 0)).resolves.toBe(true);
  expect(restored.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
  restored.takeCommits();
  const before = capture(restored);

  const duplicate = await restored.performAction(plant(restored));

  expectNoPartialChange(restored, before, duplicate);
});

it('rejects a prepared planting when its observed above cell changes before receipt validation', async () => {
  const fixture: { runtime?: Runtime } = {};
  let armed = false;
  let triggered = false;
  let externalCommit: ReturnType<Runtime['server']['editBatch']> | null = null;
  const platform: CorePlatformPorts = {
    ...testCorePlatform,
    clone: <Value>(value: Value): Value => {
      if (
        armed &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.hasOwn(value, 'action') &&
        (value as { action?: unknown }).action === 'plant' &&
        Object.hasOwn(value, 'actorId') &&
        !Object.hasOwn(value, 'kind')
      ) {
        armed = false;
        triggered = true;
        if (!fixture.runtime) throw new Error('Stale crop fixture runtime is unavailable.');
        externalCommit = fixture.runtime.server.editBatch({
          actorId: 'external-stale-crop-fixture',
          edits: [put(above, Voxel.Stone)],
        });
      }
      return structuredClone(value);
    },
  };
  const runtime = await create(platform);
  fixture.runtime = runtime;
  await loadSurface(runtime);
  giveSeeds(runtime);
  runtime.takeCommits();
  const before = capture(runtime);
  armed = true;

  const response = await runtime.performAction(plant(runtime));

  expect(triggered).toBe(true);
  expect(externalCommit).toMatchObject({ committed: true, worldRevision: before.worldRevision + 1 });
  expect(response.result).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(runtime.server.crops.checkpoint()).toEqual(before.crops);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before.inventory);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(before.inventoryRevision);
  expect(runtime.server.worldRevision).toBe(before.worldRevision + 1);
  expect(runtime.server.gameplayRevision).toBe(before.gameplayRevision);
  expect(runtime.server.commitSequence).toBe(before.commitSequence + 1);
  expect(runtime.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
  expect(runtime.server.peekLoadedVoxel(...above)?.voxel).toBe(Voxel.Stone);
  expect(runtime.server.peekLoadedVoxel(...side)?.voxel).toBe(Voxel.Air);
});

it('revalidates line of sight when a prepared planting receives a new path blocker', async () => {
  const fixture: { runtime?: Runtime } = {};
  const blocker: Position = [0, 60, 0];
  let armed = false;
  let triggered = false;
  let externalCommit: ReturnType<Runtime['server']['editBatch']> | null = null;
  const platform: CorePlatformPorts = {
    ...testCorePlatform,
    clone: <Value>(value: Value): Value => {
      if (
        armed &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.hasOwn(value, 'action') &&
        (value as { action?: unknown }).action === 'plant' &&
        Object.hasOwn(value, 'actorId') &&
        !Object.hasOwn(value, 'kind')
      ) {
        armed = false;
        triggered = true;
        if (!fixture.runtime) throw new Error('LOS crop fixture runtime is unavailable.');
        externalCommit = fixture.runtime.server.editBatch({
          actorId: 'external-stale-crop-los-fixture',
          edits: [put(blocker, Voxel.Stone)],
        });
      }
      return structuredClone(value);
    },
  };
  const runtime = await create(platform);
  fixture.runtime = runtime;
  await loadSurface(runtime);
  expect(runtime.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
  expect(runtime.server.peekLoadedVoxel(...above)?.voxel).toBe(Voxel.Air);
  expect(runtime.server.peekLoadedVoxel(...blocker)?.voxel).toBe(Voxel.Air);
  giveSeeds(runtime);
  runtime.takeCommits();
  const before = capture(runtime, [hit, above, side, blocker]);
  armed = true;

  const response = await runtime.performAction(plant(runtime));

  expect(triggered).toBe(true);
  expect(externalCommit).toMatchObject({ committed: true, worldRevision: before.worldRevision + 1 });
  expect(
    response.result,
    'plant must be rejected after the unobstructed LOS path receives a blocker before commit',
  ).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(runtime.server.crops.checkpoint()).toEqual(before.crops);
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before.inventory);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(before.inventoryRevision);
  expect(runtime.server.worldRevision).toBe(before.worldRevision + 1);
  expect(runtime.server.gameplayRevision).toBe(before.gameplayRevision);
  expect(runtime.server.commitSequence).toBe(before.commitSequence + 1);
  expect(runtime.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
  expect(runtime.server.peekLoadedVoxel(...above)?.voxel).toBe(Voxel.Air);
  expect(runtime.server.peekLoadedVoxel(...side)?.voxel).toBe(Voxel.Air);
  expect(runtime.server.peekLoadedVoxel(...blocker)?.voxel).toBe(Voxel.Stone);
});
