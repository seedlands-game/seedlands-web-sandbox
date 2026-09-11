import type { ModModule } from '../../composition/contracts';
import {
  COMBAT_ACTOR_COMPONENT,
  COMBAT_ADVANCE_OPERATION,
  COMBAT_CAPABILITY,
  COMBAT_CLOCK_RESOURCE,
  COMBAT_PARTITIONS,
  COMBAT_REQUEST_OPERATION,
  COMBAT_RESOLVE_OPERATION,
  COMBAT_RESOURCE,
  COMBAT_SYSTEM,
  COMBAT_WORLD_COMPONENT,
  combatActorAddress,
  combatCapability,
  combatWorldAddress,
  validateCombatActorProjection,
  validateCombatAdvanceInput,
  validateCombatRequestEffectiveInput,
  validateCombatResolveEffectiveInput,
  validateCombatWorldPartition,
  type CombatAdvanceCandidateV1,
  type CombatRequestCandidateV1,
  type CombatResolveCandidateV1,
} from './combat-model';

const actorContext = (context: Readonly<{ kind: string; originalActorId?: string; target: unknown }>) => {
  if (context.kind !== 'actor' || !context.originalActorId) throw new TypeError('Combat requires an actor context.');
  return context.originalActorId;
};

const entityTarget = (target: unknown): string => {
  if (!target || typeof target !== 'object') throw new TypeError('Combat requires an entity target.');
  const value = target as { kind?: unknown; entityId?: unknown };
  if (value.kind !== 'entity' || typeof value.entityId !== 'string')
    throw new TypeError('Combat requires an entity target.');
  return value.entityId;
};

export function defineCombatModule(): ModModule {
  return Object.freeze({
    descriptor: {
      id: 'seedlands:combat-module',
      version: '1.0.0',
      provides: [{ id: COMBAT_CAPABILITY, version: '1.0.0' }],
      resources: [
        { id: COMBAT_RESOURCE, operations: ['read', 'execute'] },
        { id: COMBAT_CLOCK_RESOURCE, operations: ['read', 'execute'] },
      ],
      permissions: [
        { resource: COMBAT_RESOURCE, operations: ['read', 'execute'] },
        { resource: COMBAT_CLOCK_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      api.provideCapability(COMBAT_CAPABILITY, combatCapability());
      api.registerState({
        id: COMBAT_ACTOR_COMPONENT,
        version: '1.0.0',
        resource: COMBAT_RESOURCE,
        validate(value) {
          try {
            validateCombatActorProjection(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerState({
        id: COMBAT_WORLD_COMPONENT,
        version: '1.0.0',
        resource: COMBAT_CLOCK_RESOURCE,
        partitions: COMBAT_PARTITIONS,
        validate(value) {
          try {
            validateCombatWorldPartition(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerOperation({
        id: COMBAT_REQUEST_OPERATION,
        resource: COMBAT_RESOURCE,
        run(context, input, state): CombatRequestCandidateV1 {
          const actorId = actorContext(context);
          const targetId = entityTarget(context.target);
          const effective = validateCombatRequestEffectiveInput(input);
          if (effective.targetId !== targetId || actorId === targetId)
            throw new TypeError('Combat request target does not match its execution context.');
          const actor = validateCombatActorProjection(state.read(combatActorAddress(actorId)));
          const target = validateCombatActorProjection(state.read(combatActorAddress(targetId)));
          if (actor.reference.entityId !== actorId || target.reference.entityId !== targetId)
            throw new TypeError('Combat actor projection identity is invalid.');
          if (actor.meleeDefinitionId === null) throw new TypeError('Combat actor has no configured melee definition.');
          if (actor.lifecycle !== 'alive' || target.lifecycle !== 'alive')
            throw new TypeError('Combat requires living actor projections.');
          return Object.freeze({
            version: 1,
            kind: 'request',
            actorId,
            targetId,
            definitionId: actor.meleeDefinitionId,
            rulesetRevision: effective.rulesetRevision,
          });
        },
      });
      api.registerOperation({
        id: COMBAT_RESOLVE_OPERATION,
        resource: COMBAT_RESOURCE,
        run(context, input, state): CombatResolveCandidateV1 {
          const actorId = actorContext(context);
          const targetId = entityTarget(context.target);
          const effective = validateCombatResolveEffectiveInput(input);
          const actor = validateCombatActorProjection(state.read(combatActorAddress(actorId)));
          const target = validateCombatActorProjection(state.read(combatActorAddress(targetId)));
          if (
            actor.reference.entityId !== actorId ||
            target.reference.entityId !== targetId ||
            actor.pending?.token !== effective.token ||
            actor.pending.targetId !== targetId
          )
            throw new TypeError('Combat pending projection does not match resolve context.');
          return Object.freeze({
            version: 1,
            kind: 'resolve',
            actorId,
            targetId,
            token: effective.token,
            damage: effective.damage,
            rulesetRevision: effective.rulesetRevision,
          });
        },
      });
      api.registerOperation({
        id: COMBAT_ADVANCE_OPERATION,
        executionKind: 'system',
        resource: COMBAT_CLOCK_RESOURCE,
        run(context, input, state): CombatAdvanceCandidateV1 {
          if (context.kind !== 'system' || context.target.kind !== 'world')
            throw new TypeError('Combat advance requires its world clock.');
          const advance = validateCombatAdvanceInput(input);
          for (let partition = 0; partition < COMBAT_PARTITIONS; partition++)
            validateCombatWorldPartition(state.read(combatWorldAddress(partition)));
          return Object.freeze({ version: 1, kind: 'advance', ...advance });
        },
      });
      api.registerSystem({
        id: COMBAT_SYSTEM,
        operationId: COMBAT_ADVANCE_OPERATION,
        cadence: 'every-advance',
      });
    },
  } satisfies ModModule);
}
