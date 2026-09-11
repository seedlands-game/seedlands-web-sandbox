import { ActionRuntime } from '../../packages/game-core/src/server/simulation/action-runtime';
import { CombatRuntime } from '../../packages/game-core/src/server/gameplay/combat-runtime';
import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import type {
  GameplaySnapshotV1,
  GameplaySnapshotV2,
  GameplaySnapshotV3,
} from '../../packages/game-core/src/server/gameplay/gameplay-snapshot';
import {
  GAMEPLAY_COORDINATE_SCHEMA,
  GAMEPLAY_PHYSICS_SCHEMA,
  legacyPlayerPositionToFeet,
  validateGameplaySnapshot,
} from '../../packages/game-core/src/server/gameplay/gameplay-snapshot';
import {
  createItemDefinitionRegistry,
  listItemDefinitions,
  ItemIds,
} from '../../packages/game-core/src/server/gameplay/item-registry';
import type { PlayerSnapshot } from '../../packages/game-core/src/server/gameplay/player-state';

const callbacks = {
  getVoxel: () => 0,
  prepareVoxelEdit: () => ({ committed: false }) as never,
  getWorldTime: () => 9,
};

const createCurrentRuntime = () => {
  const runtime = new GameplayRuntime({ ...callbacks, platform: testCorePlatform });
  runtime.spawnPlayer({ id: 'player', position: [1, 38.4, -2] });
  runtime.spawnWorldItem([4, 39.8, -2], { itemId: ItemIds.StoneBlock, count: 2 });
  runtime.spawnAutonomous(
    { id: 'settler', type: 'npc', archetype: 'settler', position: [6, 39, -2], maxHealth: 20, health: 20 },
    { archetype: 'settler' },
  );
  return runtime;
};

const player = (spawnPosition: [number, number, number], hunger = 20): PlayerSnapshot => ({
  entityId: 'player',
  spawnPosition,
  health: 20,
  maxHealth: 20,
  hunger,
  maxHunger: 20,
  lifecycle: 'alive',
  inventory: [{ itemId: ItemIds.Berry, count: 3 }, ...Array.from({ length: 23 }, () => null)],
  selectedSlot: 0,
  hotbarSize: 8,
  attackCooldownSeconds: 0,
  hungerAccumulator: 0,
  healingAccumulator: 0,
  starvationAccumulator: 0,
  breakAction: null,
});

const simulation = () => ({
  version: 1 as const,
  time: 0,
  stepAccumulator: 0,
  needsAccumulator: 0,
  perceptionAccumulator: 0,
  behaviorAccumulator: 0,
  starterEcologyVersion: 0,
  actors: [
    {
      entityId: 'settler',
      archetype: 'settler' as const,
      hunger: 0,
      behavior: 'idle' as const,
      targetEntityId: null,
      homePoiId: null,
      workPoiId: null,
      foodPoiId: null,
      active: false,
      wanderIndex: 0,
    },
  ],
  pois: { version: 1 as const, sequence: 0, pois: [] },
  // These are real legacy v1 runtime codecs, without host identity bindings.
  actions: { version: 1 as const, sequence: 0, actions: [] },
});

const legacyEntities = (legacyCoordinates: boolean) => [
  {
    id: 'player',
    type: 'player' as const,
    kind: 'player' as const,
    lifecycle: 'active' as const,
    position: [1, legacyCoordinates ? 40 : 38.4, -2] as [number, number, number],
  },
  {
    id: 'world-item-1',
    type: 'world-item' as const,
    kind: 'world-item' as const,
    lifecycle: 'active' as const,
    position: [4, legacyCoordinates ? 40 : 39.8, -2] as [number, number, number],
    physicsVelocity: [1, -2, 0.5] as [number, number, number],
    stack: { itemId: ItemIds.StoneBlock, count: 2 },
  },
  {
    id: 'settler',
    type: 'npc' as const,
    kind: 'npc' as const,
    lifecycle: 'active' as const,
    position: [6, 39, -2] as [number, number, number],
    physicsVelocity: [0, 0, 0] as [number, number, number],
    health: 20,
    maxHealth: 20,
    archetype: 'settler' as const,
    persistent: true,
  },
];

const v1Fixture = (): GameplaySnapshotV1 => ({
  version: 1,
  revision: 3,
  gameplayTime: 4,
  entitySequence: 1,
  entities: legacyEntities(true).filter((entity) => entity.type !== 'npc'),
  players: [player([1, 40, -2])],
});

