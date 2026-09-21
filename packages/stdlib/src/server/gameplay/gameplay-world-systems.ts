import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { GameplayContent } from './gameplay-content';
import type { EntitySpawn, EntityStore, GameplayEntity } from './entity-store';
import type { PlayerState } from './player-state';
import type { ActorRegistration } from '../simulation/autonomy-runtime';
import type { ActorVitalsRuntime } from './modules/actor-vitals-runtime';
import type { EnvironmentRuntime } from './environment-runtime';
import { createGameplayProjectileOwner } from './gameplay-projectile-environment';
import { createGameplaySpeciesFacade } from './gameplay-species-facade';
import { LifeSkillsRuntime } from './life-skills-runtime';
import { VehicleRuntime } from './vehicle-runtime';
import { NavigationItemsRuntime } from './navigation-items-runtime';

export function createGameplayWorldSystems(
  options: Readonly<{
    callbacks: GameplayCallbacks;
    content: GameplayContent;
    entities: EntityStore;
    players: ReadonlyMap<string, PlayerState>;
    simulation(): AutonomyRuntime;
    vitals: ActorVitalsRuntime;
    environment: EnvironmentRuntime;
    assertCanChange(): void;
    changed(): void;
    despawn(id: string): boolean;
    spawn(input: EntitySpawn, registration: ActorRegistration): GameplayEntity;
  }>,
) {
  const projectiles = createGameplayProjectileOwner({
    entities: options.entities,
    players: options.players,
    simulation: options.simulation,
    vitals: options.vitals,
    content: options.content,
    getVoxel: options.callbacks.getLoadedVoxel ?? options.callbacks.getVoxel,
    assertCanChange: options.assertCanChange,
    changed: options.changed,
  });
  const speciesInteractions = createGameplaySpeciesFacade({
    entities: options.entities,
    projectiles,
    environment: options.environment,
    changed: options.changed,
    despawn: options.despawn,
    spawn: options.spawn,
  });
  const lifeSkills = new LifeSkillsRuntime({
    seed: options.callbacks.environmentSeed ?? 0,
    entities: options.entities,
    getLoadedVoxel: options.callbacks.getLoadedVoxel,
    spawnChicken: (id, position) => options.spawn({ id, archetype: 'chicken', position }, { archetype: 'chicken' }),
    changed: options.changed,
  });
  const vehicles = new VehicleRuntime({
    entities: options.entities,
    getLoadedVoxel: options.callbacks.getLoadedVoxel,
    changed: options.changed,
  });
  const navigationItems = new NavigationItemsRuntime({
    entities: options.entities,
    getWorldTime: options.callbacks.getWorldTime,
    getLoadedVoxel: options.callbacks.getLoadedVoxel,
    changed: options.changed,
  });
  return { projectiles, speciesInteractions, lifeSkills, vehicles, navigationItems };
}
