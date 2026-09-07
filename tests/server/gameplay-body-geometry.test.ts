import { describe, expect, it } from 'vitest';
import { bodyConfigFor, bodyKindForEntity } from '../../packages/game-core/src/physics/body-registry';
import type { GameplayEntity } from '../../packages/game-core/src/server/gameplay/entity-store';
import { attackTargetPoint } from '../../packages/game-core/src/server/gameplay/gameplay-geometry';

const entity = (type: GameplayEntity['type'], archetype?: GameplayEntity['archetype']): GameplayEntity => ({
  id: `${type}:${String(archetype)}`,
  type,
  kind: type,
  lifecycle: 'active',
  position: [10, 20, 30],
  ...(archetype ? { archetype } : {}),
  ...(type === 'world-item' ? { stack: { itemId: 'stone-block', count: 1 } } : {}),
});

describe('玩法实体身体坐标', () => {
  it.each([
    entity('player'),
    entity('world-item'),
    entity('creature', 'grazer'),
    entity('creature', 'night-stalker'),
    entity('npc', 'settler'),
  ])('让 $type:$archetype 的射线中心来自统一身体注册表', (target) => {
    const bounds = bodyConfigFor(bodyKindForEntity(target)).localAabb;
    expect(attackTargetPoint(target)).toEqual([10, 20 + (bounds.min.y + bounds.max.y) / 2, 30]);
  });
});
