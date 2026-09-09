import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../support/core-platform';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { createItemDefinitionRegistry } from '../../packages/game-core/src/server/gameplay/item-registry';
import { ModeRuntime } from '../../packages/game-core/src/server/gameplay/modules/mode-runtime';
import { PlayerState } from '../../packages/game-core/src/server/gameplay/player-state';
import { Voxel } from '../../packages/game-core/src/world/voxel';

const emptyHotbar = () => Array.from({ length: 8 }, () => null as string | null);
const creativeHotbar = (itemId = 'berry') => [itemId, ...Array.from({ length: 7 }, () => null)];

const createGameplay = () =>
  new GameplayRuntime({
    getVoxel: () => Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
    getWorldTime: () => 9,
    platform: testCorePlatform,
  });

describe('actor mode runtime', () => {
  it('validates exhausted revisions and sparse catalogs before cancelling actions', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'player', type: 'player', position: [0, 2, 0] });
    const actor = entities.actorStateAccess('player');
    let cancelled = 0;
    const modes = new ModeRuntime({
      entities,
      findSafeLanding: (_id, position) => position,
      cancelIncompatibleActions: () => {
        cancelled++;
      },
      changed: () => {},
    });
    const sparse: (string | null)[] = [];
    sparse.length = 8;
    expect(modes.switchMode('player', { mode: 'creative', creativeHotbar: sparse })).toMatchObject({ success: false });
    actor.replaceModeComponents({
      mode: { version: 1, value: 'survival', revision: Number.MAX_SAFE_INTEGER },
      creativeCatalog: actor.creativeCatalog,
      flight: actor.flight,
    });
    const before = entities.exportComponentSnapshot();
    expect(() => modes.switchMode('player', { mode: 'creative', creativeHotbar: emptyHotbar() })).toThrow();
    expect(cancelled).toBe(0);
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });
  it('uses shared ECS components for players and NPCs without touching survival inventories or slots', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'player', type: 'player', position: [0, 2, 0] });
    entities.spawn({ id: 'npc', type: 'npc', position: [2, 2, 0] });
    for (const id of ['player', 'npc']) {
      const actor = entities.actorStateAccess(id);
      actor.inventory.add({ itemId: 'wood-block', count: 3 });
      actor.selectSlot(2);
    }
    const cancellations: string[] = [];
    let changed = 0;
    const modes = new ModeRuntime({
      entities,
      findSafeLanding: (_actorId, position) => position,
      cancelIncompatibleActions: (actorId) => cancellations.push(actorId),
      changed: () => (changed += 1),
    });

    for (const id of ['player', 'npc']) {
      const beforeInventory = entities.actorStateAccess(id).inventory.snapshot();
      expect(
        modes.switchMode(id, {
          mode: 'creative',
          creativeHotbar: creativeHotbar(),
          selectedCreativeSlot: 0,
          flightEnabled: true,
        }),
      ).toMatchObject({ success: true, state: { mode: 'creative', modeRevision: 1 } });
      expect(modes.setCreativeCatalog(id, creativeHotbar('stone-block'), 1)).toMatchObject({ success: true });
      const actor = entities.actorStateAccess(id);
      expect(actor).toMatchObject({
        mode: 'creative',
        modeRevision: 1,
        creativeCatalog: { version: 1, selectedSlot: 1, revision: 2 },
        flight: { version: 1, enabled: true, revision: 1 },
      });
      expect(actor.creativeCatalog.hotbar[0]).toBe('stone-block');
      expect(actor.inventory.snapshot()).toEqual(beforeInventory);
      expect(actor.selectedSlot).toBe(2);
    }
    expect(cancellations).toEqual(['player', 'npc']);
    expect(changed).toBe(4);
  });

  it('rejects creative-to-survival without a safe landing and causes absolutely no mutation or cancellation', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'player', type: 'player', position: [0, 20, 0] });
    let landing: [number, number, number] | null = [0, 2, 0];
    let cancellations = 0;
    let changed = 0;
    const modes = new ModeRuntime({
      entities,
      findSafeLanding: () => landing,
      cancelIncompatibleActions: () => (cancellations += 1),
      changed: () => (changed += 1),
    });
    modes.switchMode('player', {
      mode: 'creative',
      creativeHotbar: creativeHotbar(),
      flightEnabled: true,
    });
    const before = entities.exportComponentSnapshot();
    const reference = entities.createReference('player');
    const beforeCancellations = cancellations;
    const beforeChanged = changed;
    landing = null;

    expect(modes.switchMode('player', { mode: 'survival' })).toEqual({
      success: false,
      reason: 'no-safe-landing',
    });
    expect(entities.exportComponentSnapshot()).toEqual(before);
    expect(entities.createReference('player')).toEqual(reference);
    expect(cancellations).toBe(beforeCancellations);
    expect(changed).toBe(beforeChanged);
  });

  it('commits safe landing, flight shutdown and revisions while retaining the entity identity', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'player', type: 'player', position: [0, 20, 0] });
    const cancellations: string[] = [];
    let changed = 0;
    const modes = new ModeRuntime({
      entities,
      findSafeLanding: () => [4, 3, 2],
      cancelIncompatibleActions: (actorId, reason) => cancellations.push(`${actorId}:${reason}`),
      changed: () => (changed += 1),
    });
    modes.switchMode('player', {
      mode: 'creative',
      creativeHotbar: creativeHotbar(),
      flightEnabled: true,
    });
    const reference = entities.createReference('player');

    expect(modes.switchMode('player', { mode: 'survival' })).toMatchObject({
      success: true,
      state: {
        mode: 'survival',
        modeRevision: 2,
        creativeCatalog: { hotbar: creativeHotbar(), revision: 1 },
        flight: { enabled: false, revision: 2 },
      },
    });
    expect(entities.get('player')?.position).toEqual([4, 3, 2]);
    expect(entities.createReference('player')).toEqual(reference);
    expect(cancellations).toEqual(['player:mode-changed', 'player:mode-changed']);
    expect(changed).toBe(2);
  });

  it('migrates missing component facets to survival defaults and roundtrips creative state through V4', () => {
    const legacyStore = new EntityStore();
    legacyStore.spawn({ id: 'player', type: 'player', position: [0, 2, 0] });
    legacyStore.spawn({ id: 'npc', type: 'npc', position: [2, 2, 0] });
    const current = legacyStore.exportComponentSnapshot();
    const legacy = {
      ...current,
      actors: current.actors.map(({ mode: _mode, creativeCatalog: _catalog, flight: _flight, ...actor }) => actor),
    };
    legacyStore.restoreComponentSnapshot(legacy);
    for (const id of ['player', 'npc']) {
      expect(legacyStore.actorStateAccess(id)).toMatchObject({
        mode: 'survival',
        modeRevision: 0,
        creativeCatalog: { version: 1, hotbar: emptyHotbar(), selectedSlot: 0, revision: 0 },
        flight: { version: 1, enabled: false, revision: 0 },
      });
    }
    const beforeMalformed = legacyStore.exportComponentSnapshot();
    const [firstActor, ...otherActors] = beforeMalformed.actors;
    const partialActor = { ...firstActor! };
    delete partialActor.flight;
    const partial = { ...beforeMalformed, actors: [partialActor, ...otherActors] };
    expect(() => legacyStore.restoreComponentSnapshot(partial)).toThrow(/mode component snapshots/i);
    expect(legacyStore.exportComponentSnapshot()).toEqual(beforeMalformed);
    expect(new PlayerState('legacy-player', [0, 2, 0], { selectedSlot: 3 }).snapshot()).toMatchObject({
      mode: { version: 1, value: 'survival', revision: 0 },
      creativeCatalog: { version: 1, hotbar: emptyHotbar(), selectedSlot: 0, revision: 0 },
      flight: { version: 1, enabled: false, revision: 0 },
    });

    const source = createGameplay();
    source.spawnPlayer({ id: 'player', position: [0, 2, 0] });
    source.giveItem('player', { itemId: 'wood-block', count: 2 });
    const sourceModes = new ModeRuntime({
      entities: source.entities,
      findSafeLanding: (_actorId, position) => position,
      cancelIncompatibleActions: () => undefined,
      changed: () => undefined,
    });
    sourceModes.switchMode('player', {
      mode: 'creative',
      creativeHotbar: creativeHotbar('stone-block'),
      selectedCreativeSlot: 2,
      flightEnabled: true,
    });
    const snapshot = source.createSnapshot();
    const restored = createGameplay();
    restored.restoreSnapshot(snapshot);
    const restoredModes = new ModeRuntime({
      entities: restored.entities,
      findSafeLanding: (_actorId, position) => position,
      cancelIncompatibleActions: () => undefined,
      changed: () => undefined,
    });
    expect(restoredModes.stateFor('player')).toMatchObject({
      mode: 'creative',
      modeRevision: 1,
      creativeCatalog: { hotbar: creativeHotbar('stone-block'), selectedSlot: 2, revision: 1 },
      flight: { enabled: true, revision: 1 },
    });
    expect(restored.getInventory('player').slots[0]).toEqual({ itemId: 'wood-block', count: 2 });
  });

  it('validates catalog references against each world registry before any state change', () => {
    const definition = (id: string) => ({
      id,
      name: id,
      itemType: 'block' as const,
      stackLimit: 64,
      capabilities: [] as const,
    });
    const first = new EntityStore(createItemDefinitionRegistry([definition('first:block')]));
    const second = new EntityStore(createItemDefinitionRegistry([definition('second:block')]));
    first.spawn({ id: 'actor', type: 'npc', position: [0, 2, 0] });
    second.spawn({ id: 'actor', type: 'npc', position: [0, 2, 0] });
    const createModes = (entities: EntityStore) =>
      new ModeRuntime({
        entities,
        findSafeLanding: (_actorId, position) => position,
        cancelIncompatibleActions: () => undefined,
        changed: () => undefined,
      });
    const firstModes = createModes(first);
    const secondModes = createModes(second);

    expect(
      firstModes.switchMode('actor', { mode: 'creative', creativeHotbar: creativeHotbar('second:block') }),
    ).toEqual({ success: false, reason: 'invalid-catalog' });
    expect(firstModes.stateFor('actor').mode).toBe('survival');
    expect(
      secondModes.switchMode('actor', { mode: 'creative', creativeHotbar: creativeHotbar('second:block') }),
    ).toMatchObject({ success: true, state: { mode: 'creative' } });
    expect(secondModes.stateFor('actor').creativeCatalog.hotbar[0]).toBe('second:block');
  });

  it('only enables flight in creative mode and never maps creative selection onto the survival slot', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'player', type: 'player', position: [0, 2, 0] });
    const actor = entities.actorStateAccess('player');
    actor.selectSlot(4);
    const modes = new ModeRuntime({
      entities,
      findSafeLanding: (_actorId, position) => position,
      cancelIncompatibleActions: () => undefined,
      changed: () => undefined,
    });
    expect(modes.setFlight('player', true)).toEqual({ success: false, reason: 'flight-requires-creative' });
    modes.switchMode('player', { mode: 'creative', creativeHotbar: creativeHotbar(), selectedCreativeSlot: 1 });
    expect(modes.setFlight('player', true)).toMatchObject({
      success: true,
      state: { flight: { enabled: true, revision: 1 } },
    });
    expect(entities.actorStateAccess('player').selectedSlot).toBe(4);
    expect(modes.stateFor('player').creativeCatalog.selectedSlot).toBe(1);
  });
});
