import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { GameplayContent } from './gameplay-content';
import type { EntityStore } from './entity-store';
import type { PlayerState } from './player-state';
import type { RegisteredCombatRuntime } from './modules/registered-combat-runtime';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import type { BehaviorCapabilityRegistry } from '../composition/behavior-capability-registry';
import { AutonomyRuntime } from '../simulation/autonomy-runtime';
import { createGameplayCharacterDomain } from './gameplay-character-domain';
import { createGameplayCombatCallbacks } from './gameplay-combat-callbacks';
import { optionalRegisteredCombatRequest } from './optional-registered-combat-request';
import { Voxel } from '../../world/voxel';

export function createGameplayAutonomyRuntime(
  options: Readonly<{
    callbacks: GameplayCallbacks;
    entities: EntityStore;
    players: ReadonlyMap<string, PlayerState>;
    content: GameplayContent;
    modules: GameplayModuleRuntime;
    behaviorCapabilities: BehaviorCapabilityRegistry | null;
    registeredCombat: RegisteredCombatRuntime | null;
    assertCanChange(): void;
    changed(): void;
    simulation(): AutonomyRuntime;
    vitals: Parameters<typeof createGameplayCombatCallbacks>[0]['vitals'];
  }>,
): AutonomyRuntime {
  const { callbacks } = options;
  const characterDomain =
    options.behaviorCapabilities && callbacks.composition
      ? createGameplayCharacterDomain({
          capabilities: options.behaviorCapabilities,
          composition: callbacks.composition,
          entities: options.entities,
          actorAuthority: callbacks.moduleActorAuthority,
          invokeActor: (actorId, request) =>
            options.modules.invokeActor(callbacks.moduleActorAuthority, actorId, request),
        })
      : null;
  return new AutonomyRuntime({
    entities: options.entities,
    registeredNeeds: !!callbacks.composition,
    registeredCombat: !!callbacks.composition,
    combatOrigin: options.registeredCombat?.environment.originOptions,
    ...optionalRegisteredCombatRequest(options.registeredCombat),
    getVoxel: (x, y, z) => callbacks.getVoxel([x, y, z]) ?? Voxel.Stone,
    getWorldTime: callbacks.getWorldTime,
    isPlayerAlive: (id) => options.players.get(id)?.lifecycle === 'alive',
    clone: callbacks.platform.clone,
    meleeDefinitions: options.content.meleeDefinitions,
    actorProfiles: options.content.actorProfiles,
    enforceActorProfiles: !!callbacks.composition,
    ...(options.behaviorCapabilities && characterDomain
      ? { character: { capabilities: options.behaviorCapabilities, domain: characterDomain, changed: options.changed } }
      : {}),
    combat: createGameplayCombatCallbacks({
      entities: options.entities,
      players: options.players,
      simulation: options.simulation,
      vitals: options.vitals,
      getVoxel: callbacks.getVoxel,
      assertCanChange: options.assertCanChange,
      changed: options.changed,
    }),
  });
}
