import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import { createGameplayActorAuthority } from '../../src/server/composition/gameplay-actor-authority';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { prepareEntityMutation } from '../../src/server/gameplay/prepared-entity-mutation';
import { defineCombatModule } from '../../src/server/gameplay/modules/combat-module';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import type { InventoryPointerCommand } from '../../src/server/gameplay/modules/inventory-pointer-contract';
import { defineStationActionsModule } from '../../src/server/gameplay/modules/station-actions-module';
import { testCorePlatform } from '../support/core-platform';

const armorItems = [
  {
    id: 'sample:visor',
    name: 'Visor',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 40 },
    capabilities: [{ type: 'armor' as const, slot: 'helmet' as const, points: 2 }],
  },
  {
    id: 'sample:suit',
    name: 'Suit',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 80 },
    capabilities: [{ type: 'armor' as const, slot: 'chestplate' as const, points: 5 }],
  },
  {
    id: 'sample:greaves',
    name: 'Greaves',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 70 },
    capabilities: [{ type: 'armor' as const, slot: 'leggings' as const, points: 4 }],
  },
  {
    id: 'sample:boots',
    name: 'Boots',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 30 },
    capabilities: [{ type: 'armor' as const, slot: 'boots' as const, points: 1 }],
  },
  { id: 'sample:filler', name: 'Filler', itemType: 'resource' as const, stackLimit: 1, capabilities: [] },
] as const;

type RuntimeHook = (runtime: GameplayRuntime) => void;

