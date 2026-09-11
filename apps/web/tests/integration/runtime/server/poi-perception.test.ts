import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../../fixtures/classic/content';
import { PerceptionRuntime } from '../../../../../../packages/stdlib/src/server/simulation/perception-runtime';
import { PoiRegistry } from '../../../../../../packages/stdlib/src/server/simulation/poi-registry';
import { Voxel } from '../../../../../../packages/stdlib/src/world/voxel';

describe('POI and observer-scoped perception', () => {
  it('registers, clones, queries and restores nearby POIs', () => {
    const pois = new PoiRegistry();
    const home = pois.register({ id: 'camp-home', kind: 'home', position: [2, 1, 0], label: '营地住所' });
    pois.register({ kind: 'work', position: [20, 1, 0], label: '工作台' });

    home.position[0] = 99;
    expect(pois.get('camp-home')?.position).toEqual([2, 1, 0]);
    expect(pois.queryNearby([0, 1, 0], 5).map((poi) => poi.id)).toEqual(['camp-home']);
    expect(pois.remove('missing')).toBe(false);

    const restored = new PoiRegistry();
    restored.restore(pois.snapshot());
    expect(restored.query()).toEqual(pois.query());
    expect(restored.register({ kind: 'food', position: [3, 1, 0], label: '食物点' }).id).not.toBe('camp-home');
  });

  it('returns only visible in-range entities, threats, food and POIs for the observer', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'grazer', type: 'creature', archetype: 'grazer', position: [0.5, 1, 0.5] });
    entities.spawn({ id: 'hostile-visible', type: 'creature', archetype: 'night-stalker', position: [4.5, 1, 0.5] });
    entities.spawn({ id: 'hostile-blocked', type: 'creature', archetype: 'night-stalker', position: [0.5, 1, 4.5] });
    entities.spawn({
      id: 'berry',
      type: 'world-item',
      position: [2.5, 1, 0.5],
      stack: { itemId: 'berry', count: 1 },
    });
    entities.spawn({ id: 'far-player', type: 'player', position: [30.5, 1, 0.5] });
    const pois = new PoiRegistry();
    pois.register({ id: 'food-poi', kind: 'food', position: [3.5, 1, 0.5], label: '浆果丛' });
    const wall = new Set(['0,1,2']);
    const perception = new PerceptionRuntime({
      entities,
      pois,
      getVoxel: (x, y, z) => (wall.has(`${x},${y},${z}`) ? Voxel.Stone : Voxel.Air),
      isPlayerAlive: () => true,
    });

    const observation = perception.observe('grazer', 10);
    expect(observation.visibleEntities.map((entity) => entity.entityId)).toEqual(['berry', 'hostile-visible']);
    expect(observation.threats.map((entity) => entity.entityId)).toEqual(['hostile-visible']);
    expect(observation.food.map((entity) => entity.entityId)).toEqual(['berry']);
    expect(observation.pois.map((poi) => poi.poiId)).toEqual(['food-poi']);
    expect(observation.observations.map((event) => event.type)).toEqual(
      expect.arrayContaining(['entity-seen', 'threat-seen', 'food-seen', 'poi-seen']),
    );
    expect(observation.candidateCount).toBeLessThan(entities.query().length);
  });
});
