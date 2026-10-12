import { expect, it, vi } from 'vitest';
import {
  defineTransportStorageModule,
  defineDeathInventoryPolicyModuleV1,
  type ModModule,
  type ModuleInvocationValue,
} from '@seedlands/stdlib/mod-api';
import { EntityStore } from '../../../../../../../packages/stdlib/src/server/gameplay/entity-store';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { create, deploy, putVoxel, type Runtime } from './transport-authority-test-fixture';

const storage = defineTransportStorageModule({
  moduleId: 'sample:transport-storage',
  operationId: 'sample:store-transport',
  fuels: [{ definitionId: 'sample:surface-cart', itemId: 'sample:stone', units: 4 }],
});
const dropPolicy = { inventory: 'drop', cursor: 'drop', crafting: 'drop', armor: 'drop', actor: 'retain' } as const;
const deathPolicy = defineDeathInventoryPolicyModuleV1({
  moduleId: 'sample:storage-death-policy',
  definition: {
    version: 1,
    actors: {
      player: dropPolicy,
      creature: { ...dropPolicy, actor: 'despawn' },
      npc: { ...dropPolicy, actor: 'despawn' },
    },
  },
});
async function prepared(extra: readonly ModModule[] = [], persistence?: MemoryGamePersistence) {
  const runtime = await create(undefined, persistence, [storage, ...extra]);
  await putVoxel(runtime, [3, 59, 0], 5);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:surface-cart-kit', count: 1 });
  expect((await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]))).result).toMatchObject({
    success: true,
  });
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:wood', count: 8 });
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:stone', count: 4 });
  return runtime;
}
const sides = (runtime: Runtime) => {
  const entity = runtime.server.queryEntities({ type: 'transport' })[0];
  const carrier = entity ? runtime.server.transportState(runtime.server.createEntityReference(entity.id)!) : null;
  return {
    inventory: runtime.server.getInventoryPointerView(runtime.playerId),
    carrier,
    revision: runtime.server.gameplayRevision,
    health: runtime.server.getEntity(runtime.playerId)!.health,
    drops: runtime.server.queryEntities({ type: 'world-item' }).map((entity) => structuredClone(entity)),
  };
};
const request = (runtime: Runtime, command: Record<string, ModuleInvocationValue>) => {
  const gameplay = runtime.exportPortableCheckpoint().gameplay;
  if (gameplay.version !== 4 || gameplay.entityStore.version !== 2)
    throw Error('Expected current component checkpoint.');
  const transport = runtime.view().transports![0]!;
  const component = gameplay.entityStore.transports?.find((entry) => entry.entityId === transport.reference.entityId);
  if (!component) throw Error('Expected current carrier component.');
  return {
    operationId: 'sample:store-transport',
    target: { kind: 'entity' as const, entityId: transport.reference.entityId },
    input: {
      version: 1,
      actor: runtime.server.createEntityReference(runtime.playerId)!,
      transport: transport.reference,
      expectedInventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
      expectedTransportRevision: component.revision,
      command,
    } as ModuleInvocationValue,
  };
};
const slot = (runtime: Runtime, itemId: string) =>
  runtime.server.getInventoryPointerView(runtime.playerId).slots.findIndex((entry) => entry?.itemId === itemId);