function setup(options: Readonly<{ authorized?: boolean }> = {}) {
  const holder: { runtime: GameplayRuntime | null } = { runtime: null };
  let afterPrepared: RuntimeHook | undefined;
  let hookUsed = false;
  const modules = [
    defineContentModule({
      moduleId: 'sample:station-equipment-content',
      items: armorItems,
      recipes: [],
      meleeDefinitions: [
        {
          id: 'sample:punch',
          range: 4,
          steps: [{ damage: 1, windupSeconds: 1, hitSeconds: 0.1, recoverySeconds: 0.1 }],
        },
      ],
      stations: {
        definitions: [{ kind: 'workbench', voxel: 11 }],
        recipes: [],
        furnaceRecipes: [],
        fuels: [],
      },
    }),
    defineCombatModule(),
    defineStationActionsModule(),
  ];
  const pack = definePack({ id: 'sample:station-equipment', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: {
          algorithm: 'sha256',
          manifestDigest: 'a'.repeat(64),
          entryDigest: 'b'.repeat(64),
          resources: [],
        },
      },
    ],
    { approvedPermissions: { [pack.manifest.id]: modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const actorAuthority = createGameplayActorAuthority(composition.resources, { playerAlias: 'pilot' });
  const runtime = new GameplayRuntime({
    composition,
    ...(options.authorized === false ? {} : { moduleActorAuthority: actorAuthority }),
    platform: {
      ...testCorePlatform,
      clone: <Value>(value: Value): Value => {
        if (
          holder.runtime &&
          afterPrepared &&
          !hookUsed &&
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          (value as { kind?: unknown }).kind === 'pointer' &&
          (value as { success?: unknown }).success === true &&
          !Object.hasOwn(value, 'actorReference')
        ) {
          hookUsed = true;
          afterPrepared(holder.runtime);
        }
        return structuredClone(value);
      },
    },
    getVoxel: ([x, y, z]) => (x === 2 && y === 0 && z === 0 ? 11 : 0),
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('Unexpected voxel edit.');
    },
  });
  holder.runtime = runtime;
  runtime.spawnPlayer({ id: 'pilot', position: [0.5, 0, 0.5] });
  runtime.entities.spawn({ id: 'workbench', type: 'station', position: [2, 0, 0], station: { kind: 'workbench' } });
  const pointer = (command: InventoryPointerCommand) => {
    const view = runtime.getInventoryPointerView('pilot');
    return runtime.inventoryPointer('pilot', {
      actor: view.actor,
      expectedInventoryRevision: view.revision,
      station: {
        reference: runtime.entities.createReference('workbench')!,
        expectedRevision: runtime.entities.stationSnapshot('workbench').revision,
      },
      command,
    });
  };
  return {
    runtime,
    pointer,
    afterNextPrepare(hook: RuntimeHook) {
      afterPrepared = hook;
      hookUsed = false;
    },
    actorAuthority,
  };
}

const stackKey = (stack: Readonly<{ itemId: string; count: number; instance?: { durability: number } }>) =>
  JSON.stringify(stack);

function ownedStacks(runtime: GameplayRuntime): string[] {
  const view = runtime.getInventoryPointerView('pilot');
  const station = runtime.entities.stationSnapshot('workbench');
  const stationSlots = station.kind === 'workbench' ? station.grid : [];
  return [
    ...view.slots,
    view.cursor.stack,
    ...view.cursor.craftingGrid,
    ...Object.values(view.armor),
    ...stationSlots,
    ...runtime.entities.query({ type: 'world-item' }).map((entry) => entry.stack ?? null),
  ]
    .filter((stack): stack is NonNullable<typeof stack> => stack !== null)
    .map(stackKey)
    .sort();
}

const putCursor = (
  runtime: GameplayRuntime,
  stack: NonNullable<ReturnType<typeof runtime.getInventoryPointerView>['cursor']['stack']>,
  origin: ReturnType<typeof runtime.getInventoryPointerView>['cursor']['origin'],
) => {
  const actor = runtime.entities.actorStateAccess('pilot');
  actor.replaceInventoryInteraction(actor.inventoryRevision + 1, {
    version: 1,
    revision: actor.inventoryCursor.revision + 1,
    stack,
    origin,
    craftingGrid: [null, null, null, null],
  });
};

describe('registered station equipment host', () => {
  it('commits a station-context equipment candidate without losing the durable item', () => {
    const { runtime, pointer } = setup();
    runtime.giveItem('pilot', { itemId: 'sample:visor', count: 1, instance: { durability: 31 } });
    expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toMatchObject({
      success: true,
    });
    const before = runtime.getInventoryPointerView('pilot');
    expect(pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 })).toMatchObject({
      success: true,
    });

    const after = runtime.getInventoryPointerView('pilot');
    expect(after.revision).toBe(before.revision + 1);
    expect(after.cursor.stack).toBeNull();
    expect(after.armor.helmet).toEqual({
      itemId: 'sample:visor',
      count: 1,
      instance: { durability: 31 },
    });
    expect(runtime.entities.stationSnapshot('workbench').revision).toBe(0);
    expect(runtime.entities.query({ type: 'world-item' })).toEqual([]);
    expect(ownedStacks(runtime)).toEqual([
      stackKey({ itemId: 'sample:visor', count: 1, instance: { durability: 31 } }),
    ]);
  });

  it('moves boots from equipment to the bag without changing the station', () => {
    const { runtime, pointer } = setup();
    runtime.entities.actorStateAccess('pilot').replaceArmor({
      helmet: null,
      chestplate: null,
      leggings: null,
      boots: { itemId: 'sample:boots', count: 1, instance: { durability: 23 } },
    });
    const conserved = ownedStacks(runtime);
    const before = runtime.getInventoryPointerView('pilot');
    expect(pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'boots' }, button: 0 })).toMatchObject({
      success: true,
    });
    const picked = runtime.getInventoryPointerView('pilot');
    expect(picked.revision).toBe(before.revision + 1);
    expect(picked.armor.boots).toBeNull();
    expect(picked.cursor).toMatchObject({
      stack: { itemId: 'sample:boots', instance: { durability: 23 } },
      origin: { kind: 'equipment', slot: 'boots' },
    });
    expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toMatchObject({
      success: true,
    });
    const placed = runtime.getInventoryPointerView('pilot');
    expect(placed.revision).toBe(picked.revision + 1);
    expect(placed.slots[0]).toEqual({ itemId: 'sample:boots', count: 1, instance: { durability: 23 } });
    expect(placed.cursor.stack).toBeNull();
    expect(runtime.entities.stationSnapshot('workbench').revision).toBe(0);
    expect(ownedStacks(runtime)).toEqual(conserved);
  });

  it('atomically swaps an occupied chestplate and preserves both durable instances', () => {
    const { runtime, pointer } = setup();
    runtime.entities.actorStateAccess('pilot').replaceArmor({
      helmet: null,
      chestplate: { itemId: 'sample:suit', count: 1, instance: { durability: 71 } },
      leggings: null,
      boots: null,
    });
    runtime.giveItem('pilot', { itemId: 'sample:suit', count: 1, instance: { durability: 63 } });
    const conserved = ownedStacks(runtime);
    expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toMatchObject({
      success: true,
    });
    const before = runtime.getInventoryPointerView('pilot');
    expect(pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'chestplate' }, button: 0 })).toMatchObject({
      success: true,
    });
    const after = runtime.getInventoryPointerView('pilot');
    expect(after.revision).toBe(before.revision + 1);
    expect(after.armor.chestplate?.instance?.durability).toBe(63);
    expect(after.cursor).toMatchObject({
      stack: { itemId: 'sample:suit', instance: { durability: 71 } },
      origin: { kind: 'equipment', slot: 'chestplate' },
    });
    expect(runtime.entities.stationSnapshot('workbench').revision).toBe(0);
    expect(ownedStacks(runtime)).toEqual(conserved);
  });

  it('returns an equipment-origin leggings cursor on station-context close', () => {
    const { runtime, pointer } = setup();
    runtime.entities.actorStateAccess('pilot').replaceArmor({
      helmet: null,
      chestplate: null,
      leggings: { itemId: 'sample:greaves', count: 1, instance: { durability: 61 } },
      boots: null,
    });
    const conserved = ownedStacks(runtime);
    expect(pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'leggings' }, button: 0 })).toMatchObject({
      success: true,
    });
    const beforeClose = runtime.getInventoryPointerView('pilot');
    expect(beforeClose.cursor.origin).toEqual({ kind: 'equipment', slot: 'leggings' });
    expect(pointer({ kind: 'close' })).toMatchObject({ success: true });
    const after = runtime.getInventoryPointerView('pilot');
    expect(after.revision).toBe(beforeClose.revision + 1);
    expect(after.cursor.stack).toBeNull();
    expect(after.armor.leggings).toEqual({
      itemId: 'sample:greaves',
      count: 1,
      instance: { durability: 61 },
    });
    expect(runtime.entities.stationSnapshot('workbench').revision).toBe(0);
    expect(ownedStacks(runtime)).toEqual(conserved);
  });

  it('publishes one registered fact and clears a selected-tool break action', () => {
    const { runtime, actorAuthority } = setup();
    runtime.giveItem('pilot', { itemId: 'sample:visor', count: 1, instance: { durability: 19 } });
    runtime.entities.playerStateAccess('pilot').breakAction = {
      position: [1, 0, 0],
      voxel: 1,
      elapsedSeconds: 0.1,
      requiredSeconds: 1,
    };
    const authority = actorAuthority.forActor('pilot', 'player')!;
    const binding = runtime.bindModuleOperations(authority.authorizer, {
      moduleId: 'seedlands:station-actions-module',
      principalId: authority.principalId,
      originalActorId: 'pilot',
    });
    const facts: unknown[] = [];
    binding.subscribe((fact) => facts.push(fact));
    const view = runtime.getInventoryPointerView('pilot');
    const result = binding.invoke({
      operationId: 'seedlands:station-transfer',
      target: { kind: 'entity', entityId: 'workbench' },
      input: {
        actor: view.actor,
        expectedInventoryRevision: view.revision,
        station: {
          reference: runtime.entities.createReference('workbench')!,
          expectedRevision: 0,
        },
        command: { kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 },
      },
    });
    expect(result).toMatchObject({ ok: true });
    expect(facts).toHaveLength(1);
    expect(runtime.entities.playerStateAccess('pilot').breakAction).toBeNull();
    expect(runtime.metrics().inventoryOperationCount).toBe(2);
    expect(runtime.entities.stationSnapshot('workbench').revision).toBe(0);
  });

  it('uses the real cancellation participant for active combat when the selected stack changes', () => {
    const { runtime, pointer } = setup();
    runtime.entities.spawn({ id: 'target', type: 'npc', position: [1, 0, 0], health: 20, maxHealth: 20 });
    runtime.giveItem('pilot', { itemId: 'sample:visor', count: 1, instance: { durability: 18 } });
    const actor = runtime.entities.createReference('pilot')!;
    expect(
      runtime.simulation.combat.request('pilot', 'target', 'sample:punch', undefined, {
        version: 1,
        principalSubject: 'seedlands:local-player',
        provenance: { packId: 'sample:station-equipment', moduleId: 'seedlands:combat-module' },
        originalActor: { entityId: 'pilot', lifetime: actor.lifetime },
      }),
    ).toMatchObject({ success: true });
    expect(runtime.simulation.combat.snapshotFor('pilot').active).not.toBeNull();

    expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toMatchObject({
      success: true,
    });
    expect(runtime.simulation.combat.snapshotFor('pilot').active).toBeNull();
  });

  it('publishes one fact and spawns one drop when close cannot return an equipment-origin cursor', () => {
    const { runtime, actorAuthority } = setup();
    const actor = runtime.entities.actorStateAccess('pilot');
    actor.inventory.add({ itemId: 'sample:filler', count: actor.inventory.capacity });
    actor.replaceArmor({
      helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 7 } },
      chestplate: null,
      leggings: null,
      boots: null,
    });
    putCursor(
      runtime,
      { itemId: 'sample:visor', count: 1, instance: { durability: 5 } },
      { kind: 'equipment', slot: 'helmet' },
    );
    const authority = actorAuthority.forActor('pilot', 'player')!;
    const binding = runtime.bindModuleOperations(authority.authorizer, {
      moduleId: 'seedlands:station-actions-module',
      principalId: authority.principalId,
      originalActorId: 'pilot',
    });
    const facts: unknown[] = [];
    binding.subscribe((fact) => facts.push(fact));
    const view = runtime.getInventoryPointerView('pilot');
    expect(
      binding.invoke({
        operationId: 'seedlands:station-transfer',
        target: { kind: 'entity', entityId: 'workbench' },
        input: {
          actor: view.actor,
          expectedInventoryRevision: view.revision,
          station: {
            reference: runtime.entities.createReference('workbench')!,
            expectedRevision: 0,
          },
          command: { kind: 'close' },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(facts).toHaveLength(1);
    expect(runtime.entities.query({ type: 'world-item' }).map((entry) => entry.stack)).toEqual([
      { itemId: 'sample:visor', count: 1, instance: { durability: 5 } },
    ]);
    expect(runtime.getInventoryPointerView('pilot').armor.helmet?.instance?.durability).toBe(7);
    expect(runtime.entities.stationSnapshot('workbench').revision).toBe(0);
  });

  it('rejects missing actor authorization without changing any owner', () => {
    const { runtime, pointer } = setup({ authorized: false });
    putCursor(runtime, { itemId: 'sample:visor', count: 1, instance: { durability: 17 } }, null);
    const before = runtime.createSnapshot();
    expect(pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 })).toEqual({
      success: false,
      reason: 'station-rejected',
    });
    expect(runtime.createSnapshot()).toEqual(before);
  });

  it('rejects an actor change after prepare without applying the candidate', () => {
    const fixture = setup();
    putCursor(fixture.runtime, { itemId: 'sample:visor', count: 1, instance: { durability: 13 } }, null);
    let concurrent: ReturnType<GameplayRuntime['entities']['exportComponentSnapshot']> | undefined;
    fixture.afterNextPrepare((runtime) => {
      runtime.entities.actorStateAccess('pilot').inventory.add({ itemId: 'sample:filler', count: 1 });
      concurrent = runtime.entities.exportComponentSnapshot();
    });
    expect(fixture.pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 }).success).toBe(
      false,
    );
    expect(fixture.runtime.entities.exportComponentSnapshot()).toEqual(concurrent);
    expect(fixture.runtime.getInventoryPointerView('pilot').armor.helmet).toBeNull();
  });

  it('rejects a station change after prepare without applying the actor candidate', () => {
    const fixture = setup();
    putCursor(fixture.runtime, { itemId: 'sample:visor', count: 1, instance: { durability: 11 } }, null);
    let concurrent: ReturnType<GameplayRuntime['entities']['exportComponentSnapshot']> | undefined;
    fixture.afterNextPrepare((runtime) => {
      const station = runtime.entities.stationSnapshot('workbench');
      const mutation = prepareEntityMutation(runtime.entities, {
        stations: [
          {
            reference: runtime.entities.createReference('workbench')!,
            snapshot: { ...station, revision: station.revision + 1 },
          },
        ],
      });
      mutation.validate();
      mutation.apply();
      concurrent = runtime.entities.exportComponentSnapshot();
    });
    expect(fixture.pointer({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 }).success).toBe(
      false,
    );
    expect(fixture.runtime.entities.exportComponentSnapshot()).toEqual(concurrent);
    expect(fixture.runtime.getInventoryPointerView('pilot').armor.helmet).toBeNull();
  });

  it('rejects close-drop spawn capacity without partially clearing cursor, armor, or station', () => {
    const fixture = setup();
    const actor = fixture.runtime.entities.actorStateAccess('pilot');
    actor.inventory.add({ itemId: 'sample:filler', count: actor.inventory.capacity });
    actor.replaceArmor({
      helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 7 } },
      chestplate: null,
      leggings: null,
      boots: null,
    });
    putCursor(
      fixture.runtime,
      { itemId: 'sample:visor', count: 1, instance: { durability: 5 } },
      { kind: 'equipment', slot: 'helmet' },
    );
    const full = fixture.runtime.createSnapshot();
    fixture.runtime.restoreSnapshot({
      ...full,
      entityStore: { ...full.entityStore, lifetimeHighWater: Number.MAX_SAFE_INTEGER },
    });
    const before = fixture.runtime.createSnapshot();
    expect(fixture.pointer({ kind: 'close' }).success).toBe(false);
    expect(fixture.runtime.createSnapshot()).toEqual(before);
    expect(fixture.runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });
});
