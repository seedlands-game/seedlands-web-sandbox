import { validateDurableExecutionOrigin, type DurableExecutionOriginV1 } from '../composition/execution-origin';
import {
  entityReferenceExecutionFailure,
  type EntityIdentityPort,
  type EntityLifetimeReference,
} from '../simulation/action-identity';
import {
  combatOriginHitFailure,
  prepareCombatRestore,
  type CombatOriginRuntimeOptions,
  type CombatOriginValidationPort,
} from './combat-origin';
import {
  createCombatPendingHit,
  MAX_COMBAT_FRONTIER_ENTRIES,
  MAX_COMBAT_MUTATION_IDS,
  MAX_COMBAT_PENDING_HITS,
  validateCombatPendingHit,
  validateCombatPendingHitResolution,
  type CombatPendingHit,
  type CombatPendingHitResolution,
} from './combat-pending-hit';
import {
  assertCombatResultCapacity,
  validateCombatAllocator,
  validatePendingCombatEntries,
  type CombatRuntimeSnapshot,
} from './combat-runtime-snapshot';
import type {
  ActiveCombatSnapshot,
  CombatLifecycleEvent,
  CombatPhase,
  CombatResultSnapshot,
  CombatRuntimeCallbacks,
  MeleeDefinition,
} from './combat-runtime';

export type PreparedCombatActiveState = {
  actionId: string;
  definitionId: string;
  targetId: string;
  comboStep: number;
  phase: CombatPhase;
  phaseElapsedSeconds: number;
  bufferedTargetId: string | null;
  targetIdentity: EntityLifetimeReference | null;
  bufferedTargetIdentity: EntityLifetimeReference | null;
  origin: DurableExecutionOriginV1 | null;
  bufferedOrigin: DurableExecutionOriginV1 | null;
};

export type PreparedCombatantState = {
  active: PreparedCombatActiveState | null;
  lastResult: CombatResultSnapshot | null;
  lockoutSeconds: number;
  actorIdentity: EntityLifetimeReference | null;
  pendingHit: CombatPendingHit | null;
};

export type PreparedCombatFrontier = {
  combatants: Map<string, PreparedCombatantState>;
  actionSequence: number;
  resultSequence: number;
  lifecycleEvents: CombatLifecycleEvent[];
};

export type PreparedCombatMutationInput = Readonly<{
  advanceSeconds?: number;
  resolveHit?: CombatPendingHitResolution;
  cancelActorIds?: readonly string[];
  cancelTargetIds?: readonly string[];
  exceptActorId?: string;
  actorCancellationReason?: string;
  targetCancellationReason?: string;
}>;

export type PreparedCombatMutation = Readonly<{
  pendingHits: readonly CombatPendingHit[];
  lifecycleEvents: readonly CombatLifecycleEvent[];
  validate(): void;
  apply(): void;
}>;

export type PreparedCombatHost = Readonly<{
  callbacks: CombatRuntimeCallbacks;
  identity?: EntityIdentityPort;
  requireOrigin: boolean;
  validationPort?: CombatOriginValidationPort;
  capture(): PreparedCombatFrontier;
  signature(): string;
  install(frontier: PreparedCombatFrontier): void;
  definitionFor(id: string): MeleeDefinition;
}>;

const round = (value: number) => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
const cloneReference = (value: EntityLifetimeReference | null) => (value ? { ...value } : null);
const cloneResult = (value: CombatResultSnapshot | null): CombatResultSnapshot | null => (value ? { ...value } : null);
const cloneEvent = (value: CombatLifecycleEvent): CombatLifecycleEvent => ({
  ...value,
  result: cloneResult(value.result),
});

export const cloneCombatLifecycleEvents = (values: readonly CombatLifecycleEvent[]): CombatLifecycleEvent[] =>
  values.map(cloneEvent);

export const listCombatPendingHits = (states: Iterable<PreparedCombatantState>): readonly CombatPendingHit[] =>
  Object.freeze([...states].flatMap((state) => (state.pendingHit ? [validateCombatPendingHit(state.pendingHit)] : [])));
