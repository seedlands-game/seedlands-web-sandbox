import {
  isEntityLifetimeReference,
  rebindEntityLifetimeReference,
  type EntityIdentityPort,
  type EntityLifetimeReference,
} from '../simulation/action-identity';
import { validateDurableExecutionOrigin, type DurableExecutionOriginV1 } from '../composition/execution-origin';
import {
  MAX_COMBAT_FRONTIER_ENTRIES,
  MAX_COMBAT_PENDING_HITS,
  validateCombatPendingHit,
  type CombatPendingHit,
} from './combat-pending-hit';
import type {
  ActiveCombatSnapshot,
  CombatLifecycleEvent,
  CombatResultSnapshot,
  CombatSnapshot,
  MeleeDefinition,
} from './combat-runtime';

export type CombatRuntimeSnapshotV1 = Readonly<{
  version: 1;
  actionSequence: number;
  resultSequence: number;
  combatants: readonly Readonly<{ actorId: string; combat: CombatSnapshot }>[];
}>;

export type BoundActiveCombatSnapshot = ActiveCombatSnapshot &
  Readonly<{
    targetIdentity: EntityLifetimeReference;
    bufferedTargetId: string | null;
    bufferedTargetIdentity: EntityLifetimeReference | null;
  }>;

export type BoundCombatSnapshot = Readonly<{
  active: BoundActiveCombatSnapshot | null;
  cooldownRemainingSeconds: number;
  lastResult: CombatResultSnapshot | null;
}>;

export type CombatRuntimeSnapshotV2 = Readonly<{
  version: 2;
  actionSequence: number;
  resultSequence: number;
  combatants: readonly Readonly<{
    actorId: string;
    actorIdentity: EntityLifetimeReference | null;
    combat: BoundCombatSnapshot;
  }>[];
}>;

export type OriginBoundActiveCombatSnapshot = BoundActiveCombatSnapshot &
  Readonly<{
    origin: DurableExecutionOriginV1;
    bufferedOrigin: DurableExecutionOriginV1 | null;
  }>;

export type OriginBoundCombatSnapshot = Omit<BoundCombatSnapshot, 'active'> &
  Readonly<{
    active: OriginBoundActiveCombatSnapshot | null;
    pendingHit: CombatPendingHit | null;
  }>;

export type CombatRuntimeSnapshotV3 = Readonly<{
  version: 3;
  actionSequence: number;
  resultSequence: number;
  combatants: readonly Readonly<{
    actorId: string;
    actorIdentity: EntityLifetimeReference | null;
    combat: OriginBoundCombatSnapshot;
  }>[];
}>;

export type CombatRuntimeSnapshot = CombatRuntimeSnapshotV1 | CombatRuntimeSnapshotV2 | CombatRuntimeSnapshotV3;

export const emptyCombatRuntimeSnapshot = (): CombatRuntimeSnapshotV1 => ({
  version: 1,
  actionSequence: 0,
  resultSequence: 0,
  combatants: [],
});

export type RestoredActiveCombat = {
  actionId: string;
  definitionId: string;
  targetId: string;
  comboStep: number;
  phase: BoundActiveCombatSnapshot['phase'];
  phaseElapsedSeconds: number;
  bufferedTargetId: string | null;
  targetIdentity: EntityLifetimeReference;
  bufferedTargetIdentity: EntityLifetimeReference | null;
};

export type RestoredCombatantState = {
  active: RestoredActiveCombat | null;
  lastResult: CombatResultSnapshot | null;
  lockoutSeconds: number;
  actorIdentity: EntityLifetimeReference | null;
};

type DecodeOptions = Readonly<{
  identity: EntityIdentityPort;
  definitionFor: (definitionId: string) => MeleeDefinition;
}>;

type DecodeResult = Readonly<{
  combatants: ReadonlyMap<string, RestoredCombatantState>;
  resultSequence: number;
  events: readonly CombatLifecycleEvent[];
}>;

const cloneResult = (value: CombatResultSnapshot | null): CombatResultSnapshot | null => (value ? { ...value } : null);