it('publishes cargo deposit, withdrawal and fuel consumption with actor and carrier revisions once', async () => {
  const runtime = await prepared(),
    before = sides(runtime);
  const deposit = request(runtime, {
    kind: 'transfer',
    direction: 'deposit',
    actorSlot: slot(runtime, 'sample:wood'),
    transportSlot: 0,
    count: 5,
  });
  const carrierRevision = (deposit.input as { expectedTransportRevision: number }).expectedTransportRevision;
  expect(runtime.server.invokeActorModuleOperation(runtime.playerId, deposit)).toMatchObject({ ok: true });
  expect(runtime.view().transports![0]!.inventory).toEqual([{ itemId: 'sample:wood', count: 5 }]);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(before.inventory.revision + 1);
  expect(runtime.server.gameplayRevision).toBe(before.revision + 1);
  expect(
    (
      request(runtime, { kind: 'refuel', actorSlot: slot(runtime, 'sample:stone'), count: 1 }).input as {
        expectedTransportRevision: number;
      }
    ).expectedTransportRevision,
  ).toBe(carrierRevision + 1);
  const replayBefore = sides(runtime);
  expect(runtime.server.invokeActorModuleOperation(runtime.playerId, deposit)).toMatchObject({ ok: false });
  expect(sides(runtime)).toEqual(replayBefore);
  expect(
    runtime.server.invokeActorModuleOperation(
      runtime.playerId,
      request(runtime, {
        kind: 'transfer',
        direction: 'withdraw',
        actorSlot: slot(runtime, 'sample:wood'),
        transportSlot: 0,
        count: 2,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(runtime.view().transports![0]!.inventory).toEqual([{ itemId: 'sample:wood', count: 3 }]);
  const fuelBefore = sides(runtime);
  const fuelRequest = request(runtime, { kind: 'refuel', actorSlot: slot(runtime, 'sample:stone'), count: 2 });
  const fuelRevision = (fuelRequest.input as { expectedTransportRevision: number }).expectedTransportRevision;
  expect(runtime.server.invokeActorModuleOperation(runtime.playerId, fuelRequest)).toMatchObject({ ok: true });
  expect(runtime.view().transports![0]!.fuel).toBe(8);
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(fuelBefore.inventory.revision + 1);
  const fuelAfter = sides(runtime);
  expect(
    (
      request(runtime, { kind: 'refuel', actorSlot: slot(runtime, 'sample:stone'), count: 1 }).input as {
        expectedTransportRevision: number;
      }
    ).expectedTransportRevision,
  ).toBe(fuelRevision + 1);
  expect(fuelAfter.revision).toBe(fuelBefore.revision + 1);
  expect(fuelAfter.inventory.slots[slot(runtime, 'sample:stone')]!.count).toBe(2);
});

it('rejects out-of-range and blocked carrier operations with both live sides unchanged', async () => {
  const runtime = await prepared();
  const carrier = runtime.view().transports![0]!;
  runtime.server.updateEntity(runtime.playerId, { position: [20, 60, 0.5] });
  let before = sides(runtime);
  expect(
    runtime.server.invokeActorModuleOperation(
      runtime.playerId,
      request(runtime, { kind: 'refuel', actorSlot: slot(runtime, 'sample:stone'), count: 1 }),
    ),
  ).toMatchObject({ ok: false });
  expect(sides(runtime)).toEqual(before);
  runtime.server.updateEntity(runtime.playerId, { position: [0.5, 60, 0.5] });
  await putVoxel(runtime, [2, 60, 0], 3);
  before = sides(runtime);
  expect(
    runtime.server.invokeActorModuleOperation(
      runtime.playerId,
      request(runtime, {
        kind: 'transfer',
        direction: 'deposit',
        actorSlot: slot(runtime, 'sample:wood'),
        transportSlot: 0,
        count: 1,
      }),
    ),
  ).toMatchObject({ ok: false });
  expect(sides(runtime)).toEqual(before);
  expect(runtime.server.resolveEntityReference(carrier.reference)).not.toBeNull();
});

for (const fault of [
  'inventory-change',
  'carrier-move',
  'actor-health-zero',
  'actor-death',
  'entity-owner-replace',
  'carrier-despawn',
] as const) {
  it(`rejects ${fault} after preparation without partially applying the proposed transfer`, async () => {
    const runtime = await prepared(fault === 'actor-death' ? [deathPolicy] : []);
    if (fault === 'actor-death' && runtime.server.getPlayerState(runtime.playerId).mode!.value !== 'survival') {
      const mode = runtime.server.invokeActorModuleOperation(runtime.playerId, {
        operationId: 'seedlands:set-mode',
        target: { kind: 'entity', entityId: runtime.playerId },
        input: { mode: 'survival' },
      });
      expect(mode, JSON.stringify(mode)).toMatchObject({ ok: true });
    }
    const command = request(runtime, {
      kind: 'transfer',
      direction: 'deposit',
      actorSlot: slot(runtime, 'sample:wood'),
      transportSlot: 0,
      count: 2,
    });
    const original = EntityStore.prototype.prepareMutation;
    let external: ReturnType<typeof sides> | undefined;
    const spy = vi.spyOn(EntityStore.prototype, 'prepareMutation').mockImplementation(function (
      this: EntityStore,
      input,
    ) {
      const mutation = original.call(this, input);
      if (!input.transports?.length || !input.actors?.length) return mutation;
      return {
        ...mutation,
        validate: () => {
          mutation.validate();
          if (external) return;
          if (fault === 'inventory-change')
            runtime.server.giveItem(runtime.playerId, { itemId: 'sample:wood', count: 1 });
          if (fault === 'carrier-move')
            runtime.server.updateEntity(input.transports![0]!.reference.entityId, { position: [4.5, 60, 0.5] });
          if (fault === 'actor-health-zero') {
            runtime.server.updateEntity(runtime.playerId, { health: 0 });
            expect(runtime.server.getEntity(runtime.playerId)!.health).toBe(0);
          }
          if (fault === 'actor-death') {
            const damage = runtime.server.applyDamage(runtime.playerId, runtime.playerId, 100, 'storage-owner-test');
            expect(damage, JSON.stringify(damage)).toMatchObject({ success: true });
            expect(runtime.server.getEntity(runtime.playerId)!.health).toBe(0);
          }
          if (fault === 'entity-owner-replace') this.restoreComponentSnapshot(this.exportComponentSnapshot());
          if (fault === 'carrier-despawn') {
            runtime.server.despawnEntity(input.transports![0]!.reference.entityId);
            expect(runtime.server.resolveEntityReference(input.transports![0]!.reference)).toBeNull();
          }
          external = sides(runtime);
        },
      };
    });
    try {
      const result = runtime.server.invokeActorModuleOperation(runtime.playerId, command);
      expect(result, JSON.stringify({ fault, external })).toMatchObject({ ok: false });
      expect(external, JSON.stringify(result)).toBeDefined();
      expect(sides(runtime)).toEqual(external);
    } finally {
      spy.mockRestore();
    }
  });
}

it('persists nonempty cargo and fuel and rejects an operation carrying the retired references', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const runtime = await prepared([], persistence);
  const old = request(runtime, { kind: 'refuel', actorSlot: slot(runtime, 'sample:stone'), count: 1 });
  expect(runtime.server.invokeActorModuleOperation(runtime.playerId, old)).toMatchObject({ ok: true });
  expect(
    runtime.server.invokeActorModuleOperation(
      runtime.playerId,
      request(runtime, {
        kind: 'transfer',
        direction: 'deposit',
        actorSlot: slot(runtime, 'sample:wood'),
        transportSlot: 0,
        count: 5,
      }),
    ),
  ).toMatchObject({ ok: true });
  const saved = runtime.view().transports![0]!;
  await runtime.persistPortableCheckpoint(runtime.exportPortableCheckpoint());
  const restored = await create(undefined, persistence, [storage]);
  expect(restored.view().transports![0]).toMatchObject({
    inventory: saved.inventory,
    fuel: saved.fuel,
    pose: saved.pose,
  });
  const before = sides(restored);
  expect(restored.server.invokeActorModuleOperation(restored.playerId, old)).toMatchObject({ ok: false });
  expect(sides(restored)).toEqual(before);
});
