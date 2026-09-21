import type { EntityStore, GameplayEntity } from './entity-store';
import type { EnvironmentRuntime } from './environment-runtime';
import type { ProjectileRuntime } from './projectile-runtime';
import type { SpeciesStateV1 } from './species-state';

type Context = Readonly<{
  entities: EntityStore;
  projectiles: ProjectileRuntime;
  environment: EnvironmentRuntime;
  despawn(id: string): boolean;
  spawnSlime(id: string, position: [number, number, number], state: SpeciesStateV1): GameplayEntity;
}>;
export const createHostileSpeciesMechanics = (context: Context) => ({
  fireSkeleton(skeletonId: string, targetId: string) {
    const source = context.entities.get(skeletonId),
      target = context.entities.get(targetId);
    if (source?.archetype !== 'skeleton' || !source.health || !target?.health)
      return { success: false as const, reason: 'invalid-target' };
    const delta = {
      x: target.position[0] - source.position[0],
      y: target.position[1] + 1 - (source.position[1] + 1.4),
      z: target.position[2] - source.position[2],
    };
    if (Math.hypot(delta.x, delta.y, delta.z) > 16) return { success: false as const, reason: 'out-of-range' };
    const projectile = context.projectiles.fire({
      ownerId: skeletonId,
      position: { x: source.position[0], y: source.position[1] + 1.4, z: source.position[2] },
      direction: delta,
      speed: 16,
      damage: 4,
      lifetimeSeconds: 5,
    });
    return { success: true as const, projectile };
  },
  primeCreeper(creeperId: string) {
    const entity = context.entities.get(creeperId);
    if (entity?.archetype !== 'creeper' || !entity.health)
      return { success: false as const, reason: 'invalid-creeper' };
    try {
      return { success: true as const, tnt: context.environment.primeTnt(entity.position, 1.5, 3, creeperId) };
    } catch (error) {
      if (error instanceof Error && /already primed/.test(error.message))
        return { success: false as const, reason: 'already-primed' };
      throw error;
    }
  },
  splitSlime(slimeId: string) {
    const entity = context.entities.get(slimeId);
    const state = entity?.archetype === 'slime' ? context.entities.actorStateAccess(slimeId).species : null;
    if (!entity || !state || state.slimeSize === 1) return { success: false as const, reason: 'not-splittable' };
    const size = (state.slimeSize / 2) as 1 | 2;
    const ids = [1, 2].map((index) => `${slimeId}-child-${index}`);
    if (ids.some((id) => context.entities.get(id))) return { success: false as const, reason: 'child-id-conflict' };
    context.entities.validateCreateCapacity(2);
    context.despawn(slimeId);
    const children = ids.map((id, index) =>
      context.spawnSlime(id, [entity.position[0] + (index ? 0.35 : -0.35), entity.position[1], entity.position[2]], {
        ...state,
        slimeSize: size,
      }),
    );
    return { success: true as const, children };
  },
});
