import { expect, it } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { GameplayRuntime } from '@seedlands/stdlib/server/gameplay/gameplay-runtime';
import { classicGameplayDomainOptions } from './classic-gameplay-domain-options';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const operationId = 'seedlands:explore-held-map';
const selfInput = { version: 1, trigger: 'self', target: { kind: 'self' } } as const;
const voxelByCoordinate = new Map<string, number>();
const key = (position: readonly number[]) => position.join(',');
const loaded = (position: [number, number, number]) => voxelByCoordinate.get(key(position));

const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicGameplayDomainOptions('navigation'),
    platform: testCorePlatform,
    environmentSeed: 71,
    getWorldTime: () => 6,
    getVoxel: loaded,
    getLoadedVoxel: loaded,
    prepareVoxelEdit: () => {
      throw new Error('navigation must not prepare voxel edits');
    },
  });
  world.spawnPlayer({ id: 'player', position: [4, 4, 0] });
  return world;
};

const invoke = (
  world: ReturnType<typeof createWorld>,
  input: unknown = selfInput,
  target: Readonly<{ kind: 'entity'; entityId: string }> = { kind: 'entity', entityId: 'player' },
) =>
  world.invokeActorModuleOperation('player', {
    operationId,
    target,
    input: input as typeof selfInput,
  });

const inventory = (world: ReturnType<typeof createWorld>) => world.getInventoryPointerView('player');

it('updates only loaded map pixels through the registered self operation and keeps map identity', () => {
  voxelByCoordinate.clear();
  // The map samples y=3: one voxel below the player body at y=4.
  voxelByCoordinate.set('4,3,0', Voxel.Grass);
  voxelByCoordinate.set('5,3,0', Voxel.Water);
  const world = createWorld();
  world.giveItem('player', { itemId: 'map', count: 1 });
  world.giveItem('player', { itemId: 'compass', count: 1 });
  world.giveItem('player', { itemId: 'clock', count: 1 });
  const beforeInventory = inventory(world);

  const first = invoke(world);
  expect(first.ok, JSON.stringify(first)).toBe(true);
  expect(world.navigationItems.list()).toHaveLength(1);
  const initial = world.navigationItems.list()[0]!;
  expect(initial).toMatchObject({ id: 'map-1', playerId: 'player', center: [4, 0], scale: 0 });
  expect(initial.pixels).toContainEqual({ x: 0, z: 0, color: 2 });
  expect(initial.pixels).toContainEqual({ x: 1, z: 0, color: 1 });
  expect(inventory(world)).toEqual(beforeInventory);

  // The center is now an unknown/unloaded sample; its prior pixel is retained.
  voxelByCoordinate.set('4,3,0', Voxel.Sand);
  voxelByCoordinate.delete('5,3,0');
  const second = invoke(world);
  expect(second.ok).toBe(true);
  const updated = world.navigationItems.list()[0]!;
  expect(updated.id).toBe('map-1');
  expect(updated.pixels).toContainEqual({ x: 0, z: 0, color: 3 });
  expect(updated.pixels).toContainEqual({ x: 1, z: 0, color: 1 });
  expect(world.navigationItems.checkpoint().sequence).toBe(1);
  expect(inventory(world)).toEqual(beforeInventory);
  expect(world.navigationItems.held('player')).toMatchObject({ itemId: 'map', kind: 'map', map: updated });
});

it('projects the actually selected compass, clock, and map and restores optional navigation state', () => {
  voxelByCoordinate.clear();
  voxelByCoordinate.set('4,3,0', Voxel.Grass);
  const world = createWorld();
  world.giveItem('player', { itemId: 'map', count: 1 });
  world.giveItem('player', { itemId: 'compass', count: 1 });
  world.giveItem('player', { itemId: 'clock', count: 1 });
  const exploration = invoke(world);
  expect(exploration.ok, JSON.stringify(exploration)).toBe(true);

  // This profile intentionally excludes inventory-action modules; set the authoritative
  // selected-slot component as fixture state while exercising the real held projection.
  world.entities.actorStateAccess('player').selectedSlot = 1;
  expect(world.navigationItems.held('player')).toMatchObject({
    itemId: 'compass',
    kind: 'compass',
    target: [4, 4, 0],
  });
  world.updateEntity('player', { position: [4, 4, 4] });
  expect(world.navigationItems.held('player')).toMatchObject({ kind: 'compass', turns: 0.75 });

  world.entities.actorStateAccess('player').selectedSlot = 2;
  expect(world.navigationItems.held('player')).toMatchObject({
    itemId: 'clock',
    kind: 'clock',
    worldTime: 6,
    phase: 0.25,
  });
  world.entities.actorStateAccess('player').selectedSlot = 0;
  expect(world.navigationItems.held('player')).toMatchObject({ itemId: 'map', kind: 'map', map: { id: 'map-1' } });

  const snapshot = world.createSnapshot();
  const restored = createWorld();
  restored.restoreSnapshot(snapshot);
  expect(restored.navigationItems.list()).toEqual(world.navigationItems.list());
  expect(restored.navigationItems.held('player')).toMatchObject({ kind: 'map', map: { id: 'map-1' } });

  const legacyWithoutNavigationChild = structuredClone(snapshot);
  delete legacyWithoutNavigationChild.navigationItems;
  const emptyOwner = createWorld();
  emptyOwner.restoreSnapshot(legacyWithoutNavigationChild);
  expect(emptyOwner.navigationItems.list()).toEqual([]);
  expect(emptyOwner.navigationItems.held('player')).toMatchObject({ itemId: 'map', kind: 'map', map: null });
});

it('rejects invalid target, non-self trigger, unselected map, and dead player without writes', () => {
  voxelByCoordinate.clear();
  voxelByCoordinate.set('4,3,0', Voxel.Grass);
  const world = createWorld();
  world.giveItem('player', { itemId: 'map', count: 1 });
  world.giveItem('player', { itemId: 'compass', count: 1 });
  const before = () => ({
    navigation: world.navigationItems.checkpoint(),
    inventory: inventory(world),
    gameplayRevision: world.gameplayRevision,
  });
  const expectNoWrite = (state: ReturnType<typeof before>) => {
    expect(world.navigationItems.checkpoint()).toEqual(state.navigation);
    expect(inventory(world)).toEqual(state.inventory);
    expect(world.gameplayRevision).toBe(state.gameplayRevision);
  };

  let state = before();
  expect(invoke(world, selfInput, { kind: 'entity', entityId: 'other' }).ok).toBe(false);
  expectNoWrite(state);

  state = before();
  expect(invoke(world, { version: 1, trigger: 'voxel', target: { kind: 'self' } }).ok).toBe(false);
  expectNoWrite(state);

  world.entities.actorStateAccess('player').selectedSlot = 1;
  state = before();
  expect(invoke(world).ok).toBe(false);
  expectNoWrite(state);

  world.entities.actorStateAccess('player').selectedSlot = 0;
  world.entities.update('player', { health: 0 });
  expect(world.getPlayerState('player').lifecycle).toBe('dead');
  state = before();
  expect(invoke(world).ok).toBe(false);
  expectNoWrite(state);
});