type SnapshotCombatantState = Readonly<{
  active: Readonly<{
    targetIdentity: EntityLifetimeReference | null;
    bufferedTargetId: string | null;
    bufferedTargetIdentity: EntityLifetimeReference | null;
    origin?: DurableExecutionOriginV1 | null;
    bufferedOrigin?: DurableExecutionOriginV1 | null;
  }> | null;
  actorIdentity: EntityLifetimeReference | null;
  pendingHit?: CombatPendingHit | null;
}>;

const encodeBoundCombatant = (
  actorId: string,
  state: SnapshotCombatantState,
  project: (actorId: string) => CombatSnapshot,
) => {
  const combat = project(actorId);
  const active = state.active;
  if (active && !active.targetIdentity) throw new Error('Active combat target binding is missing.');
  return {
    actorId,
    actorIdentity: state.actorIdentity ? { ...state.actorIdentity } : null,
    combat: {
      ...combat,
      active:
        active && combat.active
          ? {
              ...combat.active,
              targetIdentity: { ...active.targetIdentity! },
              bufferedTargetId: active.bufferedTargetId,
              bufferedTargetIdentity: active.bufferedTargetIdentity ? { ...active.bufferedTargetIdentity } : null,
            }
          : null,
    },
  };
};

export function encodeBoundCombatSnapshot(
  actionSequence: number,
  resultSequence: number,
  combatants: ReadonlyMap<string, SnapshotCombatantState>,
  project: (actorId: string) => CombatSnapshot,
): CombatRuntimeSnapshotV2 {
  return {
    version: 2,
    actionSequence,
    resultSequence,
    combatants: [...combatants.entries()].map(([actorId, state]) => encodeBoundCombatant(actorId, state, project)),
  };
}

export function encodeOriginCombatSnapshot(
  actionSequence: number,
  resultSequence: number,
  combatants: ReadonlyMap<string, SnapshotCombatantState>,
  project: (actorId: string) => CombatSnapshot,
): CombatRuntimeSnapshotV3 {
  return {
    version: 3,
    actionSequence,
    resultSequence,
    combatants: [...combatants.entries()].map<CombatRuntimeSnapshotV3['combatants'][number]>(([actorId, state]) => {
      const entry = encodeBoundCombatant(actorId, state, project);
      if (!entry.combat.active) {
        if (state.pendingHit) throw new Error('Terminal combat cannot retain a pending hit.');
        return { ...entry, combat: { ...entry.combat, active: null, pendingHit: null } };
      }
      if (!state.active?.origin) throw new Error('Active combat durable origin is missing.');
      const origin = validateDurableExecutionOrigin(state.active.origin);
      const hasBuffered = entry.combat.active.bufferedTargetId !== null;
      if (hasBuffered !== Boolean(state.active.bufferedOrigin))
        throw new Error('Active combat buffered durable origin is missing or unexpected.');
      return {
        ...entry,
        combat: {
          ...entry.combat,
          pendingHit: state.pendingHit ? validateCombatPendingHit(state.pendingHit) : null,
          active: {
            ...entry.combat.active,
            origin,
            bufferedOrigin: state.active.bufferedOrigin
              ? validateDurableExecutionOrigin(state.active.bufferedOrigin)
              : null,
          },
        },
      };
    }),
  };
}

export function encodeCombatRuntimeSnapshot(
  actionSequence: number,
  resultSequence: number,
  combatants: ReadonlyMap<string, SnapshotCombatantState>,
  project: (actorId: string) => CombatSnapshot,
  bound: boolean,
  requireOrigin: boolean,
): CombatRuntimeSnapshot {
  if (requireOrigin || [...combatants.values()].some((state) => state.active?.origin))
    return encodeOriginCombatSnapshot(actionSequence, resultSequence, combatants, project);
  if (bound) return encodeBoundCombatSnapshot(actionSequence, resultSequence, combatants, project);
  return {
    version: 1,
    actionSequence,
    resultSequence,
    combatants: [...combatants.keys()].map((actorId) => ({ actorId, combat: project(actorId) })),
  };
}

const sameReference = (left: EntityLifetimeReference, right: EntityLifetimeReference): boolean =>
  left.entityId === right.entityId && left.epoch === right.epoch && left.lifetime === right.lifetime;