const cloneActive = (value: PreparedCombatActiveState | null): PreparedCombatActiveState | null =>
  value
    ? {
        ...value,
        targetIdentity: cloneReference(value.targetIdentity),
        bufferedTargetIdentity: cloneReference(value.bufferedTargetIdentity),
        origin: value.origin ? validateDurableExecutionOrigin(value.origin) : null,
        bufferedOrigin: value.bufferedOrigin ? validateDurableExecutionOrigin(value.bufferedOrigin) : null,
      }
    : null;

export function clonePreparedCombatState(value: PreparedCombatantState): PreparedCombatantState {
  return {
    active: cloneActive(value.active),
    lastResult: cloneResult(value.lastResult),
    lockoutSeconds: value.lockoutSeconds,
    actorIdentity: cloneReference(value.actorIdentity),
    pendingHit: value.pendingHit ? validateCombatPendingHit(value.pendingHit) : null,
  };
}

export function clonePreparedCombatFrontier(value: PreparedCombatFrontier): PreparedCombatFrontier {
  if (value.combatants.size > MAX_COMBAT_FRONTIER_ENTRIES) throw new RangeError('Combat frontier limit exceeded.');
  return {
    combatants: new Map([...value.combatants].map(([actorId, state]) => [actorId, clonePreparedCombatState(state)])),
    actionSequence: value.actionSequence,
    resultSequence: value.resultSequence,
    lifecycleEvents: value.lifecycleEvents.map(cloneEvent),
  };
}

export function capturePreparedCombatFrontier(
  combatants: Iterable<readonly [string, PreparedCombatantState]>,
  actionSequence: number,
  resultSequence: number,
  lifecycleEvents: readonly CombatLifecycleEvent[],
): PreparedCombatFrontier {
  return {
    combatants: new Map([...combatants].map(([actorId, state]) => [actorId, clonePreparedCombatState(state)])),
    actionSequence,
    resultSequence,
    lifecycleEvents: cloneCombatLifecycleEvents(lifecycleEvents),
  };
}

export const combatPhaseDuration = (active: PreparedCombatActiveState, definition: MeleeDefinition): number => {
  const step = definition.steps[active.comboStep];
  if (active.phase === 'windup') return step.windupSeconds;
  if (active.phase === 'hit') return step.hitSeconds;
  return step.recoverySeconds;
};

export const combatRemainingSeconds = (active: PreparedCombatActiveState, definition: MeleeDefinition): number => {
  const current = definition.steps[active.comboStep];
  const currentRemaining =
    active.phase === 'windup'
      ? current.windupSeconds - active.phaseElapsedSeconds + current.hitSeconds + current.recoverySeconds
      : active.phase === 'hit'
        ? current.hitSeconds - active.phaseElapsedSeconds + current.recoverySeconds
        : current.recoverySeconds - active.phaseElapsedSeconds;
  if (!active.bufferedTargetId) return round(currentRemaining);
  const next = definition.steps[active.comboStep + 1];
  return round(currentRemaining + next.windupSeconds + next.hitSeconds + next.recoverySeconds);
};

export const combatCanBuffer = (active: PreparedCombatActiveState, definition: MeleeDefinition): boolean =>
  active.comboStep + 1 < definition.steps.length && (active.phase === 'hit' || active.phase === 'recovery');

export const projectCombatActive = (
  active: PreparedCombatActiveState,
  definition: MeleeDefinition,
): ActiveCombatSnapshot => ({
  actionId: active.actionId,
  definitionId: active.definitionId,
  targetId: active.targetId,
  comboStep: active.comboStep,
  comboLength: definition.steps.length,
  phase: active.phase,
  phaseElapsedSeconds: active.phaseElapsedSeconds,
  phaseDurationSeconds: combatPhaseDuration(active, definition),
  canBuffer: combatCanBuffer(active, definition),
  buffered: active.bufferedTargetId !== null,
});

