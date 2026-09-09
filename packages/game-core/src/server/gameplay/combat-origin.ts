import { validateDurableExecutionOrigin, type DurableExecutionOriginV1 } from '../composition/execution-origin';
import type { EntityLifetimeReference } from '../simulation/action-identity';
import type { MeleeDefinition } from './melee-definition-registry';
import {
  assertCombatResultCapacity,
  decodeBoundCombatSnapshot,
  validateCombatSnapshot,
  validateOriginCombatEntries,
  type CombatRuntimeSnapshot,
  type RestoredCombatantState,
} from './combat-runtime-snapshot';
import type { CombatLifecycleEvent, CombatResultSnapshot } from './combat-runtime';

const MAX_REASON_LENGTH = 256;

export type CombatOriginCheckpoint = Readonly<{
  stage: 'request' | 'restore' | 'hit';
  actorId: string;
  targetId: string;
  definitionId: string;
  comboStep: number;
}>;

export type CombatOriginValidationResult = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

export type CombatOriginValidationPort = Readonly<{
  validate(origin: DurableExecutionOriginV1, checkpoint: CombatOriginCheckpoint): CombatOriginValidationResult;
}>;

export type CombatOriginRuntimeOptions = Readonly<{
  requireOrigin?: boolean;
  validationPort?: CombatOriginValidationPort;
}>;

export type ValidatedCombatOrigin = Readonly<{
  origin: DurableExecutionOriginV1 | null;
  failure: string | null;
}>;

export type OriginCombatActiveState = {
  actionId: string;
  definitionId: string;
  targetId: string;
  comboStep: number;
  phase: NonNullable<RestoredCombatantState['active']>['phase'];
  phaseElapsedSeconds: number;
  bufferedTargetId: string | null;
  targetIdentity: EntityLifetimeReference | null;
  bufferedTargetIdentity: EntityLifetimeReference | null;
  origin: DurableExecutionOriginV1 | null;
  bufferedOrigin: DurableExecutionOriginV1 | null;
};

export type OriginCombatantState = {
  active: OriginCombatActiveState | null;
  lastResult: CombatResultSnapshot | null;
  lockoutSeconds: number;
  actorIdentity: EntityLifetimeReference | null;
};

export type PreparedCombatRestore = Readonly<{
  combatants: ReadonlyMap<string, OriginCombatantState>;
  resultSequence: number;
  events: readonly CombatLifecycleEvent[];
}>;

type PrepareCombatRestoreOptions = Readonly<{
  identity?: import('../simulation/action-identity').EntityIdentityPort;
  requireOrigin: boolean;
  validationPort?: CombatOriginValidationPort;
  definitionFor(definitionId: string): MeleeDefinition;
}>;

const failureReason = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_REASON_LENGTH) return 'origin-validation-failed';
  return value;
};

export function validateCombatOriginBinding(
  raw: unknown,
  actorId: string,
  actorIdentity: EntityLifetimeReference,
): DurableExecutionOriginV1 {
  const origin = validateDurableExecutionOrigin(raw);
  if (origin.originalActor.entityId !== actorId) throw new TypeError('Combat origin actor does not match the request.');
  if (origin.originalActor.lifetime !== actorIdentity.lifetime)
    throw new TypeError('Combat origin actor lifetime does not match the current binding.');
  return origin;
}

export function validateCombatOriginPolicy(
  port: CombatOriginValidationPort,
  origin: DurableExecutionOriginV1,
  checkpoint: CombatOriginCheckpoint,
): string | null {
  try {
    const result = port.validate(origin, Object.freeze({ ...checkpoint }));
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return 'origin-validation-failed';
    return result.ok ? null : failureReason(result.reason);
  } catch {
    return 'origin-validation-failed';
  }
}

