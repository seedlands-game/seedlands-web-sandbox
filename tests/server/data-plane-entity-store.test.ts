import { describe, expect, it, vi } from 'vitest';
import { EntityStore } from '../../src/server/gameplay/entity-store';

describe('EntityStore 数据平面写入', () => {
  it('公开 update 复用内部写入而不经过会返回副本的 move', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'actor', type: 'creature', position: [0, 8, 0] });
    const move = vi.spyOn(entities, 'move');

    const updated = entities.update('actor', {
      position: [9, 8, 0],
      physicsVelocity: [1, 2, 3],
    });

    expect(move).not.toHaveBeenCalled();
    expect(updated).toMatchObject({ position: [9, 8, 0], physicsVelocity: [1, 2, 3] });
    expect(entities.queryNearby([0, 8, 0], 1)).toEqual([]);
    expect(entities.queryNearby([9, 8, 0], 1).map((entity) => entity.id)).toEqual(['actor']);
  });

  it('内部 void 写入口不返回实体，同时复制输入并保持公开读取隔离', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'actor', type: 'creature', position: [0, 8, 0] });
    const position: [number, number, number] = [9, 8, -1];
    const velocity: [number, number, number] = [1, 2, 3];

    expect(
      entities.updateWithoutSnapshot('actor', {
        position,
        physicsVelocity: velocity,
        health: 7,
      }),
    ).toBeUndefined();
    position[0] = 99;
    velocity[0] = 99;

    const first = entities.get('actor')!;
    const queried = entities.query()[0]!;
    expect(first).toMatchObject({ position: [9, 8, -1], physicsVelocity: [1, 2, 3], health: 7 });
    first.position[0] = 77;
    first.physicsVelocity![0] = 77;
    queried.position[1] = 77;
    expect(entities.get('actor')).toMatchObject({ position: [9, 8, -1], physicsVelocity: [1, 2, 3], health: 7 });
  });

  it('公开 move 和 update 的返回值仍与权威实体隔离', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'actor', type: 'creature', position: [0, 8, 0] });

    const moved = entities.move('actor', [1, 8, 0]);
    moved.position[0] = 41;
    const updated = entities.update('actor', { physicsVelocity: [2, 0, 0] });
    updated.position[0] = 42;
    updated.physicsVelocity![0] = 42;

    expect(entities.get('actor')).toMatchObject({ position: [1, 8, 0], physicsVelocity: [2, 0, 0] });
  });
});

// Existing compound updates commit earlier valid fields before a later field
// throws. The allocation optimization must not silently turn this into a new
// transaction contract or leave the spatial bucket at the old position.
it('preserves compound update failure ordering and spatial membership', () => {
  for (const mode of ['update', 'updateWithoutSnapshot'] as const) {
    const entities = new EntityStore();
    entities.spawn({ id: 'actor', type: 'creature', position: [0, 8, 0] });
    expect(() => entities[mode]('actor', { position: [16, 8, 0], physicsVelocity: [NaN, 0, 0] })).toThrow();
    expect(entities.get('actor')?.position).toEqual([16, 8, 0]);
    expect(entities.queryNearby([0, 8, 0], 1)).toHaveLength(0);
    expect(entities.queryNearby([16, 8, 0], 1)).toHaveLength(1);
  }
});
