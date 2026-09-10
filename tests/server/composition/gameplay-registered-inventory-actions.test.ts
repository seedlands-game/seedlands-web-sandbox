import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { testCorePlatform } from '../../support/core-platform';

function setup(
  withActions = true,
  extra: ModModule[] = [],
  hooks: {
    clone?(value: unknown): void;
    getVoxel?(position: [number, number, number]): number | undefined;
  } = {},
) {
  const modules = [
    ...pack.modules.filter(
      (module) =>
        withActions ||
        !['seedlands:inventory-actions-module', 'seedlands:behavior-registry-module'].includes(module.descriptor.id),
    ),
    ...extra,
  ];
  const root = definePack({ id: 'test:inventory-actions', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...root,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    {
      approvedPermissions: {
        'test:inventory-actions': modules.flatMap((module) => module.descriptor.permissions ?? []),
      },
    },
  );
  const authority = createGameplayActorAuthority(composition.resources, { playerAlias: 'human' });
  const world = new GameplayRuntime({
    composition,
    moduleActorAuthority: authority,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: {
      ...testCorePlatform,
      clone: <Value>(value: Value): Value => {
        hooks.clone?.(value);
        return structuredClone(value);
      },
    },
    getVoxel: hooks.getVoxel ?? (() => 0),
    getWorldTime: () => 9,
    prepareVoxelEdit: () => {
      throw new Error('unexpected voxel edit');
    },
  });
  world.spawnPlayer({ id: 'alice', position: [0, 0, 0] });
  world.spawn({ id: 'bob', type: 'npc', archetype: 'settler', position: [0, 0, 1], health: 20, maxHealth: 20 });
  return { world, authority };
}
describe('actual registered Inventory action consumers', () => {
  it.each([false, true])('lets only the first player or NPC pick up the same item (NPC first: %s)', (npcFirst) => {
    const { world } = setup();
    world.spawn({ id: 'drop', type: 'world-item', position: [0, 0, 0.5], stack: { itemId: 'wood-block', count: 2 } });
    const [winner, loser] = npcFirst ? ['bob', 'alice'] : ['alice', 'bob'];
    expect(world.pickupItem(winner, 'drop')).toEqual({ success: true });
    const before = world.createSnapshot();
    expect(world.pickupItem(loser, 'drop').success).toBe(false);
    expect(world.createSnapshot()).toEqual(before);
    expect(world.getInventory(winner).slots[0]).toEqual({ itemId: 'wood-block', count: 2 });
    expect(world.getInventory(loser).slots.every((slot) => slot === null)).toBe(true);
  });
  it('applies a rule veto to the real selection and pickup paths without committing', () => {
    const { world } = setup(true, [
      {
        descriptor: {
          id: 'test:veto',
          version: '1.0.0',
          permissions: [
            { resource: 'seedlands.inventory', operations: ['execute'] },
            { resource: 'seedlands.inventory-item', operations: ['execute'] },
          ],
        },
        register(api) {
          for (const kind of ['select', 'pickup'])
            api.registerRule({
              id: `test:veto-${kind}`,
              operationId: `seedlands:inventory-${kind}`,
              stage: 'after',
              apply: () => ({ reject: 'inventory-locked' }),
            });
        },
      },
    ]);
    world.spawn({ id: 'drop', type: 'world-item', position: [0, 0, 0.5], stack: { itemId: 'wood-block', count: 2 } });
    const before = world.createSnapshot();
    expect(world.selectHotbarSlot('alice', 1)).toMatchObject({ success: false, reason: 'inventory-locked' });
    expect(world.pickupItem('alice', 'drop')).toMatchObject({ success: false, reason: 'inventory-locked' });
    expect(world.createSnapshot()).toEqual(before);
  });
  it('does not restore implicit Inventory actions when their provider is absent', () => {
    const { world } = setup(false);
    world.giveItem('alice', { itemId: 'wood-block', count: 1 });
    const before = world.createSnapshot();
    expect(world.selectHotbarSlot('alice', 1).success).toBe(false);
    expect(world.craft('alice', 'planks').success).toBe(false);
    expect(world.dropItem('alice', 0, 1).success).toBe(false);
    expect(world.createSnapshot()).toEqual(before);
  });
  it.each(['wood-axe', 'unknown-recipe'])(
    'returns the committed recipe after a before rule replaces %s',
    (original) => {
      const { world } = setup(true, [
        {
          descriptor: {
            id: 'test:replace-recipe',
            version: '1.0.0',
            permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
          },
          register(api) {
            api.registerRule({
              id: 'test:replace-recipe',
              operationId: 'seedlands:inventory-craft',
              stage: 'before',
              apply: () => ({ input: { recipeId: 'planks' } }),
            });
          },
        },
      ]);
      world.giveItem('alice', { itemId: 'wood-block', count: 1 });
      expect(world.craft('alice', original)).toMatchObject({ success: true, recipe: { id: 'planks' } });
      expect(world.getInventory('alice').slots[0]).toEqual({ itemId: 'plank', count: 4 });
    },
  );
  it('rejects pickup when final result clone changes world visibility', () => {
    let blocked = false;
    const { world } = setup(true, [], {
      getVoxel: ([, , z]) => (blocked && z === 0 ? 3 : 0),
      clone(value) {
        if (value && typeof value === 'object' && 'kind' in value && value.kind === 'pickup' && 'success' in value)
          blocked = true;
      },
    });
    world.entities.update('alice', { position: [0, 0, -0.1] });
    world.spawn({ id: 'drop', type: 'world-item', position: [0, 0, 1.1], stack: { itemId: 'wood-block', count: 1 } });
    const before = world.createSnapshot();
    expect(world.pickupItem('alice', 'drop')).toMatchObject({ success: false, reason: 'blocked' });
    expect(blocked).toBe(true);
    expect(world.createSnapshot()).toEqual(before);
  });

  it('preserves inventory and a running weapon Action when dropping cannot allocate an entity', () => {
    const { world } = setup();
    world.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    const attack = world.attackEntity('alice', 'bob');
    expect(attack.success, JSON.stringify(attack)).toBe(true);
    const exhausted = world.createSnapshot();
    exhausted.entityStore.sequence = Number.MAX_SAFE_INTEGER;
    world.restoreSnapshot(exhausted);
    const before = world.createSnapshot();
    expect(world.dropItem('alice', 0, 1).success).toBe(false);
    expect(world.createSnapshot()).toEqual(before);
  });
  it('actors without a melee profile remain damageable but cannot initiate attacks', () => {
    const { world } = setup();
    const before = world.createSnapshot();
    expect(world.simulation.requestActorCombat('bob', 'alice', 'unarmed')).toMatchObject({
      success: false,
      reason: 'Combat actor has no configured melee definition.',
    });
    expect(world.createSnapshot()).toEqual(before);
    world.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    expect(world.attackEntity('alice', 'bob').success).toBe(true);
    world.advanceRules(0.3);
    expect(world.entities.get('bob')?.health).toBeLessThan(20);
    expect(world.entities.get('alice')?.health).toBe(20);
  });
  it('crafts, moves and consumes through the same ECS owner, and a changed weapon cancels Combat', () => {
    const { world } = setup();
    world.giveItem('alice', { itemId: 'wood-block', count: 1 });
    expect(world.craft('alice', 'planks')).toMatchObject({ success: true, recipe: { id: 'planks' } });
    expect(world.getInventory('alice').slots[0]).toEqual({ itemId: 'plank', count: 4 });
    expect(world.moveInventorySlot('alice', 0, 2)).toEqual({ success: true });
    world.giveItem('alice', { itemId: 'berry', count: 1 });
    world.setHungerForDebug('alice', 10);
    expect(world.useInventoryItem('alice', 0)).toEqual({ success: true });
    expect(world.entities.actorStateAccess('alice').hunger).toBeGreaterThan(10);
    world.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    const attack = world.attackEntity('alice', 'bob');
    expect(attack.success, JSON.stringify(attack)).toBe(true);
    expect(world.moveInventorySlot('alice', 0, 3)).toEqual({ success: true });
    expect(world.simulation.actions.forActor('alice')).toBeNull();
    expect(world.simulation.combat.snapshotFor('alice').active).toBeNull();
  });
});