export function acceptCombatOrigin(
  raw: DurableExecutionOriginV1 | undefined,
  actorIdentity: EntityLifetimeReference | null,
  requireOrigin: boolean,
  port: CombatOriginValidationPort | undefined,
  checkpoint: Omit<CombatOriginCheckpoint, 'stage'>,
): ValidatedCombatOrigin {
  if (!raw) return requireOrigin ? { origin: null, failure: 'origin-required' } : { origin: null, failure: null };
  if (!port || !actorIdentity) return { origin: null, failure: 'origin-validation-unavailable' };
  const origin = validateCombatOriginBinding(raw, checkpoint.actorId, actorIdentity);
  const failure = validateCombatOriginPolicy(port, origin, { ...checkpoint, stage: 'request' });
  return { origin, failure };
}

export function combatOriginHitFailure(
  origin: DurableExecutionOriginV1 | null,
  actorIdentity: EntityLifetimeReference | null,
  requireOrigin: boolean,
  port: CombatOriginValidationPort | undefined,
  checkpoint: Omit<CombatOriginCheckpoint, 'stage'>,
): string | null {
  if (!origin) return requireOrigin ? 'origin-required' : null;
  if (!actorIdentity) return 'origin-validation-unavailable';
  try {
    validateCombatOriginBinding(origin, checkpoint.actorId, actorIdentity);
  } catch {
    return 'origin-actor-binding-mismatch';
  }
  if (!port) return 'origin-validation-unavailable';
  return validateCombatOriginPolicy(port, origin, { ...checkpoint, stage: 'hit' });
}

const round = (value: number) => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;

