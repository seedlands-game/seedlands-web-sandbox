import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { isSolid } from '../../world/voxel';
import type { EntityStore } from './entity-store';
import { createProjectileRuntime, type ProjectileEnvironment, type ProjectileVector } from './projectile-runtime';
import type { GameplayContent } from './gameplay-content';
import type { PlayerState } from './player-state';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { ActorVitalsRuntime } from './modules/actor-vitals-runtime';
import { createGameplayCombatCallbacks } from './gameplay-combat-callbacks';
import { fireSelectedRangedItem } from './ranged-action';

const pointAt = (from: ProjectileVector, to: ProjectileVector, fraction: number) => ({
  x: from.x + (to.x - from.x) * fraction,
  y: from.y + (to.y - from.y) * fraction,
  z: from.z + (to.z - from.z) * fraction,
});

export function createGameplayProjectileEnvironment(
  options: Readonly<{
    entities: EntityStore;
    getVoxel(position: [number, number, number]): number | undefined;
    isVoxelSolid?: (voxel: number) => boolean;
    applyDamage(ownerId: string, targetId: string, damage: number): void;
  }>,
): ProjectileEnvironment {
  return {
    firstVoxelHit(from, to) {
      const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      const steps = Math.max(1, Math.ceil(distance * 8));
      for (let index = 1; index <= steps; index++) {
        const fraction = index / steps,
          point = pointAt(from, to, fraction);
        const voxel = options.getVoxel([Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)]);
        if (voxel === undefined || (options.isVoxelSolid ?? isSolid)(voxel)) return { fraction };
      }
      return null;
    },
    firstActorHit(ownerId, from, to) {
      let first: { fraction: number; targetId: string } | null = null;
      for (const entity of options.entities.query().sort((a, b) => a.id.localeCompare(b.id))) {
        if (entity.id === ownerId || !['player', 'creature', 'npc'].includes(entity.type) || !entity.health) continue;
        const box = bodyConfigFor(bodyKindForEntity(entity)).localAabb;
        for (let index = 1; index <= 64; index++) {
          const fraction = index / 64,
            point = pointAt(from, to, fraction);
          if (
            point.x < entity.position[0] + box.min.x ||
            point.x > entity.position[0] + box.max.x ||
            point.y < entity.position[1] + box.min.y ||
            point.y > entity.position[1] + box.max.y ||
            point.z < entity.position[2] + box.min.z ||
            point.z > entity.position[2] + box.max.z
          )
            continue;
          if (!first || fraction < first.fraction) first = { fraction, targetId: entity.id };
          break;
        }
      }
      return first;
    },
    applyDamage: options.applyDamage,
  };
}

export function createGameplayProjectileOwner(
  options: Readonly<{
    entities: EntityStore;
    players: ReadonlyMap<string, PlayerState>;
    simulation(): AutonomyRuntime;
    vitals: ActorVitalsRuntime;
    content: GameplayContent;
    getVoxel(position: [number, number, number]): number | undefined;
    isVoxelSolid?: (voxel: number) => boolean;
    assertCanChange(): void;
    changed(): void;
  }>,
) {
  const combat = createGameplayCombatCallbacks(options);
  const runtime = createProjectileRuntime(
    createGameplayProjectileEnvironment({
      entities: options.entities,
      getVoxel: options.getVoxel,
      isVoxelSolid: options.isVoxelSolid,
      applyDamage: (ownerId, targetId, damage) => {
        combat.applyDamage(ownerId, targetId, damage);
      },
    }),
  );
  return Object.assign(runtime, {
    fireSelected(ownerId: string, direction: ProjectileVector) {
      const entity = options.entities.get(ownerId);
      if (!entity || !['player', 'creature', 'npc'].includes(entity.type))
        return { success: false as const, reason: 'invalid-actor' };
      const actor = options.entities.actorStateAccess(ownerId);
      const result = fireSelectedRangedItem({
        ownerId,
        selectedSlot: actor.selectedSlot,
        position: { x: entity.position[0], y: entity.position[1] + 1.5, z: entity.position[2] },
        direction,
        inventory: actor.inventory,
        items: options.content.items,
        projectiles: runtime,
      });
      if (result.success) options.changed();
      return result;
    },
  });
}