export function validatePendingCombatEntries(
  snapshot: CombatRuntimeSnapshotV3,
  definitionFor: (definitionId: string) => MeleeDefinition,
): ReadonlyMap<string, CombatPendingHit> {
  if (snapshot.combatants.length > MAX_COMBAT_FRONTIER_ENTRIES) throw new RangeError('Combat frontier limit exceeded.');
  const origins = validateOriginCombatEntries(snapshot);
  const pending = new Map<string, CombatPendingHit>();
  for (const entry of snapshot.combatants) {
    const descriptor = Object.getOwnPropertyDescriptor(entry.combat, 'pendingHit');
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new TypeError('Combat pending hit descriptor is invalid.');
    if (descriptor.value === null) continue;
    const value = validateCombatPendingHit(descriptor.value);
    const active = entry.combat.active;
    const origin = origins.get(entry.actorId)?.origin;
    const definition = active ? definitionFor(active.definitionId) : null;
    if (
      !active ||
      !entry.actorIdentity ||
      active.phase !== 'windup' ||
      active.phaseElapsedSeconds !== active.phaseDurationSeconds ||
      value.actorId !== entry.actorId ||
      value.actionId !== active.actionId ||
      value.definitionId !== active.definitionId ||
      value.targetId !== active.targetId ||
      value.comboStep !== active.comboStep ||
      value.baseDamage !== definition?.steps[active.comboStep]?.damage ||
      !sameReference(value.actorIdentity, entry.actorIdentity) ||
      !sameReference(value.targetIdentity, active.targetIdentity) ||
      !origin ||
      JSON.stringify(value.origin) !== JSON.stringify(origin) ||
      (entry.combat.lastResult?.actionId === active.actionId && entry.combat.lastResult.comboStep === active.comboStep)
    )
      throw new TypeError('Combat pending hit does not match its active frontier.');
    pending.set(entry.actorId, value);
  }
  if (pending.size > MAX_COMBAT_PENDING_HITS) throw new RangeError('Combat pending hit limit exceeded.');
  return pending;
}

export function validateOriginCombatEntries(
  snapshot: CombatRuntimeSnapshotV3,
): ReadonlyMap<
  string,
  Readonly<{ origin: DurableExecutionOriginV1; bufferedOrigin: DurableExecutionOriginV1 | null }>
> {
  const origins = new Map<
    string,
    Readonly<{ origin: DurableExecutionOriginV1; bufferedOrigin: DurableExecutionOriginV1 | null }>
  >();
  for (const entry of snapshot.combatants) {
    const active = entry?.combat?.active;
    if (!active) continue;
    const originDescriptor = Object.getOwnPropertyDescriptor(active, 'origin');
    const bufferedOriginDescriptor = Object.getOwnPropertyDescriptor(active, 'bufferedOrigin');
    if (
      !originDescriptor?.enumerable ||
      !('value' in originDescriptor) ||
      !bufferedOriginDescriptor?.enumerable ||
      !('value' in bufferedOriginDescriptor)
    )
      throw new TypeError('Active combat durable origin descriptors are invalid.');
    const origin = validateDurableExecutionOrigin(originDescriptor.value);
    const hasBuffered = typeof active.bufferedTargetId === 'string' && active.bufferedTargetId.trim().length > 0;
    if (hasBuffered !== (bufferedOriginDescriptor.value !== null))
      throw new TypeError('Active combat buffered durable origin is invalid.');
    const bufferedOrigin = bufferedOriginDescriptor.value
      ? validateDurableExecutionOrigin(bufferedOriginDescriptor.value)
      : null;
    origins.set(entry.actorId, Object.freeze({ origin, bufferedOrigin }));
  }
  return origins;
}

