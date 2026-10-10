import type { CoreClone } from '../../runtime/platform-ports';
import type { BehaviorCapabilityRegistry } from '../composition/behavior-capability-registry';
import type { ActorProfileRegistry } from '../gameplay/actor-profile';
import type { CombatOriginRuntimeOptions } from '../gameplay/combat-origin';
import type { CombatRequestResult, CombatRuntimeCallbacks, MeleeDefinition } from '../gameplay/combat-runtime';
import type { BodyConfig } from '../../physics/types';
import type { GameplayEntity } from '../gameplay/entity-store';
import type { EntityStore } from '../gameplay/entity-store';
import type { CharacterActorDomainPort } from './character-runtime-types';

export type AutonomyRuntimeOptions = {
  entities: EntityStore;
  bodyConfig?: (entity: Pick<GameplayEntity, 'id' | 'type' | 'archetype' | 'position'>) => BodyConfig;
  getVoxel: (x: number, y: number, z: number) => number;
  isVoxelSolid?: (voxel: number) => boolean;
  getWorldTime: () => number;
  isPlayerAlive: (id: string) => boolean;
  clone: CoreClone;
  combat?: CombatRuntimeCallbacks;
  meleeDefinitions?: readonly MeleeDefinition[];
  registeredNeeds?: boolean;
  registeredCombat?: boolean;
  combatOrigin?: CombatOriginRuntimeOptions;
  registeredCombatRequest?: (actorId: string, targetId: string, existingActionId?: string) => CombatRequestResult;
  actorProfiles?: ActorProfileRegistry;
  enforceActorProfiles?: boolean;
  character?: Readonly<{
    capabilities: BehaviorCapabilityRegistry;
    domain: CharacterActorDomainPort;
    changed: () => void;
  }>;
};
