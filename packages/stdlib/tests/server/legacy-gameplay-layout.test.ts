import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import {
  GAMEPLAY_COORDINATE_SCHEMA,
  GAMEPLAY_PHYSICS_SCHEMA,
  createGameplaySnapshotV4,
  validateGameplaySnapshot,
  type GameplaySnapshotV1,
  type GameplaySnapshotV2,
  type GameplaySnapshotV3,
} from '../../src/server/gameplay/gameplay-snapshot';
import type { PlayerSnapshot } from '../../src/server/gameplay/player-state';
import type { SimulationSnapshot } from '../../src/server/simulation/autonomy-runtime';

const items = createItemDefinitionRegistry([
  { id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] },
  { id: 'test:stone', name: 'Stone', itemType: 'resource', stackLimit: 64, capabilities: [] },
]);
const currentLayout = Object.freeze({ capacity: 36, hotbarSize: 9 });
const emptySimulation = (): SimulationSnapshot => ({
  version: 1,
  time: 0,
  stepAccumulator: 0,
  needsAccumulator: 0,
  perceptionAccumulator: 0,
  behaviorAccumulator: 0,
  starterEcologyVersion: 0,
  actors: [],
  pois: { version: 1, sequence: 0, pois: [] },
  actions: { version: 1, sequence: 0, actions: [] },
});
const player = (): PlayerSnapshot => ({
  entityId: 'player',
  spawnPosition: [0, 2, 0],
  health: 20,
  maxHealth: 20,
  hunger: 20,
  maxHunger: 20,
  lifecycle: 'alive',
  inventory: Array.from({ length: 24 }, (_, slot) =>
    slot === 7 ? { itemId: 'test:wood', count: 3 } : slot === 23 ? { itemId: 'test:stone', count: 5 } : null,
  ),
  selectedSlot: 7,
  hotbarSize: 8,
  attackCooldownSeconds: 0,
  hungerAccumulator: 0,
  healingAccumulator: 0,
  starvationAccumulator: 0,
  breakAction: null,
});
const entities = () => [
  {
    id: 'player',
    type: 'player' as const,
    kind: 'player' as const,
    lifecycle: 'active' as const,
    position: [0, 2, 0] as [number, number, number],
  },
];
const legacy = (version: 1 | 2 | 3): GameplaySnapshotV1 | GameplaySnapshotV2 | GameplaySnapshotV3 => {
  const base = {
    revision: 4,
    gameplayTime: 6,
    entitySequence: 0,
    entities: entities(),
    players: [player()],
  };
  if (version === 1) return { version, ...base };
  const withWorld = { ...base, worldTime: 9, simulation: emptySimulation() };
  return version === 2
    ? { version, ...withWorld }
    : {
        version,
        ...withWorld,
        coordinateSchema: { ...GAMEPLAY_COORDINATE_SCHEMA },
        physicsSchema: { ...GAMEPLAY_PHYSICS_SCHEMA },
      };
};
const options = {
  getVoxel: () => 0,
  getWorldTime: () => 9,
  clone: structuredClone,
  items,
  playerLayout: currentLayout,
};
const actor = (snapshot: ReturnType<typeof validateGameplaySnapshot>['snapshot']) =>
  snapshot.entityStore.actors.find(({ entityId }) => entityId === 'player')!;

describe('legacy gameplay player layout conversion', () => {
  it.each([1, 2, 3] as const)('converts V%s with its original 24/8 layout into a V4 candidate', (version) => {
    const source = legacy(version);
    const before = structuredClone(source);
    const result = validateGameplaySnapshot(source, options);
    const saved = actor(result.snapshot);

    expect(result.sourceVersion).toBe(version);
    expect(saved.inventory).toHaveLength(24);
    expect(saved.equipment).toMatchObject({ selectedSlot: 7, hotbarSize: 8 });
    expect(saved.inventory[7]).toEqual({ itemId: 'test:wood', count: 3 });
    expect(saved.inventory[23]).toEqual({ itemId: 'test:stone', count: 5 });
    expect(source).toEqual(before);

    const current = new EntityStore(items, undefined, currentLayout);
    current.restoreComponentSnapshot(result.snapshot.entityStore);
    expect(current.playerStateAccess('player').inventory.capacity).toBe(24);
    expect(current.playerStateAccess('player').hotbarSize).toBe(8);
    expect(current.playerStateAccess('player').selectedSlot).toBe(7);
    expect(current.playerStateAccess('player').inventory.slot(23)).toEqual({ itemId: 'test:stone', count: 5 });
    current.dispose();
  });

  it('keeps a current V4 36/9 layout unchanged', () => {
    const current = new EntityStore(items, undefined, currentLayout);
    current.spawn({ id: 'player', type: 'player', position: [0, 2, 0] });
    const state = current.playerStateAccess('player');
    state.inventory.add({ itemId: 'test:wood', count: 1 });
    state.inventory.moveStack(0, 35);
    state.selectedSlot = 8;
    const source = createGameplaySnapshotV4(4, 6, 9, current.exportComponentSnapshot(), emptySimulation());
    const before = structuredClone(source);
    const result = validateGameplaySnapshot(source, options);

    expect(actor(result.snapshot).inventory).toHaveLength(36);
    expect(actor(result.snapshot).equipment).toMatchObject({ selectedSlot: 8, hotbarSize: 9 });
    expect(actor(result.snapshot).inventory[35]).toEqual({ itemId: 'test:wood', count: 1 });
    expect(source).toEqual(before);
    current.dispose();
  });

  it.each([
    ['inventory length', (source: GameplaySnapshotV3): void => void source.players[0]!.inventory.pop()],
    ['hotbar size', (source: GameplaySnapshotV3): void => void (source.players[0]!.hotbarSize = 9)],
    ['selected slot', (source: GameplaySnapshotV3): void => void (source.players[0]!.selectedSlot = 8)],
  ] as const)('rejects malformed legacy %s without mutating the input', (_label, mutate) => {
    const source = legacy(3) as GameplaySnapshotV3;
    mutate(source);
    const before = structuredClone(source);
    expect(() => validateGameplaySnapshot(source, options)).toThrow(/inventory|player|slot/i);
    expect(source).toEqual(before);
  });
});
