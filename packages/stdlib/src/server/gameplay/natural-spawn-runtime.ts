import type { GameplayRuntime } from './gameplay-runtime';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import { sampleLight } from './light-sampler';
import { selectSpawn, type SpawnCandidate } from './spawn-policy';

type Position = [number, number, number];
export function attemptNaturalSpawn(
  runtime: GameplayRuntime,
  callbacks: GameplayCallbacks,
  candidates: readonly SpawnCandidate[],
  position: Position,
  tick: number,
) {
  const light = sampleLight(position, callbacks.getWorldTime(), callbacks.getLoadedVoxel ?? callbacks.getVoxel);
  if (!light || !callbacks.biomeAt) return { success: false as const, reason: 'environment-unavailable' };
  const players = runtime.queryEntities({ type: 'player' });
  const nearest = players.reduce(
    (best, player) => Math.min(best, Math.hypot(...player.position.map((v, i) => v - position[i]))),
    Infinity,
  );
  const categoryCount = runtime.simulation.queryActors().filter((actor) => {
    const profile = runtime.content.actorProfiles.require(actor.archetype);
    return profile.disposition === (light.level <= 7 ? 'hostile' : 'passive');
  }).length;
  const archetype = selectSpawn(candidates, {
    seed: callbacks.environmentSeed ?? 0,
    tick,
    position,
    light: light.level,
    biome: callbacks.biomeAt(position),
    difficulty: runtime.difficulty.value,
    nearestPlayerDistance: nearest,
    currentCategoryCount: categoryCount,
    categoryLimit: 16,
  });
  if (!archetype) return { success: false as const, reason: 'spawn-rejected' };
  const entity = runtime.spawnAutonomous(
    { id: 'natural-' + tick + '-' + position.join('_'), archetype, position },
    { archetype },
  );
  return { success: true as const, entity };
}