const v2Fixture = (): GameplaySnapshotV2 => ({
  version: 2,
  revision: 3,
  gameplayTime: 4,
  worldTime: 9,
  entitySequence: 1,
  entities: legacyEntities(true),
  players: [player([1, 40, -2])],
  simulation: simulation(),
});

const v3Fixture = (): GameplaySnapshotV3 => ({
  version: 3,
  revision: 3,
  gameplayTime: 4,
  worldTime: 9,
  entitySequence: 1,
  entities: legacyEntities(false),
  players: [player([1, 38.4, -2], 12)],
  simulation: simulation(),
  coordinateSchema: { ...GAMEPLAY_COORDINATE_SCHEMA },
  physicsSchema: { ...GAMEPLAY_PHYSICS_SCHEMA },
});

describe('GameplaySnapshot V1-V4 坐标、组件与物理迁移', () => {
  it('为最早的独立玩家位置记录提供同一眼睛到脚底适配', () => {
    expect(legacyPlayerPositionToFeet([4, 42, 8])).toEqual([4, 40.4, 8]);
    expect(() => legacyPlayerPositionToFeet([4, Number.POSITIVE_INFINITY, 8])).toThrow(/finite/i);
  });

  it('新快照只写 V4，并携带明确 schema 和组件 checkpoint', () => {
    const snapshot = createCurrentRuntime().createSnapshot();

    expect(snapshot).toMatchObject({
      version: 4,
      coordinateSchema: { version: 1, units: 'voxel', entityOrigin: 'body-feet-center' },
      physicsSchema: { version: 1, bodyRegistryVersion: 1 },
      entityStore: { version: 2 },
    });
    expect(snapshot).not.toHaveProperty('players');
    expect(snapshot.entityStore.entities.find((entity) => entity.id === 'player')?.position).toEqual([1, 38.4, -2]);
    expect(snapshot.entityStore.entities.find((entity) => entity.id === 'world-item-1')?.position).toEqual([
      4, 39.8, -2,
    ]);
  });

  it.each([
    ['V1', v1Fixture, 1],
    ['V2', v2Fixture, 2],
  ] as const)('迁移%s一次：玩家/出生点从眼睛转脚底、物品从中心转脚底、actor 保持', (_label, fixture, version) => {
    const raw = fixture();
    const untouched = structuredClone(raw);
    const restored = new GameplayRuntime({ ...callbacks, platform: testCorePlatform });

    expect(restored.restoreSnapshot(raw)).toMatchObject({ version });
    expect(restored.getEntity('player')?.position).toEqual([1, 38.4, -2]);
    expect(restored.getPlayerState('player').spawnPosition).toEqual([1, 38.4, -2]);
    expect(restored.getEntity('world-item-1')?.position).toEqual([4, 39.8, -2]);
    if (version === 2) expect(restored.getEntity('settler')?.position).toEqual([6, 39, -2]);
    expect(raw).toEqual(untouched);

    const migrated = restored.createSnapshot();
    const roundTrip = new GameplayRuntime({ ...callbacks, platform: testCorePlatform });
    expect(roundTrip.restoreSnapshot(migrated)).toEqual({ version: 4, worldTime: 9 });
    expect(roundTrip.getEntity('player')?.position).toEqual([1, 38.4, -2]);
    expect(roundTrip.getEntity('world-item-1')?.position).toEqual([4, 39.8, -2]);
  });

  it.each([1, 2] as const)('把 V%s 普通 creature 迁移为具名 grazer 身体且不注册旧自治循环', (version) => {
    const legacy = version === 1 ? v1Fixture() : v2Fixture();
    legacy.entities.push({
      id: 'legacy-creature',
      type: 'creature',
      kind: 'creature',
      lifecycle: 'active',
      position: [8, 39, -2],
      physicsVelocity: [0, 0, 0],
      health: 12,
      maxHealth: 12,
    });
    const restored = new GameplayRuntime({ ...callbacks, platform: testCorePlatform });

    expect(restored.restoreSnapshot(legacy)).toMatchObject({ version });
    expect(restored.getEntity('legacy-creature')).toMatchObject({ archetype: 'grazer' });
    expect(restored.simulation.snapshot().actors).not.toContainEqual(
      expect.objectContaining({ entityId: 'legacy-creature' }),
    );
  });

  it('迁移真实 V3 一次并保留速度、legacy simulation 与玩家状态', () => {
    const legacy = v3Fixture();
    const restored = new GameplayRuntime({ ...callbacks, platform: testCorePlatform });

    expect(restored.restoreSnapshot(legacy)).toEqual({ version: 3, worldTime: 9 });
    expect(restored.getEntity('world-item-1')?.physicsVelocity).toEqual([1, -2, 0.5]);
    expect(restored.getPlayerState('player')).toMatchObject({ hunger: 12 });
    expect(restored.getInventory('player').slots[0]).toEqual({ itemId: ItemIds.Berry, count: 3 });
    expect(restored.simulation.getActor('settler')).toMatchObject({ archetype: 'settler' });

    const migrated = restored.createSnapshot();
    const roundTrip = new GameplayRuntime({ ...callbacks, platform: testCorePlatform });
    expect(roundTrip.restoreSnapshot(migrated)).toEqual({ version: 4, worldTime: 9 });
    expect(roundTrip.createSnapshot()).toEqual(migrated);
  });

  it('无效 V4 与恶意数值会原子拒绝，不覆盖现有运行态', () => {
    const runtime = createCurrentRuntime();
    const before = runtime.createSnapshot();
    const unsupported = structuredClone(before) as unknown as {
      physicsSchema: { version: number; bodyRegistryVersion: number };
    };
    unsupported.physicsSchema.version = 999;
    expect(() => runtime.restoreSnapshot(unsupported)).toThrow(/physics schema/i);
    expect(runtime.createSnapshot()).toEqual(before);

    const invalidNumber = structuredClone(before);
    invalidNumber.entityStore.entities[0]!.position[1] = Number.NaN;
    expect(() => runtime.restoreSnapshot(invalidNumber)).toThrow(/gameplay snapshot/i);
    expect(runtime.createSnapshot()).toEqual(before);
  });
});

