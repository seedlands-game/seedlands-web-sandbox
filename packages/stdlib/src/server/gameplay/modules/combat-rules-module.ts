import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import {
  RULESET_COMPONENT,
  RULESET_RESOURCE,
  validateWorldRuleset,
  type WorldRulesetDefinition,
} from './ruleset-module';
import {
  COMBAT_CAPABILITY,
  COMBAT_REQUEST_OPERATION,
  COMBAT_RESOLVE_OPERATION,
  COMBAT_RESOURCE,
  combatActorAddress,
  validateCombatActorProjection,
  validateCombatCandidate,
  validateCombatRequestEffectiveInput,
  validateCombatRequestInput,
  validateCombatResolveEffectiveInput,
  validateCombatResolveInput,
  validateCombatRulesProfile,
  type CombatCapabilityV1,
  type CombatRulesProfile,
} from './combat-model';

const currentRuleset = (
  state: Readonly<{ read(address: { componentId: string; target: { kind: 'world' } }): ModuleInvocationValue }>,
  definition: WorldRulesetDefinition,
) => validateWorldRuleset(state.read({ componentId: RULESET_COMPONENT, target: { kind: 'world' } }), definition);

const actorContext = (context: Readonly<{ kind: string; originalActorId?: string; target: unknown }>) => {
  if (context.kind !== 'actor' || !context.originalActorId)
    throw new TypeError('Combat rule requires an actor context.');
  const target = context.target as { kind?: unknown; entityId?: unknown };
  if (target?.kind !== 'entity' || typeof target.entityId !== 'string')
    throw new TypeError('Combat rule requires an entity target.');
  return { actorId: context.originalActorId, targetId: target.entityId };
};

const damageFor = (baseDamage: number, targetMode: string, profile: CombatRulesProfile): number =>
  profile.immuneTargetModes.includes(targetMode as 'survival' | 'creative')
    ? 0
    : Math.round(baseDamage * profile.damageMultiplier * 1_000_000) / 1_000_000;

export function defineCombatRulesModule(
  options: Readonly<{ moduleId: string; profile: CombatRulesProfile }>,
): ModModule {
  if (typeof options.moduleId !== 'string' || !options.moduleId.trim())
    throw new TypeError('Combat Ruleset module ID is invalid.');
  const profile = validateCombatRulesProfile(options.profile);
  return Object.freeze({
    descriptor: {
      id: options.moduleId,
      version: '1.0.0',
      requires: [
        { id: COMBAT_CAPABILITY, version: '1.0.0' },
        { id: RULESET_COMPONENT, version: '1.0.0' },
      ],
      permissions: [
        { resource: COMBAT_RESOURCE, operations: ['read', 'execute'] },
        { resource: RULESET_RESOURCE, operations: ['read'] },
      ],
    },
    register(api) {
      api.requireCapability<CombatCapabilityV1>(COMBAT_CAPABILITY);
      const ruleset = api.requireCapability<WorldRulesetDefinition>(RULESET_COMPONENT);
      api.registerRule({
        id: `${options.moduleId}/request-before`,
        operationId: COMBAT_REQUEST_OPERATION,
        stage: 'before',
        apply(context, input, state) {
          const request = validateCombatRequestInput(input);
          const { actorId, targetId } = actorContext(context);
          if (request.targetId !== targetId) throw new TypeError('Combat request target changed.');
          validateCombatActorProjection(state.read(combatActorAddress(actorId)));
          validateCombatActorProjection(state.read(combatActorAddress(targetId)));
          const current = currentRuleset(state, ruleset);
          return { input: { targetId, rulesetRevision: current.revision } };
        },
      });
      api.registerRule({
        id: `${options.moduleId}/request-after`,
        operationId: COMBAT_REQUEST_OPERATION,
        stage: 'after',
        apply(context, input, state, candidate) {
          const effective = validateCombatRequestEffectiveInput(input);
          const value = validateCombatCandidate(candidate);
          const { actorId, targetId } = actorContext(context);
          const actor = validateCombatActorProjection(state.read(combatActorAddress(actorId)));
          const target = validateCombatActorProjection(state.read(combatActorAddress(targetId)));
          const current = currentRuleset(state, ruleset);
          if (
            value.kind !== 'request' ||
            value.actorId !== actorId ||
            value.targetId !== targetId ||
            value.targetId !== effective.targetId ||
            value.definitionId !== actor.meleeDefinitionId ||
            value.rulesetRevision !== effective.rulesetRevision ||
            value.rulesetRevision !== current.revision ||
            target.reference.entityId !== targetId
          )
            return { reject: 'combat-request-candidate-mismatch' };
        },
      });
      api.registerRule({
        id: `${options.moduleId}/resolve-before`,
        operationId: COMBAT_RESOLVE_OPERATION,
        stage: 'before',
        apply(context, input, state) {
          const request = validateCombatResolveInput(input);
          const { actorId, targetId } = actorContext(context);
          const actor = validateCombatActorProjection(state.read(combatActorAddress(actorId)));
          const target = validateCombatActorProjection(state.read(combatActorAddress(targetId)));
          if (actor.pending?.token !== request.token || actor.pending.targetId !== targetId)
            throw new TypeError('Combat pending hit changed.');
          const current = currentRuleset(state, ruleset);
          return {
            input: {
              token: request.token,
              damage: damageFor(actor.pending.baseDamage, target.mode.value, profile),
              rulesetRevision: current.revision,
            },
          };
        },
      });
      api.registerRule({
        id: `${options.moduleId}/resolve-after`,
        operationId: COMBAT_RESOLVE_OPERATION,
        stage: 'after',
        apply(context, input, state, candidate) {
          const effective = validateCombatResolveEffectiveInput(input);
          const value = validateCombatCandidate(candidate);
          const { actorId, targetId } = actorContext(context);
          const actor = validateCombatActorProjection(state.read(combatActorAddress(actorId)));
          const target = validateCombatActorProjection(state.read(combatActorAddress(targetId)));
          const current = currentRuleset(state, ruleset);
          const expected = actor.pending ? damageFor(actor.pending.baseDamage, target.mode.value, profile) : Number.NaN;
          if (
            value.kind !== 'resolve' ||
            value.actorId !== actorId ||
            value.targetId !== targetId ||
            value.token !== effective.token ||
            value.damage !== effective.damage ||
            value.damage !== expected ||
            value.rulesetRevision !== effective.rulesetRevision ||
            value.rulesetRevision !== current.revision
          )
            return { reject: 'combat-resolve-candidate-mismatch' };
        },
      });
    },
  } satisfies ModModule);
}
