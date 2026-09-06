import { describe, expect, it } from 'vitest';
import {
  CollisionLayer,
  WORLD_ITEM_INTERACTION,
  bodyConfigFor,
  bodyKindForEntity,
  bodySensorsFor,
  type BodyKind,
} from '../../src/physics/body-registry';
import { validateBodyConfig } from '../../src/physics';
import { entityHitDistance } from '../../src/client/entity-hit-volume';

describe('统一身体注册表', () => {
  it.each([
    ['player', 0.64, 1.8],
    ['world-item', 0.4, 0.4],
    ['grazer', 1.5, 1.9],
    ['night-stalker', 1.3, 2.1],
    ['settler', 1.3, 2.35],
  ] as const)('%s 使用脚底中心局部 AABB', (kind, width, height) => {
    const box = bodyConfigFor(kind).localAabb;

    expect(box.min.y).toBe(0);
    expect(box.max.x - box.min.x).toBeCloseTo(width);
    expect(box.max.y - box.min.y).toBeCloseTo(height);
    expect(box.max.z - box.min.z).toBeCloseTo(width);
    expect(validateBodyConfig(bodyConfigFor(kind))).toBe(true);
  });

  it('角色相互阻挡而掉落物彼此不阻挡', () => {
    const player = bodyConfigFor('player');
    const item = bodyConfigFor('world-item');

    expect(player.collisionLayer).toBe(CollisionLayer.Character);
    expect(player.collisionMask! & CollisionLayer.Character).not.toBe(0);
    expect(item.collisionLayer).toBe(CollisionLayer.Item);
    expect(item.collisionMask! & CollisionLayer.Item).toBe(0);
    expect(player.waterSurfaceJumpSpeed).toBeGreaterThan(0);
  });

  it('实体类型和 archetype 只映射到具名身体', () => {
    const cases: Array<[{ type: string; archetype?: string }, BodyKind]> = [
      [{ type: 'player' }, 'player'],
      [{ type: 'world-item' }, 'world-item'],
      [{ type: 'creature', archetype: 'grazer' }, 'grazer'],
      [{ type: 'creature', archetype: 'night-stalker' }, 'night-stalker'],
      [{ type: 'npc', archetype: 'settler' }, 'settler'],
    ];

    cases.forEach(([entity, expected]) => expect(bodyKindForEntity(entity)).toBe(expected));
  });

  it('战斗射线使用注册表身体而非 client 硬编码尺寸', () => {
    const config = bodyConfigFor('grazer');
    const distance = entityHitDistance([0, 0, 0], 'grazer', [-2, 0.95, 0], [1, 0, 0], 5);

    expect(distance).toBeCloseTo(2 + config.localAabb.min.x);
  });

  it('掉落物吸附、拾取和调试投影共享具名传感器配置', () => {
    expect(WORLD_ITEM_INTERACTION).toEqual({ attractionRadius: 2.25, attractionSpeed: 6, pickupRadius: 0.75 });
    expect(bodySensorsFor('player')).toEqual([]);
    expect(bodySensorsFor('world-item')).toEqual([
      { purpose: 'attraction', shape: 'sphere', radius: 2.25 },
      { purpose: 'pickup', shape: 'sphere', radius: 0.75 },
    ]);
  });
});
