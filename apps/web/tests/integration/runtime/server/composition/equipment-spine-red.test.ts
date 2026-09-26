import { describe, expect, it } from 'vitest';
import {
  defineContentModule,
  defineInventoryActionsModule,
  defineInventoryModule,
  definePack,
} from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks, createGameplayActorAuthority } from '@seedlands/stdlib/host';
import { GameplayRuntime } from '../../../../../../../packages/stdlib/src/server/gameplay/gameplay-runtime';
import { prepareCombatDamage } from '../../../../../../../packages/stdlib/src/server/gameplay/prepared-combat-damage';
import { prepareEntityMutation } from '../../../../../../../packages/stdlib/src/server/gameplay/prepared-entity-mutation';
import { EntityStore } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });

function nonClassicRuntime() {
  const inventory = defineInventoryModule();
  const actions = defineInventoryActionsModule();
  const pack = definePack({
    id: 'sample:equipment-world',
    version: '1.0.0',
    kind: 'playbook',
    modules: [
      defineContentModule({
        moduleId: 'sample:equipment-content',
        items: [
          {
            id: 'sample:visor',
            name: 'Visor',
            itemType: 'armor',
            stackLimit: 1,
            durability: { max: 40 },
            capabilities: [{ type: 'armor', slot: 'helmet', points: 2 }],
          },
          {
            id: 'sample:suit',
            name: 'Suit',
            itemType: 'armor',
            stackLimit: 1,
            durability: { max: 80 },
            capabilities: [{ type: 'armor', slot: 'chestplate', points: 5 }],
          },
        ],
        recipes: [],
        meleeDefinitions: [],
      }),
      inventory,
      actions,
    ],
  });
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
    { approvedPermissions: { [pack.manifest.id]: actions.descriptor.permissions! } },
  );
  const runtime = new GameplayRuntime({
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'pilot' }),
    platform: testCorePlatform,
    getVoxel: () => 0,
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('Unexpected voxel edit.');
    },
  });
  runtime.spawnPlayer({ id: 'pilot', position: [0, 2, 0] });
  return runtime;
}

describe('V2 equipment behavior RED', () => {
  it('equips a non-Classic registered visor through the real inventory pointer action', () => {
    const runtime = nonClassicRuntime();
    runtime.giveItem('pilot', { itemId: 'sample:visor', count: 1, instance: { durability: 37 } });
    let view = runtime.getInventoryPointerView('pilot');
    expect(
      runtime.inventoryPointer('pilot', {
        actor: view.actor,
        expectedInventoryRevision: view.revision,
        command: { kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 },
      }),
    ).toMatchObject({ success: true });
    view = runtime.getInventoryPointerView('pilot');
    const result = runtime.inventoryPointer('pilot', {
      actor: view.actor,
      expectedInventoryRevision: view.revision,
      command: { kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 },
    });

    expect(result).toEqual({
      success: true,
      value: {
        version: 1,
        success: true,
        kind: 'pointer',
        actorId: 'pilot',
        inventoryRevision: 3,
        cursorRevision: 2,
      },
    });
    expect(runtime.getInventoryPointerView('pilot').armor.helmet).toEqual({
      itemId: 'sample:visor',
      count: 1,
      instance: { durability: 37 },
    });
  });

  it('advances the shared inventory revision when only armor changes', () => {
    const runtime = nonClassicRuntime();
    const before = runtime.entities.actorComponentSnapshot('pilot');
    const prepared = prepareEntityMutation(runtime.entities, {
      actors: [
        {
          reference: runtime.entities.createReference('pilot')!,
          health: 20,
          components: {
            ...before,
            equipment: {
              ...before.equipment,
              armor: {
                ...emptyArmor(),
                helmet: { itemId: 'sample:visor', count: 1, instance: { durability: 37 } },
              },
            },
          },
        },
      ],
    });
    prepared.validate();
    prepared.apply();
    expect(runtime.entities.actorStateAccess('pilot').inventoryRevision).toBe((before.inventoryRevision ?? 0) + 1);
  });

  it('settles equipped armor through the existing combat death producer', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'target', type: 'player', position: [0, 2, 0], health: 3, maxHealth: 20 });
    const actor = entities.actorStateAccess('target');
    actor.inventory.add({ itemId: 'wood-block', count: 2 });
    actor.replaceInventoryInteraction(1, {
      version: 1,
      revision: 1,
      stack: { itemId: 'wood-block', count: 1 },
      origin: { kind: 'inventory', slot: 1 },
      craftingGrid: [{ itemId: 'wood-block', count: 1 }, null, null, null],
    });
    actor.replaceArmor({
      ...emptyArmor(),
      helmet: { itemId: 'iron-helmet', count: 1, instance: { durability: 2 } },
      chestplate: { itemId: 'iron-chestplate', count: 1, instance: { durability: 5 } },
    });
    const result = prepareCombatDamage({
      entities,
      targetId: 'target',
      damage: 3,
      deathInventory: { kind: 'legacy' },
      actorDeathDrop: () => null,
    });
    result.entity!.validate();
    result.entity!.apply();

    expect(entities.actorStateAccess('target').armor).toEqual(emptyArmor());
    expect(entities.query({ type: 'world-item' }).map((entry) => entry.stack)).toEqual([
      { itemId: 'wood-block', count: 2 },
      { itemId: 'wood-block', count: 1 },
      { itemId: 'wood-block', count: 1 },
      { itemId: 'iron-helmet', count: 1, instance: { durability: 2 } },
      { itemId: 'iron-chestplate', count: 1, instance: { durability: 5 } },
    ]);
  });
});