export function decodeBoundCombatSnapshot(
  snapshot: CombatRuntimeSnapshotV2 | CombatRuntimeSnapshotV3,
  options: DecodeOptions,
): DecodeResult {
  const restored = new Map<string, RestoredCombatantState>();
  const events: CombatLifecycleEvent[] = [];
  let resultSequence = snapshot.resultSequence;
  for (const entry of snapshot.combatants) {
    if (!entry?.actorId?.trim() || restored.has(entry.actorId))
      throw new TypeError('Combat actor is invalid or duplicated.');
    validateCombatSnapshot(entry.combat, snapshot.resultSequence, options.definitionFor);
    if (
      entry.actorIdentity !== null &&
      (!isEntityLifetimeReference(entry.actorIdentity) || entry.actorIdentity.entityId !== entry.actorId)
    )
      throw new TypeError('Combat actor binding is invalid.');
    const encodedActive = entry.combat.active;
    if (!encodedActive) {
      restored.set(entry.actorId, {
        active: null,
        lastResult: cloneResult(entry.combat.lastResult),
        lockoutSeconds: entry.combat.cooldownRemainingSeconds,
        actorIdentity: entry.actorIdentity ? { ...entry.actorIdentity } : null,
      });
      continue;
    }
    if (!entry.actorIdentity) throw new TypeError('Active combat actor binding is missing.');
    validateBoundActive(encodedActive, entry.combat.lastResult);
    const actor = rebindEntityLifetimeReference(options.identity, entry.actorIdentity, entry.actorId, 'actor');
    if (!actor.ok) throw new TypeError(actor.reason);
    const target = rebindEntityLifetimeReference(
      options.identity,
      encodedActive.targetIdentity,
      encodedActive.targetId,
      'target',
    );
    const buffered = encodedActive.bufferedTargetIdentity
      ? rebindEntityLifetimeReference(
          options.identity,
          encodedActive.bufferedTargetIdentity,
          encodedActive.bufferedTargetId!,
          'target',
        )
      : null;
    const failure = encodedActive.phase === 'windup' && !target.ok ? target.reason : null;
    if (failure) {
      assertCombatResultCapacity(resultSequence, 1);
      const cancelled: CombatResultSnapshot = {
        sequence: ++resultSequence,
        actionId: encodedActive.actionId,
        definitionId: encodedActive.definitionId,
        targetId: encodedActive.targetId,
        comboStep: encodedActive.comboStep,
        outcome: 'cancelled',
        damage: 0,
        reason: failure,
      };
      restored.set(entry.actorId, {
        active: null,
        lastResult: cancelled,
        lockoutSeconds: entry.combat.cooldownRemainingSeconds,
        actorIdentity: actor.reference,
      });
      events.push({ actorId: entry.actorId, actionId: encodedActive.actionId, status: 'cancelled', result: cancelled });
      continue;
    }
    restored.set(entry.actorId, {
      active: {
        actionId: encodedActive.actionId,
        definitionId: encodedActive.definitionId,
        targetId: encodedActive.targetId,
        comboStep: encodedActive.comboStep,
        phase: encodedActive.phase,
        phaseElapsedSeconds: encodedActive.phaseElapsedSeconds,
        bufferedTargetId: encodedActive.bufferedTargetId,
        targetIdentity: target.ok ? target.reference : { ...encodedActive.targetIdentity },
        bufferedTargetIdentity: buffered?.ok
          ? buffered.reference
          : encodedActive.bufferedTargetIdentity
            ? { ...encodedActive.bufferedTargetIdentity }
            : null,
      },
      lastResult: cloneResult(entry.combat.lastResult),
      lockoutSeconds: 0,
      actorIdentity: actor.reference,
    });
  }
  return { combatants: restored, resultSequence, events };
}

export function assertCombatResultCapacity(sequence: number, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || sequence > Number.MAX_SAFE_INTEGER - count)
    throw new RangeError('Combat result sequence is exhausted.');
}

export function combatPendingResultBound(
  states: Iterable<{ active: { definitionId: string; comboStep: number } | null }>,
  definitionFor: (id: string) => MeleeDefinition,
): number {
  let count = 0;
  for (const state of states)
    if (state.active) count += definitionFor(state.active.definitionId).steps.length - state.active.comboStep + 1;
  return count;
}

