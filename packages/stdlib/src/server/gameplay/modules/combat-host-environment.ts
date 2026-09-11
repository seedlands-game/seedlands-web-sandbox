import { isActorEntityType } from '../ecs-actor-state';
import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import type { WorldComposition, ModuleInvocationValue } from '../../composition/contracts';
import type { ModStateAddress } from '../../composition/operation-contracts';
import type { ModuleActorAuthority } from '../../composition/gameplay-actor-authority';
import { rebindDurableExecutionOrigin, type DurableExecutionOriginV1 } from '../../composition/execution-origin';
import type { EntityIdentityPort } from '../../simulation/action-identity';
import type { AutonomyRuntime } from '../../simulation/autonomy-runtime';
import type { EntityStore } from '../entity-store';
import type { GameplayContent } from '../gameplay-content';
import type { CombatOriginRuntimeOptions } from '../combat-origin';
import { validateCombatHit } from '../gameplay-combat';
import {
  COMBAT_ACTOR_COMPONENT,
  COMBAT_WORLD_COMPONENT,
  COMBAT_RESOURCE,
  COMBAT_PARTITIONS,
  COMBAT_PARTITION_SIZE,
  validateCombatActorProjection,
  validateCombatWorldPartition,
} from './combat-model';

export class CombatOriginUnavailable extends TypeError {}

export type CombatHostEnvironmentOptions = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  content: GameplayContent;
  simulation(): AutonomyRuntime;
  actorAuthority?: ModuleActorAuthority;
  actorIds(): readonly string[];
  getVoxel(position: [number, number, number]): number | undefined;
}>;

export function createCombatHostEnvironment(options: CombatHostEnvironmentOptions) {
  const { entities, composition } = options;
  const identity: EntityIdentityPort = {
    referenceFor: (id) => entities.createReference(id),
    resolve: (reference) => entities.resolveReference(reference)?.id ?? null,
    rebind: (reference) => {
      const current = entities.createReference(reference.entityId);
      return current?.lifetime === reference.lifetime ? current : null;
    },
  };
  const resolveOrigin = (origin: DurableExecutionOriginV1, targetId: string) => {
    const actor = entities.get(origin.originalActor.entityId);
    const binding = actor && options.actorAuthority?.resolveOrigin(origin, actor.type);
    if (!binding) throw new CombatOriginUnavailable('Combat origin has no current host authority.');
    const rebound = (() => {
      try {
        const rebound = rebindDurableExecutionOrigin({
          composition,
          identity,
          authorizer: binding.authorizer,
          origin,
          request: { resource: COMBAT_RESOURCE, operation: 'execute', target: { kind: 'entity', entityId: targetId } },
        });
        assertActorResourceExecution(composition, binding.authorizer, rebound.context, COMBAT_RESOURCE);
        return rebound;
      } catch (error) {
        if (error instanceof TypeError) throw new CombatOriginUnavailable(error.message);
        throw error;
      }
    })();
    for (const entityId of [actor.id, targetId]) {
      const decision = binding.authorizer.authorize(binding.principalId, {
        resource: COMBAT_RESOURCE,
        operation: 'read',
        target: { kind: 'entity', entityId },
      });
      if (!decision.allowed) throw new CombatOriginUnavailable('Current Combat observation permission denied.');
    }
    return { ...binding, rebound };
  };
  const originOptions: CombatOriginRuntimeOptions = {
    requireOrigin: true,
    validationPort: {
      validate(origin, checkpoint) {
        try {
          if (origin.originalActor.entityId !== checkpoint.actorId)
            throw new CombatOriginUnavailable('Combat actor origin mismatch.');
          resolveOrigin(origin, checkpoint.targetId);
          return { ok: true };
        } catch (error) {
          if (!(error instanceof CombatOriginUnavailable)) throw error;
          return { ok: false, reason: 'combat-origin-unavailable' };
        }
      },
    },
  };
  const projectActor = (id: string) => {
    const entity = entities.get(id),
      reference = entities.createReference(id);
    if (!entity || !reference || !isActorEntityType(entity.type)) throw new TypeError('Combat actor is unavailable.');
    const access = entities.actorStateAccess(id);
    const selected = access.inventory.slot(access.selectedSlot);
    const melee = selected ? options.content.items.capability(selected.itemId, 'melee') : undefined;
    const definitionId =
      entity.type === 'player'
        ? (melee?.definitionId ?? options.content.actorProfiles.defaultPlayerMeleeDefinitionId)
        : entity.archetype
          ? options.content.actorProfiles.get(entity.archetype)?.meleeDefinitionId
          : undefined;
    const pending = options
      .simulation()
      .combat.peekPendingHits()
      .find((hit) => hit.actorId === id);
    return validateCombatActorProjection({
      version: 1,
      reference,
      kind: entity.type,
      health: access.health,
      maxHealth: access.maxHealth,
      lifecycle: access.lifecycle,
      mode: { value: access.mode, revision: access.modeRevision },
      meleeDefinitionId: definitionId ?? null,
      combat: options.simulation().combat.snapshotFor(id),
      pending: pending ? { token: pending.token, targetId: pending.targetId, baseDamage: pending.baseDamage } : null,
    });
  };
  const project = (address: ModStateAddress): ModuleInvocationValue => {
    if (
      address.componentId === COMBAT_ACTOR_COMPONENT &&
      address.target.kind === 'entity' &&
      address.partition === undefined
    )
      return projectActor(address.target.entityId);
    if (
      address.componentId !== COMBAT_WORLD_COMPONENT ||
      address.target.kind !== 'world' ||
      !Number.isInteger(address.partition) ||
      address.partition! < 0 ||
      address.partition! >= COMBAT_PARTITIONS
    )
      throw new TypeError('Unsupported Combat projection address.');
    const ids = [...new Set(options.actorIds())].sort();
    if (ids.length > COMBAT_PARTITIONS * COMBAT_PARTITION_SIZE)
      throw new RangeError('Combat actor partition capacity exceeded.');
    const pending = new Set(
      options
        .simulation()
        .combat.peekPendingHits()
        .map((hit) => hit.actorId),
    );
    return validateCombatWorldPartition({
      version: 1,
      partition: address.partition,
      entries: ids
        .slice(address.partition! * COMBAT_PARTITION_SIZE, (address.partition! + 1) * COMBAT_PARTITION_SIZE)
        .map((id) => ({
          reference: entities.createReference(id),
          active: options.simulation().combat.snapshotFor(id).active !== null,
          pending: pending.has(id),
        })),
    });
  };
  const hitFailure = (actorId: string, targetId: string, definitionId: string) => {
    const definition = options.content.meleeDefinitions.find((entry) => entry.id === definitionId);
    if (!definition) return 'combat-definition-unavailable';
    return validateCombatHit(
      {
        entities,
        getVoxel: options.getVoxel,
        isPlayerAlive: (id) => entities.actorStateAccess(id).lifecycle === 'alive',
      },
      actorId,
      targetId,
      definition,
    );
  };
  return { identity, originOptions, resolveOrigin, project, projectActor, hitFailure };
}
