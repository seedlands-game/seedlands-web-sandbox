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
import { CropRuntime } from './crop-runtime';
import { StructureInteractionRuntime } from './structure-interaction-runtime';
import { FinalEntitiesRuntime } from './final-entities-runtime';
import { createGameplayCombatCallbacks } from './gameplay-combat-callbacks';
import { Voxel } from '../../world/voxel';
import { SpecialDamageRuntime } from './special-damage-runtime';

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
    isVoxelSolid: (voxel) => options.content.voxelSemantics.get(voxel)?.solid ?? false,
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
  const crops = new CropRuntime({
    seed: options.callbacks.environmentSeed ?? 0,
    entities: options.entities,
    getLoadedVoxel: options.callbacks.getLoadedVoxel,
    changed: options.changed,
  });
  const structures = new StructureInteractionRuntime({
    entities: options.entities,
    getLoadedVoxel: options.callbacks.getLoadedVoxel,
    editBatch: options.callbacks.editBatch,
    getWorldTime: options.callbacks.getWorldTime,
    setWorldTime: options.callbacks.setWorldTime,
    ignite: (position) => options.environment.ignite(position),
    changed: options.changed,
  });
  const combat = createGameplayCombatCallbacks({
    entities: options.entities,
    players: options.players,
    simulation: options.simulation,
    vitals: options.vitals,
    getVoxel: options.callbacks.getLoadedVoxel ?? options.callbacks.getVoxel,
    assertCanChange: options.assertCanChange,
    changed: options.changed,
  });
  const finalEntities = new FinalEntitiesRuntime({
    entities: options.entities,
    projectiles,
    getLoadedVoxel: options.callbacks.getLoadedVoxel,
    editBatch: options.callbacks.editBatch,
    changed: options.changed,
    canStrike: ([x, y, z]) => {
      if (
        options.environment.checkpoint().weather !== 'thunder' ||
        options.callbacks.getLoadedVoxel?.([x, y, z]) === undefined
      )
        return false;
      for (let above = y + 1; above < 64; above++)
        if (options.callbacks.getLoadedVoxel?.([x, above, z]) !== Voxel.Air) return false;
      return true;
    },
    strike: (position) => options.environment.strikeLightning(position),
    damage: (source, target, amount) => void combat.applyDamage(source, target, amount),
    convertPigs: (pigs, sequence) => {
      options.entities.validateCreateIdentities(
        pigs.length,
        pigs.map(({ id }) => `lightning-${sequence}:${id}`),
      );
      for (const { id, position } of pigs) {
        options.despawn(id);
        options.spawn(
          { id: `lightning-${sequence}:${id}`, archetype: 'pig-zombie', position },
          { archetype: 'pig-zombie' },
        );
      }
    },
  });
  const specialDamage = new SpecialDamageRuntime((source, target, amount) =>
    combat.applyDamage(source, target, amount),
  );
  return {
    projectiles,
    speciesInteractions,
    lifeSkills,
    vehicles,
    navigationItems,
    crops,
    structures,
    finalEntities,
    specialDamage,
  };
}
