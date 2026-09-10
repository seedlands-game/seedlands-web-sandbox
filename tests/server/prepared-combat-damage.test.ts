import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';
import { prepareCombatDamage } from '../../packages/game-core/src/server/gameplay/prepared-combat-damage';

function setup(type: 'player' | 'creature') {
  const entities = new EntityStore();
  entities.spawn({
    id: 'target',
    type,
    ...(type === 'creature' ? { archetype: 'grazer' as const } : {}),
    position: [0, 0, 0],
    health: 3,
    maxHealth: 20,
  });
  return entities;
}
describe('detached Combat damage candidate', () => {
  it('keeps player death and drops detached until apply', () => {
    const entities = setup('player');
    entities.actorStateAccess('target').inventory.add({ itemId: 'wood-block', count: 2 });
    const before = entities.exportComponentSnapshot();
    const result = prepareCombatDamage({ entities, targetId: 'target', damage: 9, actorDeathDrop: () => null });
    expect(result.damage).toBe(3);
    expect(result.deaths).toEqual(['target']);
    expect(result.removals).toEqual([]);
    expect(entities.exportComponentSnapshot()).toEqual(before);
    result.entity!.validate();
    result.entity!.apply();
    expect(entities.actorStateAccess('target').lifecycle).toBe('dead');
    expect(
      entities
        .actorStateAccess('target')
        .inventory.snapshot()
        .every((slot) => slot === null),
    ).toBe(true);
    expect(entities.query({ type: 'world-item' }).map((item) => item.stack)).toEqual([
      { itemId: 'wood-block', count: 2 },
    ]);
  });
  it('prepares NPC inventory and archetype drops before despawn', () => {
    const entities = setup('creature');
    entities.actorStateAccess('target').inventory.add({ itemId: 'wood-block', count: 1 });
    const result = prepareCombatDamage({
      entities,
      targetId: 'target',
      damage: 3,
      actorDeathDrop: () => ({ itemId: 'berry', count: 2 }),
    });
    expect(entities.get('target')).not.toBeNull();
    expect(result.removals).toEqual(['target']);
    result.entity!.validate();
    result.entity!.apply();
    expect(entities.get('target')).toBeNull();
    expect(entities.query({ type: 'world-item' }).map((item) => item.stack)).toEqual([
      { itemId: 'wood-block', count: 1 },
      { itemId: 'berry', count: 2 },
    ]);
  });
  it('retains the target when drop preparation fails and does not touch immune targets', () => {
    const entities = setup('creature');
    const before = entities.exportComponentSnapshot();
    expect(() =>
      prepareCombatDamage({
        entities,
        targetId: 'target',
        damage: 3,
        actorDeathDrop: () => {
          throw new Error('drop-definition-failed');
        },
      }),
    ).toThrow('drop-definition-failed');
    expect(entities.exportComponentSnapshot()).toEqual(before);
    expect(prepareCombatDamage({ entities, targetId: 'target', damage: 0, actorDeathDrop: () => null })).toMatchObject({
      damage: 0,
      entity: null,
      deaths: [],
      removals: [],
    });
    expect(entities.exportComponentSnapshot()).toEqual(before);
  });
});
