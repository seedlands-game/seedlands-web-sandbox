import type { DurableExecutionOriginV1 } from '../composition/execution-origin';
import { acceptCombatOrigin } from './combat-origin';
import type { CombatPendingHit } from './combat-pending-hit';
import {
  advancePreparedCombatActor,
  clonePreparedCombatFrontier,
  combatCanBuffer,
  createPreparedCombatPlan,
  type PreparedCombatHost,
  type PreparedCombatMutation,
} from './prepared-combat-mutation';
import { combatPendingResultBound } from './combat-runtime-snapshot';
import type { CombatLifecycleEvent, CombatRequestResult, MeleeDefinition } from './combat-runtime';

const MAX_ACTION_ID_LENGTH = 256;

export function acknowledgeCombatLifecycleEvents(events: CombatLifecycleEvent[], count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > events.length)
    throw new RangeError('Combat lifecycle acknowledgement count is invalid.');
  events.splice(0, count);
}

export const combatFrontierSignature = (
  combatants: Iterable<readonly [string, import('./prepared-combat-mutation').PreparedCombatantState]>,
  actionSequence: number,
  resultSequence: number,
  lifecycleEvents: readonly CombatLifecycleEvent[],
): string => JSON.stringify({ actionSequence, resultSequence, combatants: [...combatants], lifecycleEvents });

export type PreparedCombatRequestInput = Readonly<{
  actorId: string;
  targetId: string;
  definitionId: string;
  origin: DurableExecutionOriginV1;
  actionId?: string;
}>;

export type PreparedCombatRequestAccepted = Readonly<{
  success: true;
  result: Extract<CombatRequestResult, { success: true }>;
  pendingHits: readonly CombatPendingHit[];
  lifecycleEvents: readonly CombatLifecycleEvent[];
  validate(): void;
  apply(): void;
}>;

export type PreparedCombatRequestResult = Readonly<{ success: false; reason: string }> | PreparedCombatRequestAccepted;

const rejection = (reason: string): PreparedCombatRequestResult => Object.freeze({ success: false, reason });

const validExternalActionId = (value: string): boolean =>
  value.length > 0 && value.length <= MAX_ACTION_ID_LENGTH && value.trim() === value && !/^combat-\d+$/.test(value);

const findDefinition = (host: PreparedCombatHost, definitionId: string): MeleeDefinition | null => {
  try {
    return host.definitionFor(definitionId);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
};

export function prepareCombatRequest(
  host: PreparedCombatHost,
  input: PreparedCombatRequestInput,
): PreparedCombatRequestResult {
  if (!input || typeof input !== 'object') throw new TypeError('Prepared combat request input is invalid.');
  const { actorId, targetId, definitionId } = input;
  if (typeof actorId !== 'string' || typeof targetId !== 'string' || !actorId.trim() || !targetId.trim())
    return rejection('invalid-target');
  if (typeof definitionId !== 'string') return rejection('invalid-definition');
  const definition = findDefinition(host, definitionId);
  if (!definition) return rejection('invalid-definition');
  const capturedSignature = host.signature();
  const frontier = clonePreparedCombatFrontier(host.capture());
  if (
    frontier.resultSequence >
    Number.MAX_SAFE_INTEGER -
      combatPendingResultBound(frontier.combatants.values(), host.definitionFor) -
      definition.steps.length -
      1
  )
    return rejection('result-sequence-exhausted');
  if (!host.callbacks.actorAvailable(actorId)) return rejection('invalid-attacker');
  if (!host.callbacks.targetAvailable(targetId)) return rejection('invalid-target');
  const actorIdentity = host.identity?.referenceFor(actorId) ?? null;
  const targetIdentity = host.identity?.referenceFor(targetId) ?? null;
  if (!actorIdentity) return rejection('invalid-attacker');
  if (!targetIdentity) return rejection('invalid-target');
  const state = frontier.combatants.get(actorId);
  const active = state?.active ?? null;
  if (active) {
    if (active.bufferedTargetId) return rejection('buffer-full');
    if (active.definitionId !== definitionId || active.comboStep + 1 >= definition.steps.length)
      return rejection('cooldown');
    if (!combatCanBuffer(active, definition)) return rejection('combo-window-closed');
    if (input.actionId !== undefined && input.actionId !== active.actionId) return rejection('invalid-action-id');
    const accepted = acceptCombatOrigin(input.origin, actorIdentity, true, host.validationPort, {
      actorId,
      targetId,
      definitionId,
      comboStep: active.comboStep + 1,
    });
    if (accepted.failure) return rejection(accepted.failure);
    const validation = host.callbacks.validateHit(actorId, targetId, definition);
    if (validation) return rejection(validation);
    active.bufferedTargetId = targetId;
    active.bufferedTargetIdentity = { ...targetIdentity };
    active.bufferedOrigin = accepted.origin;
    return acceptedPlan(host, frontier, capturedSignature, active.actionId, true);
  }
  if (state && state.lockoutSeconds > 0) return rejection('cooldown');
  const accepted = acceptCombatOrigin(input.origin, actorIdentity, true, host.validationPort, {
    actorId,
    targetId,
    definitionId,
    comboStep: 0,
  });
  if (accepted.failure) return rejection(accepted.failure);
  const validation = host.callbacks.validateHit(actorId, targetId, definition);
  if (validation) return rejection(validation);
  if (input.actionId !== undefined && !validExternalActionId(input.actionId)) return rejection('invalid-action-id');
  if (
    input.actionId !== undefined &&
    [...frontier.combatants.values()].some(
      (value) => value.active?.actionId === input.actionId || value.lastResult?.actionId === input.actionId,
    )
  )
    return rejection('action-id-in-use');
  if (input.actionId === undefined && frontier.actionSequence >= Number.MAX_SAFE_INTEGER)
    return rejection('action-sequence-exhausted');
  const actionId = input.actionId ?? `combat-${++frontier.actionSequence}`;
  const next = state ?? { active: null, lastResult: null, lockoutSeconds: 0, actorIdentity: null, pendingHit: null };
  next.actorIdentity = { ...actorIdentity };
  next.active = {
    actionId,
    definitionId,
    targetId,
    comboStep: 0,
    phase: 'windup',
    phaseElapsedSeconds: 0,
    bufferedTargetId: null,
    targetIdentity: { ...targetIdentity },
    bufferedTargetIdentity: null,
    origin: accepted.origin,
    bufferedOrigin: null,
  };
  frontier.combatants.set(actorId, next);
  if (definition.steps[0].windupSeconds === 0) advancePreparedCombatActor(actorId, 0, frontier, host);
  return acceptedPlan(host, frontier, capturedSignature, actionId, false);
}

const acceptedPlan = (
  host: PreparedCombatHost,
  frontier: ReturnType<PreparedCombatHost['capture']>,
  signature: string,
  actionId: string,
  buffered: boolean,
): PreparedCombatRequestAccepted => {
  const plan: PreparedCombatMutation = createPreparedCombatPlan(host, frontier, signature);
  return Object.freeze({
    success: true,
    result: Object.freeze({ success: true, actionId, buffered }),
    pendingHits: plan.pendingHits,
    lifecycleEvents: plan.lifecycleEvents,
    validate: plan.validate,
    apply: plan.apply,
  });
};
