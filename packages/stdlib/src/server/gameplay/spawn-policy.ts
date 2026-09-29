import type { Difficulty } from './difficulty-runtime';
import type { EcsActorArchetype } from './ecs-entity-owner';

export type SpawnCandidate = Readonly<{
  archetype: EcsActorArchetype;
  disposition: 'passive' | 'neutral' | 'hostile';
  weight: number;
  biomes?: readonly string[];
}>;
export type SpawnContext = Readonly<{
  seed: number;
  tick: number;
  position: readonly [number, number, number];
  light: number;
  biome: string;
  difficulty: Difficulty;
  nearestPlayerDistance: number;
  currentCategoryCount: number;
  categoryLimit: number;
}>;
const hash = (seed: number, tick: number, position: readonly number[]) => {
  let value = (seed ^ Math.imul(tick, 0x9e3779b1)) >>> 0;
  for (const coordinate of position) {
    value ^= Math.imul(Math.floor(coordinate), 0x85ebca6b);
    value = Math.imul(value ^ (value >>> 16), 0xc2b2ae35) >>> 0;
  }
  return value;
};
export function selectSpawn(candidates: readonly SpawnCandidate[], context: SpawnContext) {
  if (
    ![
      context.seed,
      context.tick,
      ...context.position,
      context.light,
      context.nearestPlayerDistance,
      context.currentCategoryCount,
      context.categoryLimit,
    ].every(Number.isFinite)
  )
    throw new TypeError('Spawn context must be finite.');
  if (context.currentCategoryCount >= context.categoryLimit || context.nearestPlayerDistance < 24) return null;
  const eligible = candidates.filter(
    (candidate) =>
      candidate.weight > 0 &&
      (!candidate.biomes || candidate.biomes.includes(context.biome)) &&
      (candidate.disposition === 'hostile'
        ? context.difficulty !== 'peaceful' && context.light <= 7
        : context.light >= 9),
  );
  const total = eligible.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (!total) return null;
  let pick = hash(context.seed, context.tick, context.position) % total;
  for (const candidate of eligible) {
    if (pick < candidate.weight) return candidate.archetype;
    pick -= candidate.weight;
  }
  return null;
}
export const shouldDespawnActor = (
  actor: Readonly<{ persistent?: boolean; tamed?: boolean }>,
  nearestPlayerDistance: number,
) => !actor.persistent && !actor.tamed && Number.isFinite(nearestPlayerDistance) && nearestPlayerDistance > 128;
