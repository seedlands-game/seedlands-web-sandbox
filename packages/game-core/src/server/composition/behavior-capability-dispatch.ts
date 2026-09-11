import {
  BEHAVIOR_MAX_CAPABILITY_STATE_BYTES,
  type BehaviorCapability,
  type BehaviorJson,
} from '../../runtime/behavior-control-protocol';
import type { ModRegistrationIdentity } from './contracts';
import type { RegisteredOperationRequest } from './operation-contracts';
import {
  assertBehaviorJson,
  behaviorJsonBytes,
  behaviorObject,
  frozenBehaviorValue,
} from './behavior-capability-validation';
import { snapshotBehaviorOperationRequirements } from './behavior-capability-admission';
import type {
  BehaviorProviderContext,
  BehaviorProviderDefinition,
  BehaviorRuntimeContext,
  BehaviorSkillProviderResult,
} from './behavior-capability-registry';

export type RegisteredBehaviorProvider = Readonly<{
  identity: ModRegistrationIdentity;
  definition: BehaviorProviderDefinition;
  descriptor: BehaviorCapability;
}>;

export const snapshotBehaviorProvider = (definition: BehaviorProviderDefinition): BehaviorProviderDefinition => {
  const base = {
    id: definition.id,
    version: definition.version,
    description: definition.description,
    arguments: frozenBehaviorValue(definition.arguments),
  };
  if (definition.kind === 'condition')
    return Object.freeze({ ...base, kind: definition.kind, evaluate: definition.evaluate });
  return Object.freeze({
    ...base,
    kind: definition.kind,
    requiredOperations: snapshotBehaviorOperationRequirements(definition.requiredOperations),
    state: Object.freeze({ ...definition.state }),
    start: definition.start,
    continue: definition.continue,
    ...(definition.cancel ? { cancel: definition.cancel } : {}),
  });
};

export function assertBehaviorProviderContext(context: BehaviorRuntimeContext): void {
  if (
    !behaviorObject(context) ||
    !behaviorObject(context.actor) ||
    !context.actor.entityId ||
    !Number.isSafeInteger(context.actor.epoch) ||
    !Number.isSafeInteger(context.actor.lifetime) ||
    !Number.isSafeInteger(context.actor.behaviorRevision) ||
    !Number.isSafeInteger(context.actor.activation) ||
    !behaviorObject(context.actorState) ||
    context.actorState.reference.entityId !== context.actor.entityId ||
    context.actorState.reference.epoch !== context.actor.epoch ||
    context.actorState.reference.lifetime !== context.actor.lifetime ||
    !Number.isFinite(context.deltaSeconds) ||
    context.deltaSeconds < 0 ||
    !Number.isFinite(context.elapsedSeconds) ||
    context.elapsedSeconds < 0 ||
    typeof context.invoke !== 'function' ||
    typeof context.resolveTarget !== 'function' ||
    typeof context.allows !== 'function' ||
    !behaviorObject(context.standard)
  )
    throw new TypeError('Behavior provider context is invalid.');
}

export function createBehaviorProviderContext(
  provider: RegisteredBehaviorProvider,
  context: BehaviorRuntimeContext,
  standardProviderModuleId: string,
): BehaviorProviderContext {
  const origin = Object.freeze({
    moduleId: provider.identity.moduleId,
    providerId: provider.descriptor.id,
    providerVersion: provider.descriptor.version,
  });
  const permittedTargets = new Set<string>();
  const resolveTarget = (reference: string) => {
    const resolved = context.resolveTarget(reference);
    if (resolved) permittedTargets.add(resolved.entityId);
    return resolved ? Object.freeze({ ...resolved }) : null;
  };
  return Object.freeze({
    actor: context.actor,
    actorState: context.actorState,
    deltaSeconds: context.deltaSeconds,
    elapsedSeconds: context.elapsedSeconds,
    resolveTarget,
    invoke: (request: RegisteredOperationRequest) => {
      const requirement =
        provider.definition.kind === 'skill'
          ? provider.definition.requiredOperations.find(({ operationId }) => operationId === request.operationId)
          : undefined;
      const authorized =
        requirement?.authorization === 'any' ||
        (requirement?.authorization === 'self' &&
          request.target.kind === 'entity' &&
          request.target.entityId === context.actor.entityId);
      if (!authorized)
        return Object.freeze({
          ok: false as const,
          code: 'BEHAVIOR_OPERATION_UNDECLARED',
          message: 'Behavior provider did not declare this operation and target scope.',
        });
      if (
        request.target.kind === 'entity' &&
        request.target.entityId !== context.actor.entityId &&
        provider.identity.moduleId !== standardProviderModuleId &&
        !permittedTargets.has(request.target.entityId)
      )
        return Object.freeze({
          ok: false as const,
          code: 'BEHAVIOR_TARGET_UNRESOLVED',
          message: 'Behavior target is not a current authorized reference.',
        });
      return context.invoke(origin, request);
    },
    ...(provider.identity.moduleId === standardProviderModuleId ? { __standard: context.standard } : {}),
  });
}

export function validateBehaviorProviderState(
  provider: RegisteredBehaviorProvider,
  state: unknown,
): asserts state is BehaviorJson {
  if (provider.definition.kind !== 'skill') throw new TypeError('Behavior condition has no restorable state.');
  assertBehaviorJson(state, 'Behavior state');
  if (behaviorJsonBytes(state) > provider.definition.state.maximumBytes)
    throw new RangeError('Behavior state is too large.');
  if (provider.definition.state.validate?.(state) === false)
    throw new TypeError(`Behavior ${provider.descriptor.id} state is incompatible.`);
}

export function normalizeBehaviorProviderResult(
  provider: RegisteredBehaviorProvider,
  raw: BehaviorSkillProviderResult,
): BehaviorSkillProviderResult {
  if (!behaviorObject(raw) || !['running', 'succeeded', 'failed', 'cancelled'].includes(String(raw.status)))
    throw new TypeError(`Behavior ${provider.descriptor.id} returned an invalid result.`);
  if ('phase' in raw && (typeof raw.phase !== 'string' || !raw.phase || raw.phase.length > 128))
    throw new TypeError(`Behavior ${provider.descriptor.id} returned an invalid phase.`);
  if (raw.status === 'failed' && (typeof raw.reason !== 'string' || !raw.reason || raw.reason.length > 512))
    throw new TypeError(`Behavior ${provider.descriptor.id} returned an invalid failure.`);
  if (raw.status === 'running') validateBehaviorProviderState(provider, raw.state);
  else if (raw.status === 'succeeded' && raw.result !== undefined) {
    assertBehaviorJson(raw.result, 'Behavior result');
    if (behaviorJsonBytes(raw.result) > BEHAVIOR_MAX_CAPABILITY_STATE_BYTES)
      throw new RangeError('Behavior result is too large.');
  }
  return frozenBehaviorValue(raw);
}