describe('legacy gameplay wrapper action migration', () => {
  it.each([v2Fixture, v3Fixture])(
    'migrates active and deleted terminal target identities through Gameplay V%s',
    (fixture) => {
      const snapshot = fixture();
      const actions = new ActionRuntime(testCorePlatform.clone);
      const history = actions.start({ actorId: 'removed-actor', type: 'eat', targetEntityId: 'removed-food' }, 0);
      actions.succeed(history.id, 0);
      const active = actions.start({ actorId: 'settler', type: 'move-to', targetEntityId: 'world-item-1' }, 0);
      actions.markRunning(active.id, [
        [6, 39, -2],
        [4, 40, -2],
      ]);
      snapshot.simulation.actions = actions.snapshot();
      const restored = createCurrentRuntime();
      restored.restoreSnapshot(snapshot);
      expect(restored.simulation.actions.get(history.id)).toMatchObject({
        status: 'succeeded',
        targetEntityId: 'removed-food',
      });
      expect(restored.simulation.actions.get(active.id)).toMatchObject({ status: 'running', pathIndex: 1 });
      const migrated = restored.simulation.actions.snapshot();
      expect(migrated.version).toBe(2);
      expect(migrated.actions).toHaveLength(2);
      expect(migrated.actions.find((action) => action.id === active.id)).toMatchObject({
        actorIdentity: { entityId: 'settler' },
        targetIdentity: { entityId: 'world-item-1' },
      });
      snapshot.entities = snapshot.entities.filter((entity) => entity.id !== 'world-item-1');
      restored.restoreSnapshot(snapshot);
      expect(restored.simulation.actions.get(active.id)).toMatchObject({
        status: 'failed',
        reason: 'restore-target-missing',
      });
    },
  );
  it.each([v2Fixture, v3Fixture])('keeps legacy Combat v1 cancellation in the gameplay wrapper', (fixture) => {
    const snapshot = fixture();
    const combat = new CombatRuntime({
      actorAvailable: () => true,
      targetAvailable: () => true,
      validateHit: () => null,
      applyDamage: () => 1,
    });
    combat.request('player', 'settler', 'unarmed');
    combat.advance(0.03);
    snapshot.simulation.combat = combat.snapshot();
    const restored = createCurrentRuntime();
    restored.restoreSnapshot(snapshot);
    expect(restored.getCombatState('player')).toMatchObject({
      active: null,
      lastResult: { outcome: 'cancelled', reason: 'restore-cancelled' },
    });
  });
});

