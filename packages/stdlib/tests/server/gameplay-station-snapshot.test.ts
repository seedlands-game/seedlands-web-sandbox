import { expect, it } from 'vitest';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { testCorePlatform } from '../support/core-platform';

const content = createGameplayContent({
  items: [],
  recipes: [],
  meleeDefinitions: [],
  stations: { definitions: [{ kind: 'chest', voxel: 12 }], recipes: [], furnaceRecipes: [], fuels: [] },
});
const runtime = (withStations = true) =>
  new GameplayRuntime({
    platform: testCorePlatform,
    content: withStations ? content : createGameplayContent({ items: [], recipes: [], meleeDefinitions: [] }),
    getVoxel: () => 0,
    prepareVoxelEdit: () => ({ committed: false }) as never,
    getWorldTime: () => 9,
  });

it('restores station components through the real gameplay owner without actor mode or dynamic membership', () => {
  const source = runtime();
  const restored = runtime();
  try {
    source.entities.spawn({ id: 'chest-1', type: 'station', position: [0, 1, 0], station: { kind: 'chest' } });
    expect(source.getActorModeState('chest-1')).toBeNull();
    expect(source.entities.query()).toEqual([]);
    const snapshot = source.createSnapshot();
    restored.restoreSnapshot(snapshot);
    expect(restored.entities.stationSnapshot('chest-1')).toEqual(source.entities.stationSnapshot('chest-1'));
    expect(restored.createSnapshot()).toEqual(snapshot);
    const missing = runtime(false);
    try {
      expect(() => missing.restoreSnapshot(snapshot)).toThrow(/station/i);
      expect(missing.entities.query()).toEqual([]);
    } finally {
      missing.entities.dispose();
    }
  } finally {
    source.entities.dispose();
    restored.entities.dispose();
  }
});
