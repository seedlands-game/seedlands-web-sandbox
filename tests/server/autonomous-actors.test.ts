import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { AutonomyRuntime } from '../../src/server/simulation/autonomy-runtime';
import { Voxel } from '../../src/world/voxel';

const createFixture = (hour = 12) => {
  const entities = new EntityStore();
  let worldTime = hour;
  const damage: Array<{ targetId: string; amount: number }> = [];
  const drops: Array<{ itemId: string; count: number }> = [];
  // Browser player entities use the camera/eye anchor while autonomous actors use the ground anchor.
  entities.spawn({ id: 'player', type: 'player', position: [0.5, 2.6, 0.5] });
  const runtime = new AutonomyRuntime({
    entities,
    getVoxel: (_x, y) => (y <= 0 ? Voxel.Stone : Voxel.Air),
    getWorldTime: () => worldTime,
    isPlayerAlive: () => true,
    damagePlayer: (_actorId, targetId, amount) => {
      damage.push({ targetId, amount });
      return true;
    },
    consumeWorldItem: (entityId) => entities.despawn(entityId),
    spawnWorldItem: (_position, stack) => drops.push(stack),
  });
  return { entities, runtime, damage, drops, setHour: (hourValue: number) => (worldTime = hourValue) };
};

describe('autonomous creature and NPC behavior', () => {
  it('lets a hungry grazer seek and consume visible food, then flee a threat', () => {
    const fixture = createFixture();
    fixture.entities.spawn({ id: 'grazer', type: 'creature', archetype: 'grazer', position: [1.5, 1, 0.5] });
    fixture.entities.spawn({
      id: 'berry',
      type: 'world-item',
      position: [4.5, 1, 0.5],
      stack: { itemId: 'berry', count: 1 },
    });
    fixture.runtime.registerActor('grazer', { archetype: 'grazer', hunger: 80 });
    fixture.runtime.advance(4);
    expect(fixture.entities.get('berry')).toBeNull();
    expect(fixture.runtime.getActor('grazer')).toMatchObject({ hunger: expect.any(Number) });
    expect(fixture.runtime.getActor('grazer')!.hunger).toBeLessThan(50);

    fixture.entities.spawn({
      id: 'threat',
      type: 'creature',
      archetype: 'night-stalker',
      position: [3.5, 1, 0.5],
    });
    fixture.runtime.registerActor('threat', { archetype: 'night-stalker' });
    const before = fixture.entities.get('grazer')!.position;
    const threat = fixture.entities.get('threat')!.position;
    fixture.runtime.advance(2);
    expect(fixture.runtime.getActor('grazer')?.behavior).toBe('flee');
    const after = fixture.entities.get('grazer')!.position;
    expect(Math.hypot(after[0] - threat[0], after[2] - threat[2])).toBeGreaterThan(
      Math.hypot(before[0] - threat[0], before[2] - threat[2]),
    );
  });

  it('allows a night stalker to chase and damage only at night', () => {
    const fixture = createFixture(12);
    fixture.entities.move('player', [0, 2.6, 0]);
    fixture.entities.spawn({
      id: 'stalker',
      type: 'creature',
      archetype: 'night-stalker',
      position: [0.5, 1, 0.5],
    });
    fixture.runtime.registerActor('stalker', { archetype: 'night-stalker' });
    fixture.runtime.advance(2);
    expect(fixture.damage).toHaveLength(0);

    fixture.setHour(22);
    fixture.runtime.advance(3);
    expect(fixture.damage).toContainEqual({ targetId: 'player', amount: 2 });
    expect(fixture.runtime.getActor('stalker')?.behavior).toMatch(/chase|attack/);

    fixture.setHour(9);
    const attacks = fixture.damage.length;
    fixture.runtime.advance(2);
    expect(fixture.damage).toHaveLength(attacks);
  });

  it('prioritizes threat, food need, daytime work and nighttime home for a settler', () => {
    const fixture = createFixture(12);
    fixture.entities.spawn({ id: 'settler', type: 'npc', archetype: 'settler', position: [1.5, 1, 0.5] });
    fixture.runtime.pois.register({ id: 'home', kind: 'home', position: [-3.5, 1, 0.5], label: '住所' });
    fixture.runtime.pois.register({ id: 'work', kind: 'work', position: [4.5, 1, 0.5], label: '工作地' });
    fixture.runtime.pois.register({ id: 'food', kind: 'food', position: [2.5, 1, 2.5], label: '食物点' });
    fixture.runtime.registerActor('settler', {
      archetype: 'settler',
      hunger: 80,
      homePoiId: 'home',
      workPoiId: 'work',
      foodPoiId: 'food',
    });
    fixture.runtime.advance(1.5);
    expect(fixture.runtime.getActor('settler')?.behavior).toBe('seek-food');
    fixture.runtime.advance(4);
    expect(fixture.runtime.getActor('settler')!.hunger).toBeLessThan(60);

    fixture.setHour(12);
    fixture.runtime.advance(1.5);
    expect(fixture.runtime.getActor('settler')?.behavior).toBe('routine-work');
    fixture.setHour(22);
    fixture.runtime.advance(1.5);
    expect(fixture.runtime.getActor('settler')?.behavior).toBe('routine-home');

    fixture.entities.spawn({
      id: 'threat',
      type: 'creature',
      archetype: 'night-stalker',
      position: fixture.entities.get('settler')!.position,
    });
    fixture.runtime.registerActor('threat', { archetype: 'night-stalker' });
    fixture.runtime.advance(1);
    expect(fixture.runtime.getActor('settler')?.behavior).toBe('flee');
  });

  it('keeps scheduling deterministic and bounds active and retained actors', () => {
    const short = createFixture();
    const long = createFixture();
    for (const fixture of [short, long]) {
      fixture.entities.spawn({ id: 'grazer', type: 'creature', archetype: 'grazer', position: [3.5, 1, 0.5] });
      fixture.runtime.registerActor('grazer', { archetype: 'grazer', hunger: 10 });
    }
    short.runtime.advance(5);
    for (let index = 0; index < 50; index += 1) long.runtime.advance(0.1);
    expect(short.runtime.getActor('grazer')).toEqual(long.runtime.getActor('grazer'));
    expect(short.entities.get('grazer')?.position).toEqual(long.entities.get('grazer')?.position);

    short.entities.move('grazer', [100.5, 1, 0.5]);
    short.runtime.advance(1);
    expect(short.runtime.getActor('grazer')?.active).toBe(false);
    expect(short.runtime.metrics()).toMatchObject({ retainedActorCount: 1, activeActorCount: 0 });
    expect(() => {
      for (let index = 0; index < 512; index += 1) {
        const id = `extra-${index}`;
        short.entities.spawn({ id, type: 'creature', archetype: 'grazer', position: [100 + index, 1, 0.5] });
        short.runtime.registerActor(id, { archetype: 'grazer' });
      }
    }).toThrow(/actor limit/i);
  });
});