const cancel = (
  actorId: string,
  state: PreparedCombatantState | undefined,
  reason: string,
  frontier: PreparedCombatFrontier,
  definitionFor: PreparedCombatHost['definitionFor'],
): void => {
  const active = state?.active;
  if (!active) return;
  assertCombatResultCapacity(frontier.resultSequence, 1);
  state.lockoutSeconds = Math.max(
    state.lockoutSeconds,
    combatRemainingSeconds(active, definitionFor(active.definitionId)),
  );
  state.lastResult = {
    sequence: ++frontier.resultSequence,
    actionId: active.actionId,
    definitionId: active.definitionId,
    targetId: active.targetId,
    comboStep: active.comboStep,
    outcome: 'cancelled',
    damage: 0,
    reason,
  };
  state.pendingHit = null;
  state.active = null;
  frontier.lifecycleEvents.push({
    actorId,
    actionId: active.actionId,
    status: 'cancelled',
    result: cloneResult(state.lastResult),
  });
};

const enterPreparedHit = (
  actorId: string,
  state: PreparedCombatantState,
  definition: MeleeDefinition,
  remaining: number,
  frontier: PreparedCombatFrontier,
  host: PreparedCombatHost,
): boolean => {
  const active = state.active!;
  const actorFailure = entityReferenceExecutionFailure(host.identity, state.actorIdentity, actorId, 'actor');
  if (actorFailure) {
    cancel(actorId, state, actorFailure, frontier, host.definitionFor);
    return false;
  }
  const targetFailure = entityReferenceExecutionFailure(
    host.identity,
    active.targetIdentity,
    active.targetId,
    'target',
  );
  if (targetFailure) {
    cancel(actorId, state, targetFailure, frontier, host.definitionFor);
    return false;
  }
  const originFailure = combatOriginHitFailure(
    active.origin,
    state.actorIdentity,
    host.requireOrigin,
    host.validationPort,
    { actorId, targetId: active.targetId, definitionId: active.definitionId, comboStep: active.comboStep },
  );
  if (originFailure) {
    cancel(actorId, state, originFailure, frontier, host.definitionFor);
    return false;
  }
  const availability = !host.callbacks.actorAvailable(actorId)
    ? 'attacker-dead'
    : !host.callbacks.targetAvailable(active.targetId)
      ? 'target-missing'
      : null;
  if (availability) {
    cancel(actorId, state, availability, frontier, host.definitionFor);
    return false;
  }
  const reason = host.callbacks.validateHit(actorId, active.targetId, definition);
  const step = definition.steps[active.comboStep];
  if (reason) {
    assertCombatResultCapacity(frontier.resultSequence, 1);
    active.phase = 'hit';
    active.phaseElapsedSeconds = 0;
    state.lastResult = {
      sequence: ++frontier.resultSequence,
      actionId: active.actionId,
      definitionId: active.definitionId,
      targetId: active.targetId,
      comboStep: active.comboStep,
      outcome: 'miss',
      damage: 0,
      reason,
    };
    return true;
  }
  if (!state.actorIdentity || !active.targetIdentity || !active.origin)
    throw new TypeError('Prepared combat hit requires bound actor, target and origin.');
  state.pendingHit = createCombatPendingHit({
    actorId,
    actionId: active.actionId,
    definitionId: active.definitionId,
    targetId: active.targetId,
    comboStep: active.comboStep,
    baseDamage: step.damage,
    remainingSeconds: remaining,
    actorIdentity: state.actorIdentity,
    targetIdentity: active.targetIdentity,
    origin: active.origin,
  });
  return false;
};