export function validateCombatSnapshot(
  combat: CombatSnapshot,
  resultSequence: number,
  definitionFor: (definitionId: string) => MeleeDefinition,
): void {
  if (!combat || !Number.isFinite(combat.cooldownRemainingSeconds) || combat.cooldownRemainingSeconds < 0)
    throw new TypeError('Combat projection is invalid.');
  if (combat.lastResult) {
    const result = combat.lastResult;
    if (
      !Number.isSafeInteger(result.sequence) ||
      result.sequence < 0 ||
      result.sequence > resultSequence ||
      !result.actionId.trim() ||
      !result.definitionId.trim() ||
      !result.targetId.trim() ||
      !Number.isSafeInteger(result.comboStep) ||
      result.comboStep < 0 ||
      !['hit', 'miss', 'cancelled'].includes(result.outcome) ||
      !Number.isFinite(result.damage) ||
      result.damage < 0
    )
      throw new TypeError('Combat result is invalid.');
  }
  if (!combat.active) return;
  const active = combat.active;
  const definition = definitionFor(active.definitionId);
  const step = definition.steps[active.comboStep];
  const phaseDuration =
    active.phase === 'windup' ? step?.windupSeconds : active.phase === 'hit' ? step?.hitSeconds : step?.recoverySeconds;
  if (
    !active.actionId.trim() ||
    !active.targetId.trim() ||
    !Number.isSafeInteger(active.comboStep) ||
    active.comboStep < 0 ||
    active.comboStep >= definition.steps.length ||
    active.comboLength !== definition.steps.length ||
    !['windup', 'hit', 'recovery'].includes(active.phase) ||
    !Number.isFinite(active.phaseElapsedSeconds) ||
    active.phaseElapsedSeconds < 0 ||
    !Number.isFinite(active.phaseDurationSeconds) ||
    active.phaseDurationSeconds < 0 ||
    active.phaseDurationSeconds !== phaseDuration ||
    active.phaseElapsedSeconds > active.phaseDurationSeconds ||
    typeof active.canBuffer !== 'boolean' ||
    typeof active.buffered !== 'boolean'
  )
    throw new TypeError('Active combat projection is invalid.');
}

function validateBoundActive(active: BoundActiveCombatSnapshot, lastResult: CombatResultSnapshot | null): void {
  if (!isEntityLifetimeReference(active.targetIdentity) || active.targetIdentity.entityId !== active.targetId)
    throw new TypeError('Active combat target binding is invalid.');
  const hasBufferedId = typeof active.bufferedTargetId === 'string' && active.bufferedTargetId.trim().length > 0;
  const hasBufferedIdentity = active.bufferedTargetIdentity !== null;
  if (active.buffered !== hasBufferedId || hasBufferedId !== hasBufferedIdentity)
    throw new TypeError('Active combat buffered binding is invalid.');
  if (
    hasBufferedIdentity &&
    (!isEntityLifetimeReference(active.bufferedTargetIdentity) ||
      active.bufferedTargetIdentity.entityId !== active.bufferedTargetId)
  )
    throw new TypeError('Active combat buffered target binding is invalid.');
  if (
    (active.phase === 'hit' || active.phase === 'recovery') &&
    (!lastResult ||
      lastResult.actionId !== active.actionId ||
      lastResult.definitionId !== active.definitionId ||
      lastResult.targetId !== active.targetId ||
      lastResult.comboStep !== active.comboStep ||
      lastResult.outcome === 'cancelled')
  )
    throw new TypeError('Active combat hit dedupe result is invalid.');
}

export function validateCombatAllocator(snapshot: CombatRuntimeSnapshot): void {
  if (
    !snapshot ||
    (snapshot.version !== 1 && snapshot.version !== 2 && snapshot.version !== 3) ||
    !Number.isSafeInteger(snapshot.actionSequence) ||
    snapshot.actionSequence < 0 ||
    !Number.isSafeInteger(snapshot.resultSequence) ||
    snapshot.resultSequence < 0 ||
    !Array.isArray(snapshot.combatants)
  )
    throw new TypeError('Combat snapshot header is invalid.');

  if (snapshot.combatants.length > MAX_COMBAT_FRONTIER_ENTRIES) throw new RangeError('Combat frontier limit exceeded.');

  for (const entry of snapshot.combatants) {
    for (const id of [entry?.combat?.active?.actionId, entry?.combat?.lastResult?.actionId]) {
      if (typeof id !== 'string') continue;
      const match = /^combat-(\d+)$/.exec(id);
      if (!match) continue; // Autonomous actions use the separate ActionRuntime allocator.
      const ordinal = Number(match[1]);
      if (!Number.isSafeInteger(ordinal) || ordinal <= 0 || ordinal > snapshot.actionSequence)
        throw new TypeError('Combat identity exceeds the allocator high-water mark.');
    }
  }
}
