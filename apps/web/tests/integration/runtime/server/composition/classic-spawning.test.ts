import { expect, it } from 'vitest';
import { selectSpawn, shouldDespawnActor } from '@seedlands/stdlib/server/gameplay/spawn-policy';

const candidates = [
  { archetype: 'cow', disposition: 'passive', weight: 8 },
  { archetype: 'pig', disposition: 'passive', weight: 10 },
  { archetype: 'zombie', disposition: 'hostile', weight: 10 },
  { archetype: 'skeleton', disposition: 'hostile', weight: 10 },
] as const;
const context = {
  seed: 42,
  tick: 100,
  position: [40, 30, 40] as const,
  light: 0,
  biome: 'plains',
  difficulty: 'normal' as const,
  nearestPlayerDistance: 30,
  currentCategoryCount: 0,
  categoryLimit: 16,
};

it('固定 seed/tick 稳定选择并遵守亮度、距离、难度与上限', () => {
  expect(selectSpawn(candidates, context)).toBe(selectSpawn(candidates, context));
  expect(['zombie', 'skeleton']).toContain(selectSpawn(candidates, context));
  expect(selectSpawn(candidates, { ...context, difficulty: 'peaceful' })).toBeNull();
  expect(selectSpawn(candidates, { ...context, nearestPlayerDistance: 23.9 })).toBeNull();
  expect(selectSpawn(candidates, { ...context, currentCategoryCount: 16 })).toBeNull();
  expect(['cow', 'pig']).toContain(selectSpawn(candidates, { ...context, light: 15 }));
});

it('只有非持久且未驯服实体在128格外清退', () => {
  expect(shouldDespawnActor({}, 129)).toBe(true);
  expect(shouldDespawnActor({}, 128)).toBe(false);
  expect(shouldDespawnActor({ persistent: true }, 999)).toBe(false);
  expect(shouldDespawnActor({ tamed: true }, 999)).toBe(false);
});
