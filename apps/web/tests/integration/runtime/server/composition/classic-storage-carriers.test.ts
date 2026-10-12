import { expect, it, vi } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { classicOptions } from '../../../../fixtures/classic/content';
import { itemInteractionSelection } from '../../../../../src/app/player/secondary-interaction';

async function deployed(itemId: string) {
  const options = {
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    seedText: 'classic-storage-carriers',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [2.5, 32.6, 2.5] as [number, number, number],
    persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
  };
  const runtime = await AuthorityRuntime.create({ ...options, epoch: 'classic-storage-carriers' });
  const edits = [];
  for (let x = -1; x <= 8; x++)
    for (let z = -1; z <= 3; z++)
      for (let y = 30; y <= 34; y++) edits.push({ x, y, z, value: y === 30 ? Voxel.Stone : Voxel.Air });
  for (let x = 1; x <= 6; x++) edits.push({ x, y: 31, z: 0, value: Voxel.Rail });
  expect((await runtime.editWorld('classic-storage-carrier-site', edits)).committed).toBe(true);
  runtime.server.giveItem(runtime.playerId, { itemId, count: 1 });
  const invocation = vi.spyOn(runtime.server, 'invokeActorModuleOperation');
  try {
    const response = await runtime.performAction({
      type: 'interact',
      intent: 'use',
      target: { kind: 'voxel', hit: [2, 31, 0], adjacent: [2, 32, 0] },
      expectedSelection: itemInteractionSelection(runtime.view()),
    });
    expect(response.result, JSON.stringify(response.result)).toMatchObject({ success: true });
  } catch (error) {
    const rejected = invocation.mock.results.flatMap(({ value }) =>
      value?.ok === false ? [{ code: value.code, message: value.message }] : [],
    );
    throw new Error(JSON.stringify(rejected), { cause: error });
  } finally {
    invocation.mockRestore();
  }
  return { runtime, options };
}

const slot = (runtime: AuthorityRuntime, itemId: string) =>
  runtime.server.getInventoryPointerView(runtime.playerId).slots.findIndex((entry) => entry?.itemId === itemId);

const action = (runtime: AuthorityRuntime) => {
  const site = runtime.view().transportStorage![0]!;
  return {
    type: 'transport-storage' as const,
    version: 1 as const,
    actor: runtime.server.createEntityReference(runtime.playerId)!,
    transport: site.reference,
    expectedInventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
    expectedTransportRevision: site.revision,
  };
};

it('deploys the formal chest carrier and conserves items through normal Authority deposit and withdrawal', async () => {
  const { runtime } = await deployed('chest-minecart');
  expect(runtime.view().transports![0]).toMatchObject({
    definitionId: 'seedlands:chest-minecart',
    fuel: null,
    rider: null,
  });
  expect(runtime.view().transportStorage![0]!.inventory).toHaveLength(27);
  runtime.server.giveItem(runtime.playerId, { itemId: 'plank', count: 5 });
  expect(
    (
      await runtime.performAction({
        ...action(runtime),
        command: {
          kind: 'transfer',
          direction: 'deposit',
          actorSlot: slot(runtime, 'plank'),
          transportSlot: 26,
          count: 2,
        },
      })
    ).result,
  ).toMatchObject({ success: true });
  expect(runtime.view().transportStorage![0]!.inventory[26]).toMatchObject({ itemId: 'plank', count: 2 });
  expect(
    (
      await runtime.performAction({
        ...action(runtime),
        command: {
          kind: 'transfer',
          direction: 'withdraw',
          actorSlot: slot(runtime, 'plank'),
          transportSlot: 26,
          count: 1,
        },
      })
    ).result,
  ).toMatchObject({ success: true });
  expect(runtime.view().transportStorage![0]!.inventory[26]).toMatchObject({ itemId: 'plank', count: 1 });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).slots[slot(runtime, 'plank')]).toMatchObject({
    count: 4,
  });
});