export const advancePreparedCombatActor = (
  actorId: string,
  seconds: number,
  frontier: PreparedCombatFrontier,
  host: PreparedCombatHost,
): void => {
  let remaining = seconds;
  let transitions = 0;
  while (remaining >= 0 && transitions++ < 17) {
    const state = frontier.combatants.get(actorId);
    const active = state?.active;
    if (!state) return;
    if (!active) {
      state.lockoutSeconds = round(state.lockoutSeconds - seconds);
      return;
    }
    if (state.pendingHit) return;
    const actorFailure = entityReferenceExecutionFailure(host.identity, state.actorIdentity, actorId, 'actor');
    if (actorFailure) return cancel(actorId, state, actorFailure, frontier, host.definitionFor);
    if (!host.callbacks.actorAvailable(actorId))
      return cancel(actorId, state, 'attacker-dead', frontier, host.definitionFor);
    if (active.phase === 'windup') {
      const targetFailure = entityReferenceExecutionFailure(
        host.identity,
        active.targetIdentity,
        active.targetId,
        'target',
      );
      if (targetFailure) return cancel(actorId, state, targetFailure, frontier, host.definitionFor);
      if (!host.callbacks.targetAvailable(active.targetId))
        return cancel(actorId, state, 'target-missing', frontier, host.definitionFor);
    }
    const definition = host.definitionFor(active.definitionId);
    const duration = combatPhaseDuration(active, definition);
    const untilTransition = round(duration - active.phaseElapsedSeconds);
    if (remaining + Number.EPSILON < untilTransition) {
      active.phaseElapsedSeconds = round(active.phaseElapsedSeconds + remaining);
      return;
    }
    active.phaseElapsedSeconds = duration;
    remaining = round(remaining - untilTransition);
    if (active.phase === 'windup') {
      if (!enterPreparedHit(actorId, state, definition, remaining, frontier, host)) return;
    } else if (active.phase === 'hit') {
      active.phase = 'recovery';
      active.phaseElapsedSeconds = 0;
    } else if (active.bufferedTargetId && active.comboStep + 1 < definition.steps.length) {
      active.comboStep += 1;
      active.targetId = active.bufferedTargetId;
      active.targetIdentity = active.bufferedTargetIdentity;
      active.origin = active.bufferedOrigin;
      active.bufferedTargetId = null;
      active.bufferedTargetIdentity = null;
      active.bufferedOrigin = null;
      active.phase = 'windup';
      active.phaseElapsedSeconds = 0;
    } else {
      state.active = null;
      frontier.lifecycleEvents.push({
        actorId,
        actionId: active.actionId,
        status: 'completed',
        result: cloneResult(state.lastResult),
      });
      return;
    }
  }
  if (transitions >= 17) throw new Error('Combat transition limit exceeded.');
};

const resolvePending = (
  raw: CombatPendingHitResolution,
  frontier: PreparedCombatFrontier,
  host: PreparedCombatHost,
): void => {
  const resolution = validateCombatPendingHitResolution(raw);
  const matches = [...frontier.combatants].filter(([, state]) => state.pendingHit?.token === resolution.token);
  if (matches.length !== 1) throw new TypeError('Combat pending hit token is stale or unknown.');
  const [actorId, state] = matches[0]!;
  const pending = state.pendingHit!;
  const active = state.active;
  if (!active) throw new TypeError('Combat pending hit has no active combat.');
  assertCombatResultCapacity(frontier.resultSequence, 1);
  state.lastResult = {
    sequence: ++frontier.resultSequence,
    actionId: pending.actionId,
    definitionId: pending.definitionId,
    targetId: pending.targetId,
    comboStep: pending.comboStep,
    outcome: resolution.outcome,
    damage: resolution.damage,
    ...(resolution.reason ? { reason: resolution.reason } : {}),
  };
  state.pendingHit = null;
  active.phase = 'hit';
  active.phaseElapsedSeconds = 0;
  advancePreparedCombatActor(actorId, pending.remainingSeconds, frontier, host);
};

const validateIds = (actorIds: readonly string[], targetIds: readonly string[]): void => {
  if (actorIds.length + targetIds.length > MAX_COMBAT_MUTATION_IDS)
    throw new RangeError('Combat mutation ID limit exceeded.');
  const all = [...actorIds.map((id) => `actor:${id}`), ...targetIds.map((id) => `target:${id}`)];
  if (all.some((id) => !id.slice(id.indexOf(':') + 1).trim()) || new Set(all).size !== all.length)
    throw new TypeError('Combat mutation IDs are invalid or duplicated.');
};

const freezePending = (frontier: PreparedCombatFrontier): readonly CombatPendingHit[] => {
  const values = [...frontier.combatants.values()].flatMap((state) => (state.pendingHit ? [state.pendingHit] : []));
  if (values.length > MAX_COMBAT_PENDING_HITS) throw new RangeError('Combat pending hit limit exceeded.');
  return Object.freeze(values.map((value) => validateCombatPendingHit(value)));
};

