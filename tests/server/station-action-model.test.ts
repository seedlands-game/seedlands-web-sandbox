import { expect, it } from 'vitest';
import { createGameplayContent } from '../../packages/game-core/src/server/gameplay/gameplay-content';
import { buildStationActionCandidate } from '../../packages/game-core/src/server/gameplay/modules/station-action-model';
const content = createGameplayContent({
  items: [{ id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] }],
  recipes: [],
  meleeDefinitions: [],
  stations: {
    definitions: [
      { kind: 'workbench', voxel: 11 },
      { kind: 'furnace', voxel: 13 },
    ],
    recipes: [
      {
        kind: 'shapeless',
        id: 'test:wood',
        inputs: [{ itemId: 'test:wood', count: 2 }],
        outputs: [{ itemId: 'test:wood', count: 1 }],
      },
    ],
    furnaceRecipes: [
      {
        id: 'test:burn',
        input: { itemId: 'test:wood', count: 1 },
        output: { itemId: 'test:wood', count: 1 },
        durationSeconds: 2,
      },
    ],
    fuels: [{ itemId: 'test:wood', burnSeconds: 5 }],
  },
});
const reference = (entityId: string) => ({ entityId, epoch: 1, lifetime: 1 });
const actor = () => ({
  version: 1,
  reference: reference('actor'),
  kind: 'player',
  slots: [{ itemId: 'test:wood', count: 4 }, null],
  equipment: { selectedSlot: 0, hotbarSize: 2 },
  lifecycle: 'alive',
  needs: { hunger: 20, maxHunger: 20, meaning: 'satiety' },
  mode: 'survival',
});
const station = (kind: 'workbench' | 'furnace' = 'workbench') => ({
  version: 1,
  reference: reference('station'),
  position: [0, 1, 0],
  component: content.stations!.codec.create('station', kind),
});

it('prepares exact count transfer without changing source and rejects stale revision or full destination', () => {
  const a = actor(),
    s = station();
  const result = buildStationActionCandidate(content, {
    kind: 'transfer',
    actor: a,
    station: s,
    input: { expectedStationRevision: 0, from: 'actor', actorSlot: 0, stationSlot: 0, count: 2 },
  });
  expect(result.slots[0]).toEqual({ itemId: 'test:wood', count: 2 });
  expect(result.station).toMatchObject({
    revision: 1,
    grid: [{ itemId: 'test:wood', count: 2 }, ...Array(8).fill(null)],
  });
  expect(a.slots[0]?.count).toBe(4);
  expect(s.component.revision).toBe(0);
  expect(() =>
    buildStationActionCandidate(content, {
      kind: 'transfer',
      actor: a,
      station: { ...s, component: result.station },
      input: { expectedStationRevision: 0, from: 'actor', actorSlot: 0, stationSlot: 0 },
    }),
  ).toThrow(/stale/);
  expect(() =>
    buildStationActionCandidate(content, {
      kind: 'transfer',
      actor: a,
      station: s,
      input: { expectedStationRevision: 0, from: 'actor', actorSlot: 0, stationSlot: 0, count: 5 },
    }),
  ).toThrow(/count/);
});
it('crafts into actor inventory and rejects creative use', () => {
  const s = station();
  const component = { ...s.component, grid: [{ itemId: 'test:wood', count: 2 }, ...Array(8).fill(null)] };
  const result = buildStationActionCandidate(content, {
    kind: 'craft',
    actor: actor(),
    station: { ...s, component },
    input: { expectedStationRevision: 0, recipeId: 'test:wood' },
  });
  expect(result.slots[0]?.count).toBe(5);
  expect(result.station).toMatchObject({ revision: 1, grid: Array(9).fill(null) });
  expect(() =>
    buildStationActionCandidate(content, {
      kind: 'craft',
      actor: { ...actor(), mode: 'creative' },
      station: { ...s, component },
      input: { expectedStationRevision: 0, recipeId: 'test:wood' },
    }),
  ).toThrow(/creative/);
});
it('rejects input into furnace output and clears removed active input progress without refunding fuel', () => {
  const s = station('furnace');
  expect(() =>
    buildStationActionCandidate(content, {
      kind: 'transfer',
      actor: actor(),
      station: s,
      input: { expectedStationRevision: 0, from: 'actor', actorSlot: 0, stationSlot: 2 },
    }),
  ).toThrow(/output/);
  const component = {
    ...s.component,
    furnace: {
      version: 1,
      input: { itemId: 'test:wood', count: 1 },
      fuel: null,
      output: null,
      activeRecipeId: 'test:burn',
      remainingFuelSeconds: 3,
      progressSeconds: 1,
    },
  };
  const result = buildStationActionCandidate(content, {
    kind: 'transfer',
    actor: actor(),
    station: { ...s, component },
    input: { expectedStationRevision: 0, from: 'station', actorSlot: 0, stationSlot: 0 },
  });
  expect(result.station).toMatchObject({
    furnace: { input: null, remainingFuelSeconds: 3, progressSeconds: 0, activeRecipeId: null },
  });
});