const remainingSeconds = (active: OriginCombatActiveState, definition: MeleeDefinition): number => {
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

const withOrigins = (
  decoded: ReadonlyMap<string, RestoredCombatantState>,
  origins: ReadonlyMap<
    string,
    Readonly<{ origin: DurableExecutionOriginV1; bufferedOrigin: DurableExecutionOriginV1 | null }>
  > = new Map(),
): Map<string, OriginCombatantState> => {
  const restored = new Map<string, OriginCombatantState>();
  for (const [actorId, state] of decoded) {
    const savedOrigins = origins.get(actorId);
    restored.set(actorId, {
      ...state,
      active: state.active
        ? {
            ...state.active,
            origin: savedOrigins?.origin ?? null,
            bufferedOrigin: savedOrigins?.bufferedOrigin ?? null,
          }
        : null,
    });
  }
  return restored;
};

const cancelCandidate = (
  actorId: string,
  state: OriginCombatantState,
  reason: string,
  resultSequence: number,
  events: CombatLifecycleEvent[],
  definitionFor: (definitionId: string) => MeleeDefinition,
): number => {
  const active = state.active;
  if (!active) return resultSequence;
  assertCombatResultCapacity(resultSequence, 1);
  state.lockoutSeconds = Math.max(state.lockoutSeconds, remainingSeconds(active, definitionFor(active.definitionId)));
  const result: CombatResultSnapshot = {
    sequence: resultSequence + 1,
    actionId: active.actionId,
    definitionId: active.definitionId,
    targetId: active.targetId,
    comboStep: active.comboStep,
    outcome: 'cancelled',
    damage: 0,
    reason,
  };
  state.lastResult = result;
  state.active = null;
  events.push({ actorId, actionId: active.actionId, status: 'cancelled', result: { ...result } });
  return result.sequence;
};

const prepareLegacyRestore = (
  snapshot: Extract<CombatRuntimeSnapshot, { version: 1 }>,
  options: PrepareCombatRestoreOptions,
): PreparedCombatRestore => {
  const restored = new Map<string, OriginCombatantState>();
  for (const entry of snapshot.combatants) {
    if (!entry?.actorId?.trim() || restored.has(entry.actorId))
      throw new TypeError('Combat actor is invalid or duplicated.');
    validateCombatSnapshot(entry.combat, snapshot.resultSequence, options.definitionFor);
    restored.set(entry.actorId, {
      active: entry.combat.active
        ? {
            ...entry.combat.active,
            bufferedTargetId: null,
            targetIdentity: null,
            bufferedTargetIdentity: null,
            origin: null,
            bufferedOrigin: null,
          }
        : null,
      lastResult: entry.combat.lastResult ? { ...entry.combat.lastResult } : null,
      lockoutSeconds: entry.combat.cooldownRemainingSeconds,
      actorIdentity: null,
    });
  }
  assertCombatResultCapacity(snapshot.resultSequence, [...restored.values()].filter((state) => state.active).length);
  let resultSequence = snapshot.resultSequence;
  const events: CombatLifecycleEvent[] = [];
  for (const [actorId, state] of restored)
    if (state.active)
      resultSequence = cancelCandidate(
        actorId,
        state,
        options.requireOrigin ? 'restore-origin-missing' : 'restore-cancelled',
        resultSequence,
        events,
        options.definitionFor,
      );
  return { combatants: restored, resultSequence, events };
};

const validateRestoredOrigins = (
  restored: Map<string, OriginCombatantState>,
  origins: ReadonlyMap<
    string,
    Readonly<{ origin: DurableExecutionOriginV1; bufferedOrigin: DurableExecutionOriginV1 | null }>
  >,
  resultSequence: number,
  events: CombatLifecycleEvent[],
  options: PrepareCombatRestoreOptions,
): number => {
  const port = options.validationPort!;
  const failures = new Map<string, string>();
  for (const [actorId, savedOrigins] of origins) {
    const state = restored.get(actorId);
    if (!state?.actorIdentity) throw new TypeError('Active combat origin actor binding is missing.');
    validateCombatOriginBinding(savedOrigins.origin, actorId, state.actorIdentity);
    if (savedOrigins.bufferedOrigin)
      validateCombatOriginBinding(savedOrigins.bufferedOrigin, actorId, state.actorIdentity);
    const active = state.active;
    if (!active) continue;
    if (!active.origin) throw new TypeError('Active combat origin binding is missing.');
    if (active.phase === 'windup') {
      const failure = validateCombatOriginPolicy(port, active.origin, {
        stage: 'restore',
        actorId,
        targetId: active.targetId,
        definitionId: active.definitionId,
        comboStep: active.comboStep,
      });
      if (failure) failures.set(actorId, failure);
    }
    if (active.bufferedTargetId && active.bufferedOrigin) {
      const failure = validateCombatOriginPolicy(port, active.bufferedOrigin, {
        stage: 'restore',
        actorId,
        targetId: active.bufferedTargetId,
        definitionId: active.definitionId,
        comboStep: active.comboStep + 1,
      });
      if (failure) failures.set(actorId, failure);
    }
  }
  assertCombatResultCapacity(resultSequence, failures.size);
  for (const [actorId, failure] of failures)
    resultSequence = cancelCandidate(
      actorId,
      restored.get(actorId)!,
      failure,
      resultSequence,
      events,
      options.definitionFor,
    );
  return resultSequence;
};

export function prepareCombatRestore(
  snapshot: CombatRuntimeSnapshot,
  options: PrepareCombatRestoreOptions,
): PreparedCombatRestore {
  if (snapshot.version === 1) return prepareLegacyRestore(snapshot, options);
  if (!options.identity)
    throw new TypeError(`Combat snapshot version ${snapshot.version} requires an entity identity port.`);
  const origins = snapshot.version === 3 ? validateOriginCombatEntries(snapshot) : undefined;
  if (snapshot.version === 3 && !options.validationPort)
    throw new TypeError('Combat snapshot version 3 requires an origin validation port.');
  const decoded = decodeBoundCombatSnapshot(snapshot, {
    identity: options.identity,
    definitionFor: options.definitionFor,
  });
  const restored = withOrigins(decoded.combatants, origins);
  let resultSequence = decoded.resultSequence;
  const events = [...decoded.events];
  if (snapshot.version === 2 && options.requireOrigin) {
    assertCombatResultCapacity(resultSequence, [...restored.values()].filter((state) => state.active).length);
    for (const [actorId, state] of restored)
      if (state.active)
        resultSequence = cancelCandidate(
          actorId,
          state,
          'restore-origin-missing',
          resultSequence,
          events,
          options.definitionFor,
        );
  } else if (snapshot.version === 3) {
    resultSequence = validateRestoredOrigins(restored, origins!, resultSequence, events, options);
  }
  return { combatants: restored, resultSequence, events };
}