describe('registered Block break origin migration', () => {
  const validate = (raw: unknown) =>
    validateGameplaySnapshot(raw, {
      ...callbacks,
      clone: testCorePlatform.clone,
      registeredBlocks: true,
    });
  it.each([1, 2, 3] as const)('cancels source-less V%s in-flight mining without changing input', (version) => {
    const source = (version === 1 ? v1Fixture : version === 2 ? v2Fixture : v3Fixture)();
    source.players[0].breakAction = { position: [0, 30, 0], voxel: 3, elapsedSeconds: 0.5, requiredSeconds: 1 };
    const before = structuredClone(source);
    const result = validate(source);
    expect(
      result.snapshot.entityStore.actors.find((actor) => actor.entityId === 'player')!.player!.breakAction,
    ).toBeNull();
    expect(source).toEqual(before);
  });
  it('keeps a valid V4 durable origin, cancels missing origin and rejects actor lifetime forgery', () => {
    const runtime = createCurrentRuntime();
    const origin = {
      version: 1 as const,
      principalSubject: 'test:player',
      provenance: { packId: 'test:pack', moduleId: 'test:blocks' },
      originalActor: { entityId: 'player', lifetime: runtime.entities.createReference('player')!.lifetime },
    };
    runtime.entities.playerStateAccess('player').breakAction = {
      position: [0, 30, 0],
      voxel: 3,
      elapsedSeconds: 0.5,
      requiredSeconds: 1,
      origin,
    };
    const source = runtime.createSnapshot();
    const actor = (snapshot: typeof source) =>
      snapshot.entityStore.actors.find((actor) => actor.entityId === 'player')!;
    expect(actor(validate(source).snapshot).player!.breakAction?.origin).toEqual(origin);
    const missing = structuredClone(source);
    delete actor(missing).player!.breakAction!.origin;
    expect(actor(validate(missing).snapshot).player!.breakAction).toBeNull();
    const bad = structuredClone(source);
    actor(bad).player!.breakAction!.origin = {
      ...origin,
      originalActor: { ...origin.originalActor, lifetime: origin.originalActor.lifetime + 1 },
    };
    expect(() => validate(bad)).toThrow(/break.*origin|origin.*actor/i);
    expect(runtime.createSnapshot()).toEqual(source);
  });
});

const durableItems = () =>
  createItemDefinitionRegistry(
    listItemDefinitions().map((item) =>
      item.id === ItemIds.StonePickaxe ? { ...item, durability: { max: 12 } } : item,
    ),
    () => true,
  );
const durableFixture = (factory: () => GameplaySnapshotV1 | GameplaySnapshotV2 | GameplaySnapshotV3) => {
  const source = factory();
  source.players[0].inventory[0] = { itemId: ItemIds.StonePickaxe, count: 1 };
  source.entities.find((entity) => entity.type === 'world-item')!.stack = { itemId: ItemIds.StonePickaxe, count: 1 };
  return source;
};
it.each([v1Fixture, v2Fixture, v3Fixture])('initializes legacy tool durability once in %s', (factory) => {
  const source = durableFixture(factory);
  const before = structuredClone(source);
  const options = { ...callbacks, clone: testCorePlatform.clone, items: durableItems() };
  const migrated = validateGameplaySnapshot(source, options);
  expect(migrated.sourceVersion).toBe(source.version);
  expect(
    migrated.snapshot.entityStore.actors.find((actor) => actor.entityId === 'player')!.inventory[0]?.instance,
  ).toEqual({ durability: 12 });
  expect(
    migrated.snapshot.entityStore.entities.find((entity) => entity.type === 'world-item')!.stack?.instance,
  ).toEqual({ durability: 12 });
  expect(source).toEqual(before);
  const saved = structuredClone(migrated.snapshot);
  saved.entityStore.actors.find((actor) => actor.entityId === 'player')!.inventory[0]!.instance = { durability: 3 };
  const again = validateGameplaySnapshot(saved, options);
  expect(
    again.snapshot.entityStore.actors.find((actor) => actor.entityId === 'player')!.inventory[0]?.instance,
  ).toEqual({ durability: 3 });
  delete saved.entityStore.actors.find((actor) => actor.entityId === 'player')!.inventory[0]!.instance;
  expect(() => validateGameplaySnapshot(saved, options)).toThrow(/durability|instance/i);
});
it.each([{ count: 2 }, { count: 1, instance: { durability: 0 } }, { count: 1, instance: { durability: 13 } }])(
  'does not repair invalid legacy durable stacks: %j',
  (invalid) => {
    const source = durableFixture(v3Fixture);
    source.players[0].inventory[0] = { itemId: ItemIds.StonePickaxe, ...invalid };
    expect(() =>
      validateGameplaySnapshot(source, { ...callbacks, clone: testCorePlatform.clone, items: durableItems() }),
    ).toThrow();
  },
);
