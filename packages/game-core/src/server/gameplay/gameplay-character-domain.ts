import type { WorldComposition } from '../composition/contracts';
import type { BehaviorCapability } from '../../runtime/behavior-control-protocol';
import type { ModuleActorAuthority } from '../composition/gameplay-actor-authority';
import type { BehaviorCapabilityRegistry, BehaviorProviderOrigin } from '../composition/behavior-capability-registry';
import type { RegisteredOperationRequest, RegisteredOperationResult } from '../composition/operation-contracts';
import type { CharacterActorDomainPort } from '../simulation/character-runtime-types';
import { isActorEntityType } from './ecs-actor-state';
import type { EntityStore } from './entity-store';

type Options = Readonly<{
  composition: WorldComposition;
  capabilities: BehaviorCapabilityRegistry;
  entities: EntityStore;
  actorAuthority?: ModuleActorAuthority;
  invokeActor(actorId: string, request: RegisteredOperationRequest): RegisteredOperationResult;
}>;

type AdmissionOptions = Pick<Options, 'composition' | 'capabilities' | 'actorAuthority'>;

const providerMatches = (capabilities: BehaviorCapabilityRegistry, origin: BehaviorProviderOrigin): boolean =>
  capabilities
    .catalog()
    .some(
      (entry) =>
        entry.id === origin.providerId &&
        entry.version === origin.providerVersion &&
        entry.provider.moduleId === origin.moduleId,
    );

const capabilityProviderMatches = (capabilities: BehaviorCapabilityRegistry, capability: BehaviorCapability) =>
  providerMatches(capabilities, {
    moduleId: capability.provider.moduleId,
    providerId: capability.id,
    providerVersion: capability.version,
  });

export function allowsGameplayBehaviorCapability(
  options: AdmissionOptions,
  actorId: string,
  kind: 'player' | 'npc' | 'creature',
  capability: BehaviorCapability,
): boolean {
  if (!capabilityProviderMatches(options.capabilities, capability)) return false;
  const authority = options.actorAuthority?.forActor(actorId, kind);
  const provider = options.composition.moduleBindings[capability.provider.moduleId];
  if (!authority || !provider) return capability.requiredOperations.length === 0;
  return capability.requiredOperations.every((requirement) => {
    const operation = options.composition.registrations.operations.find(
      ({ definition }) => definition.id === requirement.operationId,
    );
    if (
      !operation ||
      !provider.permissions.some(
        (permission) =>
          permission.resource === operation.definition.resource && permission.operations.includes('execute'),
      )
    )
      return false;
    return authority.authorizer.authorize(authority.principalId, {
      resource: operation.definition.resource,
      operation: 'execute',
      target: requirement.authorization === 'self' ? { kind: 'entity', entityId: actorId } : { kind: 'world' },
    }).allowed;
  });
}

/** Binds behavior provider calls to the ECS-owned actor and the provider module's frozen grants. */
export function createGameplayCharacterDomain(options: Options): CharacterActorDomainPort {
  const allowsCapability = (
    actorId: string,
    capability: BehaviorCapability,
    candidateKind?: 'npc' | 'creature',
  ): boolean => {
    const actor = options.entities.get(actorId);
    const kind = candidateKind ?? actor?.type;
    if (kind !== 'player' && kind !== 'npc' && kind !== 'creature') return false;
    return allowsGameplayBehaviorCapability(options, actorId, kind, capability);
  };
  return Object.freeze({
    read: (actorId: string) => {
      const entity = options.entities.get(actorId);
      const reference = options.entities.createReference(actorId);
      if (
        !entity ||
        !reference ||
        !isActorEntityType(entity.type) ||
        entity.health === undefined ||
        entity.maxHealth === undefined
      )
        return null;
      const actor = options.entities.actorStateAccess(actorId);
      return Object.freeze({
        reference,
        lifecycle: actor.lifecycle,
        controlSource: actor.controlSource,
        controlRevision: actor.controlRevision,
        health: entity.health,
        maxHealth: entity.maxHealth,
        needs: Object.freeze({
          hunger: actor.hunger,
          maxHunger: actor.maxHunger,
          hungerMeaning: actor.hungerMeaning,
        }),
        inventory: Object.freeze({
          slots: Object.freeze(actor.inventory.snapshot()),
          selectedSlot: actor.selectedSlot,
          revision: actor.inventoryRevision,
        }),
      });
    },
    allowsCapability,
    invoke: (actorId: string, origin: BehaviorProviderOrigin, request: RegisteredOperationRequest) => {
      if (!providerMatches(options.capabilities, origin))
        return { ok: false as const, code: 'BEHAVIOR_PROVIDER_STALE', message: 'Behavior provider identity is stale.' };
      const operation = options.composition.registrations.operations.find(
        ({ definition }) => definition.id === request.operationId,
      );
      if (!operation) return { ok: false as const, code: 'OPERATION_UNKNOWN', message: 'Operation is not registered.' };
      const provider = options.composition.moduleBindings[origin.moduleId];
      if (
        !provider?.permissions.some(
          (permission) =>
            permission.resource === operation.definition.resource && permission.operations.includes('execute'),
        )
      )
        return {
          ok: false as const,
          code: 'BEHAVIOR_PROVIDER_PERMISSION_DENIED',
          message: 'Behavior provider is not permitted to execute this operation.',
        };
      return options.invokeActor(actorId, request);
    },
  });
}