it('consumes coal once and drives the formal unmounted furnace carrier through the normal physics session', async () => {
  const { runtime } = await deployed('furnace-minecart');
  const empty = runtime.view().transports![0]!;
  expect(empty).toMatchObject({ definitionId: 'seedlands:furnace-minecart', fuel: 0, rider: null });
  runtime.advanceSession(200);
  expect(runtime.view().transports![0]!.pose).toEqual(empty.pose);
  runtime.server.giveItem(runtime.playerId, { itemId: 'coal', count: 1 });
  expect(
    (
      await runtime.performAction({
        ...action(runtime),
        command: { kind: 'refuel', actorSlot: slot(runtime, 'coal'), count: 1 },
      })
    ).result,
  ).toMatchObject({ success: true });
  const fueled = runtime.view().transports![0]!;
  expect(fueled.fuel).toBe(720);
  expect(slot(runtime, 'coal')).toBe(-1);
  runtime.advanceSession(500);
  const moved = runtime.view().transports![0]!;
  const distance = Math.hypot(...moved.pose.position.map((value, axis) => value - fueled.pose.position[axis]!));
  expect(distance).toBeGreaterThan(0);
  expect(moved.fuel).toBeCloseTo(720 - distance, 8);
  expect(moved.rider).toBeNull();
});

it('moves a fueled carrier while another route carrier remains stationary in the same prepared frame', async () => {
  const { runtime } = await deployed('furnace-minecart');
  runtime.server.giveItem(runtime.playerId, { itemId: 'chest-minecart', count: 1 });
  expect(
    (
      await runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'voxel', hit: [5, 31, 0], adjacent: [5, 32, 0] },
        expectedSelection: itemInteractionSelection(runtime.view()),
      })
    ).result,
  ).toMatchObject({ success: true });
  const chest = runtime.view().transports!.find((entry) => entry.definitionId === 'seedlands:chest-minecart')!;
  runtime.server.giveItem(runtime.playerId, { itemId: 'coal', count: 1 });
  expect(
    (
      await runtime.performAction({
        ...action(runtime),
        command: { kind: 'refuel', actorSlot: slot(runtime, 'coal'), count: 1 },
      })
    ).result,
  ).toMatchObject({ success: true });
  const fueled = runtime.view().transports![0]!;
  runtime.advanceSession(500);
  const moved = runtime.view().transports![0]!;
  const distance = Math.hypot(...moved.pose.position.map((value, axis) => value - fueled.pose.position[axis]!));
  expect(distance).toBeGreaterThan(0);
  expect(moved.fuel).toBeCloseTo(720 - distance, 8);
  expect(runtime.view().transports!.find((entry) => entry.definitionId === chest.definitionId)).toEqual(chest);
});

it.each(['chest-minecart', 'furnace-minecart'])(
  'rejects mounting formal %s without changing either owner',
  async (itemId) => {
    const { runtime } = await deployed(itemId);
    const before = runtime.view();
    expect(
      (
        await runtime.performAction({
          type: 'interact',
          intent: 'use',
          target: { kind: 'entity', reference: before.transports![0]!.reference },
          expectedSelection: itemInteractionSelection(before),
        })
      ).result,
    ).toMatchObject({ success: false });
    expect(runtime.view().transports).toEqual(before.transports);
    expect(runtime.view().inventory).toEqual(before.inventory);
    expect(runtime.server.gameplayRevision).toBe(before.gameplayRevision);
  },
);

it.each(['chest-minecart', 'furnace-minecart'])(
  'restores nonempty formal %s state through a full portable checkpoint before physics resumes',
  async (itemId) => {
    const { runtime, options } = await deployed(itemId);
    const chest = itemId === 'chest-minecart';
    runtime.server.giveItem(runtime.playerId, { itemId: chest ? 'plank' : 'coal', count: 1 });
    const command = chest
      ? {
          kind: 'transfer' as const,
          direction: 'deposit' as const,
          actorSlot: slot(runtime, 'plank'),
          transportSlot: 26,
          count: 1,
        }
      : { kind: 'refuel' as const, actorSlot: slot(runtime, 'coal'), count: 1 };
    expect((await runtime.performAction({ ...action(runtime), command })).result).toMatchObject({ success: true });
    if (!chest) runtime.advanceSession(200);
    const saved = runtime.view().transports![0]!;
    const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
    await runtime.persistPortableCheckpoint(runtime.exportPortableCheckpoint());
    const restored = await AuthorityRuntime.create({ ...options, epoch: 'classic-storage-carrier-restored' });
    const carrier = restored.view().transports![0]!;
    expect(carrier).toEqual({ ...saved, reference: { ...saved.reference, epoch: saved.reference.epoch + 1 } });
    expect(restored.server.getInventoryPointerView(restored.playerId)).toEqual({
      ...inventory,
      actor: { ...inventory.actor, epoch: inventory.actor.epoch + 1 },
    });
    if (!chest) {
      expect(Math.hypot(...carrier.velocity)).toBeGreaterThan(0);
      restored.advanceSession(100);
      expect(restored.view().transports![0]!.fuel).toBeLessThan(carrier.fuel!);
    }
  },
);