export function createPreparedCombatPlan(
  host: PreparedCombatHost,
  frontier: PreparedCombatFrontier,
  capturedSignature: string,
): PreparedCombatMutation {
  const pendingHits = freezePending(frontier);
  const lifecycleEvents = Object.freeze(frontier.lifecycleEvents.map((event) => Object.freeze(cloneEvent(event))));
  let used = false;
  const validate = () => {
    if (used) throw new Error('Prepared combat mutation has already been used.');
    if (host.signature() !== capturedSignature) throw new Error('Prepared combat mutation is stale.');
  };
  return Object.freeze({
    pendingHits,
    lifecycleEvents,
    validate,
    apply: () => {
      validate();
      used = true;
      host.install(frontier);
    },
  });
}

export function prepareCombatMutation(
  host: PreparedCombatHost,
  raw: PreparedCombatMutationInput,
): PreparedCombatMutation {
  if (!raw || typeof raw !== 'object') throw new TypeError('Prepared combat mutation input is invalid.');
  const advanceSeconds = raw.advanceSeconds ?? 0;
  if (!Number.isFinite(advanceSeconds) || advanceSeconds < 0)
    throw new TypeError('Combat seconds must be non-negative and finite.');
  const actorIds = [...(raw.cancelActorIds ?? [])];
  const targetIds = [...(raw.cancelTargetIds ?? [])];
  validateIds(actorIds, targetIds);
  const capturedSignature = host.signature();
  const frontier = clonePreparedCombatFrontier(host.capture());
  if (raw.resolveHit) resolvePending(raw.resolveHit, frontier, host);
  for (const actorId of actorIds)
    cancel(
      actorId,
      frontier.combatants.get(actorId)!,
      raw.actorCancellationReason ?? 'attacker-dead',
      frontier,
      host.definitionFor,
    );
  for (const targetId of targetIds)
    for (const [actorId, state] of frontier.combatants)
      if (
        actorId !== raw.exceptActorId &&
        state.active?.targetId === targetId &&
        (state.active.phase === 'windup' || state.pendingHit)
      )
        cancel(actorId, state, raw.targetCancellationReason ?? 'target-missing', frontier, host.definitionFor);
  if (advanceSeconds > 0)
    for (const actorId of frontier.combatants.keys())
      advancePreparedCombatActor(actorId, advanceSeconds, frontier, host);
  return createPreparedCombatPlan(host, frontier, capturedSignature);
}

export function prepareCombatRuntimeRestore(
  raw: unknown,
  options: Readonly<{
    identity?: EntityIdentityPort;
    origin: CombatOriginRuntimeOptions;
    requireOrigin: boolean;
    definitionFor(id: string): MeleeDefinition;
  }>,
) {
  const snapshot = raw as CombatRuntimeSnapshot;
  validateCombatAllocator(snapshot);
  const pending =
    snapshot.version === 3
      ? validatePendingCombatEntries(snapshot, options.definitionFor)
      : new Map<string, CombatPendingHit>();
  const restored = prepareCombatRestore(snapshot, {
    identity: options.identity,
    requireOrigin: options.requireOrigin,
    validationPort: options.origin.validationPort,
    definitionFor: options.definitionFor,
  });
  const combatants = new Map<string, PreparedCombatantState>();
  restored.combatants.forEach((state, actorId) => {
    const savedPending = pending.get(actorId);
    combatants.set(actorId, {
      ...state,
      pendingHit:
        savedPending && state.active && state.actorIdentity && state.active.targetIdentity && state.active.origin
          ? validateCombatPendingHit({
              ...savedPending,
              actorIdentity: state.actorIdentity,
              targetIdentity: state.active.targetIdentity,
              origin: state.active.origin,
            })
          : null,
    });
  });
  return {
    actionSequence: snapshot.actionSequence,
    resultSequence: restored.resultSequence,
    combatants,
    lifecycleEvents: restored.events,
  };
}
