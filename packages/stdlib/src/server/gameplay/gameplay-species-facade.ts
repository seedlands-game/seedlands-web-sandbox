import type { EnvironmentRuntime } from './environment-runtime';
import type { EntityStore, EntitySpawn, GameplayEntity } from './entity-store';
import type { ProjectileRuntime } from './projectile-runtime';
import type { ActorRegistration } from '../simulation/autonomy-runtime';
import type { SpeciesStateV1 } from './species-state';
import { createHostileSpeciesMechanics } from './hostile-species-mechanics';
import { dyeSheep, regrowSheepWool, shearSheep, tameWolf, toggleWolfSitting } from './species-interactions';

export function createGameplaySpeciesFacade(
  options: Readonly<{
    entities: EntityStore;
    projectiles: ProjectileRuntime;
    environment: EnvironmentRuntime;
    changed(): void;
    despawn(id: string): boolean;
    spawn(input: EntitySpawn, registration: ActorRegistration): GameplayEntity;
  }>,
) {
  const context = () => ({ entities: options.entities, changed: options.changed });
  return Object.freeze({
    shear: (playerId: string, targetId: string) => shearSheep(context(), playerId, targetId),
    tame: (playerId: string, targetId: string) => tameWolf(context(), playerId, targetId),
    toggleSitting: (playerId: string, targetId: string) => toggleWolfSitting(context(), playerId, targetId),
    dye: (playerId: string, targetId: string) => dyeSheep(context(), playerId, targetId),
    regrowWool: (targetId: string) => regrowSheepWool(context(), targetId),
    ...createHostileSpeciesMechanics({
      entities: options.entities,
      projectiles: options.projectiles,
      environment: options.environment,
      despawn: options.despawn,
      spawnSlime: (id: string, position: [number, number, number], state: SpeciesStateV1) => {
        const entity = options.spawn({ id, archetype: 'slime', position }, { archetype: 'slime' });
        options.entities.actorStateAccess(id).replaceSpecies(state);
        return entity;
      },
    }),
  });
}
