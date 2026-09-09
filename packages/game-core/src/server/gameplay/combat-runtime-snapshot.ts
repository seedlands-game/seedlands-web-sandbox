import {
  isEntityLifetimeReference,
  rebindEntityLifetimeReference,
  type EntityIdentityPort,
  type EntityLifetimeReference,
} from '../simulation/action-identity';
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

export type CombatRuntimeSnapshot = CombatRuntimeSnapshotV1 | CombatRuntimeSnapshotV2;

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
  }> | null;
  actorIdentity: EntityLifetimeReference | null;
}>;

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
    combatants: [...combatants.entries()].map(([actorId, state]) => {
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
    }),
  };
}

export function decodeBoundCombatSnapshot(snapshot: CombatRuntimeSnapshotV2, options: DecodeOptions): DecodeResult {
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
    (snapshot.version !== 1 && snapshot.version !== 2) ||
    !Number.isSafeInteger(snapshot.actionSequence) ||
    snapshot.actionSequence < 0 ||
    !Number.isSafeInteger(snapshot.resultSequence) ||
    snapshot.resultSequence < 0 ||
    !Array.isArray(snapshot.combatants)
  )
    throw new TypeError('Combat snapshot header is invalid.');

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
