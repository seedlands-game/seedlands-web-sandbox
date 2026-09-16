import {
  createMeleeDefinitionRegistry,
  MAX_COMBO_STEPS,
  type MeleeDefinition,
  type MeleeDefinitionRegistry,
} from './melee-definition-registry';
export { createMeleeDefinitionRegistry } from './melee-definition-registry';
export type { MeleeDefinition, MeleeStepDefinition, MeleeDefinitionRegistry } from './melee-definition-registry';
import { entityReferenceExecutionFailure, type EntityIdentityPort } from '../simulation/action-identity';
import {
  encodeCombatRuntimeSnapshot,
  assertCombatResultCapacity,
  combatPendingResultBound,
  type CombatRuntimeSnapshot,
} from './combat-runtime-snapshot';
import type { DurableExecutionOriginV1 } from '../composition/execution-origin';
import { acceptCombatOrigin, combatOriginHitFailure, type CombatOriginRuntimeOptions } from './combat-origin';
import {
  capturePreparedCombatFrontier,
  cloneCombatLifecycleEvents,
  combatCanBuffer,
  combatPhaseDuration,
  combatRemainingSeconds,
  listCombatPendingHits,
  prepareCombatMutation,
  prepareCombatRuntimeRestore,
  projectCombatActive,
  type PreparedCombatantState,
  type PreparedCombatFrontier,
  type PreparedCombatMutation,
  type PreparedCombatMutationInput,
} from './prepared-combat-mutation';
import type { CombatPendingHit } from './combat-pending-hit';
import {
  acknowledgeCombatLifecycleEvents,
  combatFrontierSignature,
  prepareCombatRequest,
  type PreparedCombatRequestInput,
  type PreparedCombatRequestResult,
} from './combat-request-candidate';

export type * from './combat-runtime-snapshot';
export { emptyCombatRuntimeSnapshot } from './combat-runtime-snapshot';
export type * from './combat-origin';
export type * from './combat-pending-hit';
export type * from './prepared-combat-mutation';
export type * from './combat-request-candidate';

export type CombatPhase = 'windup' | 'hit' | 'recovery';
export type CombatOutcome = 'hit' | 'miss' | 'cancelled';

export type CombatResultSnapshot = Readonly<{
  sequence: number;
  actionId: string;
  definitionId: string;
  targetId: string;
  comboStep: number;
  outcome: CombatOutcome;
  damage: number;
  reason?: string;
}>;

export type ActiveCombatSnapshot = Readonly<{
  actionId: string;
  definitionId: string;
  targetId: string;
  comboStep: number;
  comboLength: number;
  phase: CombatPhase;
  phaseElapsedSeconds: number;
  phaseDurationSeconds: number;
  canBuffer: boolean;
  buffered: boolean;
}>;

export type CombatSnapshot = Readonly<{
  active: ActiveCombatSnapshot | null;
  cooldownRemainingSeconds: number;
  lastResult: CombatResultSnapshot | null;
}>;

export type CombatRequestResult =
  Readonly<{ success: true; actionId: string; buffered: boolean }> | Readonly<{ success: false; reason: string }>;

export type CombatLifecycleEvent = Readonly<{
  actorId: string;
  actionId: string;
  status: 'completed' | 'cancelled';
  result: CombatResultSnapshot | null;
}>;

type CombatantState = PreparedCombatantState;

export type CombatRuntimeCallbacks = Readonly<{
  actorAvailable: (actorId: string) => boolean;
  targetAvailable: (targetId: string) => boolean;
  validateHit: (actorId: string, targetId: string, definition: MeleeDefinition) => string | null;
  applyDamage: (actorId: string, targetId: string, damage: number) => number | null;
}>;

const round = (value: number) => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
const cloneResult = (value: CombatResultSnapshot | null): CombatResultSnapshot | null => (value ? { ...value } : null);

const defaultRegistry = createMeleeDefinitionRegistry([]);

export function getMeleeDefinition(id: string): MeleeDefinition {
  const definition = defaultRegistry.get(id);
  if (!definition) throw new RangeError(`Unknown melee definition: ${id}`);
  return definition;
}

export const listMeleeDefinitions = (): readonly MeleeDefinition[] => defaultRegistry.list();

export class CombatRuntime {
  private readonly combatants = new Map<string, CombatantState>();
  private readonly lifecycleEvents: CombatLifecycleEvent[] = [];
  private actionSequence = 0;
  private resultSequence = 0;
  private readonly requireOrigin: boolean;

  constructor(
    private readonly callbacks: CombatRuntimeCallbacks,
    private readonly registry: MeleeDefinitionRegistry = defaultRegistry,
    private readonly identity?: EntityIdentityPort,
    private readonly originOptions: CombatOriginRuntimeOptions = {},
  ) {
    this.requireOrigin = originOptions.requireOrigin ?? false;
    if (this.requireOrigin && !identity)
      throw new TypeError('Combat requireOrigin mode requires an entity identity port.');
    if (this.requireOrigin && !originOptions.validationPort)
      throw new TypeError('Combat requireOrigin mode requires an origin validation port.');
  }

  hasDefinition(id: string): boolean {
    return this.registry.get(id) !== undefined;
  }

  request(
    actorId: string,
    targetId: string,
    definitionId: string,
    createActionId?: () => string,
    origin?: DurableExecutionOriginV1,
  ): CombatRequestResult {
    if (!actorId.trim() || !targetId.trim()) return { success: false, reason: 'invalid-target' };
    const definition = this.registry.get(definitionId);
    if (!definition) return { success: false, reason: 'invalid-definition' };
    if (this.resultSequence > Number.MAX_SAFE_INTEGER - this.pendingResultBound() - definition.steps.length - 1)
      return { success: false, reason: 'result-sequence-exhausted' };
    if (!this.callbacks.actorAvailable(actorId)) return { success: false, reason: 'invalid-attacker' };
    if (!this.callbacks.targetAvailable(targetId)) return { success: false, reason: 'invalid-target' };
    const actorIdentity = this.identity?.referenceFor(actorId) ?? null;
    const targetIdentity = this.identity?.referenceFor(targetId) ?? null;
    if (this.identity && !actorIdentity) return { success: false, reason: 'invalid-attacker' };
    if (this.identity && !targetIdentity) return { success: false, reason: 'invalid-target' };
    const currentState = this.combatants.get(actorId);
    const existing = currentState?.active ?? null;
    if (existing) {
      if (existing.bufferedTargetId) return { success: false, reason: 'buffer-full' };
      if (existing.definitionId !== definitionId || existing.comboStep + 1 >= definition.steps.length)
        return { success: false, reason: 'cooldown' };
      if (!combatCanBuffer(existing, definition)) return { success: false, reason: 'combo-window-closed' };
      const acceptedOrigin = acceptCombatOrigin(
        origin,
        actorIdentity,
        this.requireOrigin,
        this.originOptions.validationPort,
        {
          actorId,
          targetId,
          definitionId,
          comboStep: existing.comboStep + 1,
        },
      );
      if (acceptedOrigin.failure) return { success: false, reason: acceptedOrigin.failure };
      const validation = this.callbacks.validateHit(actorId, targetId, definition);
      if (validation) return { success: false, reason: validation };
      existing.bufferedTargetId = targetId;
      existing.bufferedTargetIdentity = targetIdentity ? { ...targetIdentity } : null;
      existing.bufferedOrigin = acceptedOrigin.origin;
      return { success: true, actionId: existing.actionId, buffered: true };
    }
    if (currentState && currentState.lockoutSeconds > 0) return { success: false, reason: 'cooldown' };
    const acceptedOrigin = acceptCombatOrigin(
      origin,
      actorIdentity,
      this.requireOrigin,
      this.originOptions.validationPort,
      { actorId, targetId, definitionId, comboStep: 0 },
    );
    if (acceptedOrigin.failure) return { success: false, reason: acceptedOrigin.failure };
    const validation = this.callbacks.validateHit(actorId, targetId, definition);
    if (validation) return { success: false, reason: validation };
    if (!createActionId && this.actionSequence >= Number.MAX_SAFE_INTEGER)
      return { success: false, reason: 'action-sequence-exhausted' };
    const actionId = createActionId?.() ?? `combat-${++this.actionSequence}`;
    const state = currentState ?? {
      active: null,
      lastResult: null,
      lockoutSeconds: 0,
      actorIdentity: null,
      pendingHit: null,
    };
    state.actorIdentity = actorIdentity ? { ...actorIdentity } : null;
    state.active = {
      actionId,
      definitionId,
      targetId,
      comboStep: 0,
      phase: 'windup',
      phaseElapsedSeconds: 0,
      bufferedTargetId: null,
      targetIdentity: targetIdentity ? { ...targetIdentity } : null,
      bufferedTargetIdentity: null,
      origin: acceptedOrigin.origin,
      bufferedOrigin: null,
    };
    this.combatants.set(actorId, state);
    if (definition.steps[0].windupSeconds === 0) this.enterHit(actorId, state, definition);
    return { success: true, actionId, buffered: false };
  }

  retain(actorId: string, actionId: string): CombatRequestResult {
    const state = this.combatants.get(actorId);
    const active = state?.active;
    if (state && active?.actionId === actionId) {
      const actorFailure = entityReferenceExecutionFailure(this.identity, state.actorIdentity, actorId, 'actor');
      if (actorFailure) {
        this.cancel(actorId, state, actorFailure);
        return { success: false, reason: actorFailure };
      }
      if (active.phase === 'windup') {
        const targetFailure = entityReferenceExecutionFailure(
          this.identity,
          active.targetIdentity,
          active.targetId,
          'target',
        );
        if (targetFailure) {
          this.cancel(actorId, state, targetFailure);
          return { success: false, reason: targetFailure };
        }
      }
    }
    return active?.actionId === actionId
      ? { success: true, actionId, buffered: active.bufferedTargetId !== null }
      : { success: false, reason: 'action-mismatch' };
  }

  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new TypeError('Combat seconds must be non-negative and finite.');
    assertCombatResultCapacity(this.resultSequence, this.pendingResultBound());
    for (const actorId of [...this.combatants.keys()]) this.advanceActor(actorId, seconds);
  }

  assertCanCancelActor(actorId: string): void {
    assertCombatResultCapacity(this.resultSequence, this.combatants.get(actorId)?.active ? 1 : 0);
  }

  cancelActor(actorId: string, reason: string): boolean {
    const state = this.combatants.get(actorId);
    if (!state?.active) return false;
    this.cancel(actorId, state, reason);
    return true;
  }

  cancelTarget(targetId: string, reason = 'target-missing', exceptActorId?: string): void {
    assertCombatResultCapacity(
      this.resultSequence,
      [...this.combatants].filter(
        ([actorId, state]) =>
          actorId !== exceptActorId && state.active?.targetId === targetId && state.active.phase === 'windup',
      ).length,
    );
    for (const [actorId, state] of this.combatants) {
      if (actorId === exceptActorId || state.active?.targetId !== targetId || state.active.phase !== 'windup') continue;
      this.cancel(actorId, state, reason);
    }
  }

  restoreLockout(actorId: string, seconds: number): void {
    if (!actorId.trim() || !Number.isFinite(seconds) || seconds < 0)
      throw new TypeError('Legacy combat lockout is invalid.');
    if (seconds === 0) return;
    const state = this.combatants.get(actorId) ?? {
      active: null,
      lastResult: null,
      lockoutSeconds: 0,
      actorIdentity: null,
      pendingHit: null,
    };
    if (!state.active) state.lockoutSeconds = Math.max(state.lockoutSeconds, seconds);
    this.combatants.set(actorId, state);
  }

  snapshotFor(actorId: string): CombatSnapshot {
    const state = this.combatants.get(actorId);
    const active = state?.active ?? null;
    if (!active)
      return {
        active: null,
        cooldownRemainingSeconds: round(state?.lockoutSeconds ?? 0),
        lastResult: cloneResult(state?.lastResult ?? null),
      };
    const definition = this.requireDefinition(active.definitionId);
    return {
      active: projectCombatActive(active, definition),
      cooldownRemainingSeconds: combatRemainingSeconds(active, definition),
      lastResult: cloneResult(state?.lastResult ?? null),
    };
  }

  snapshot(): CombatRuntimeSnapshot {
    return encodeCombatRuntimeSnapshot(
      this.actionSequence,
      this.resultSequence,
      this.combatants,
      (actorId) => this.snapshotFor(actorId),
      Boolean(this.identity),
      this.requireOrigin,
    );
  }

  restore(raw: unknown): void {
    const restored = prepareCombatRuntimeRestore(raw, {
      identity: this.identity,
      requireOrigin: this.requireOrigin,
      origin: this.originOptions,
      definitionFor: (id) => this.requireDefinition(id),
    });
    this.combatants.clear();
    restored.combatants.forEach((state, actorId) => this.combatants.set(actorId, state));
    this.actionSequence = restored.actionSequence;
    this.resultSequence = restored.resultSequence;
    this.lifecycleEvents.splice(0, this.lifecycleEvents.length, ...restored.lifecycleEvents);
  }

  takeLifecycleEvents(): CombatLifecycleEvent[] {
    return this.lifecycleEvents.splice(0);
  }

  prepareMutation(input: PreparedCombatMutationInput): PreparedCombatMutation {
    return prepareCombatMutation(this.preparedHost(), input);
  }

  prepareRequest(input: PreparedCombatRequestInput): PreparedCombatRequestResult {
    return prepareCombatRequest(this.preparedHost(), input);
  }

  peekPendingHits(): readonly CombatPendingHit[] {
    return listCombatPendingHits(this.combatants.values());
  }

  peekLifecycleEvents(): readonly CombatLifecycleEvent[] {
    return Object.freeze(cloneCombatLifecycleEvents(this.lifecycleEvents).map((event) => Object.freeze(event)));
  }

  acknowledgeLifecycleEvents(count: number): void {
    acknowledgeCombatLifecycleEvents(this.lifecycleEvents, count);
  }

  private advanceActor(actorId: string, seconds: number): void {
    let remaining = seconds;
    let transitions = 0;
    while (remaining >= 0 && transitions++ < MAX_COMBO_STEPS * 3 + 1) {
      const state = this.combatants.get(actorId);
      const active = state?.active;
      if (!state) return;
      if (!active) {
        state.lockoutSeconds = round(state.lockoutSeconds - seconds);
        return;
      }
      if (state.pendingHit) return;
      const actorIdentityFailure = entityReferenceExecutionFailure(
        this.identity,
        state.actorIdentity,
        actorId,
        'actor',
      );
      if (actorIdentityFailure) return this.cancel(actorId, state, actorIdentityFailure);
      if (!this.callbacks.actorAvailable(actorId)) return this.cancel(actorId, state, 'attacker-dead');
      if (active.phase === 'windup') {
        const targetIdentityFailure = entityReferenceExecutionFailure(
          this.identity,
          active.targetIdentity,
          active.targetId,
          'target',
        );
        if (targetIdentityFailure) return this.cancel(actorId, state, targetIdentityFailure);
        if (!this.callbacks.targetAvailable(active.targetId)) return this.cancel(actorId, state, 'target-missing');
      }
      const definition = this.requireDefinition(active.definitionId);
      const duration = combatPhaseDuration(active, definition);
      const untilTransition = round(duration - active.phaseElapsedSeconds);
      if (remaining + Number.EPSILON < untilTransition) {
        active.phaseElapsedSeconds = round(active.phaseElapsedSeconds + remaining);
        return;
      }
      active.phaseElapsedSeconds = duration;
      remaining = round(remaining - untilTransition);
      if (active.phase === 'windup') this.enterHit(actorId, state, definition);
      else if (active.phase === 'hit') {
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
        if (combatPhaseDuration(active, definition) === 0) this.enterHit(actorId, state, definition);
      } else {
        state.active = null;
        this.lifecycleEvents.push({
          actorId,
          actionId: active.actionId,
          status: 'completed',
          result: cloneResult(state.lastResult),
        });
        return;
      }
    }
    if (transitions >= MAX_COMBO_STEPS * 3 + 1) throw new Error('Combat transition limit exceeded.');
  }

  private enterHit(actorId: string, state: CombatantState, definition: MeleeDefinition): void {
    const active = state.active;
    if (!active) return;
    assertCombatResultCapacity(this.resultSequence, this.pendingResultBound());
    const actorIdentityFailure = entityReferenceExecutionFailure(this.identity, state.actorIdentity, actorId, 'actor');
    if (actorIdentityFailure) return this.cancel(actorId, state, actorIdentityFailure);
    const targetIdentityFailure = entityReferenceExecutionFailure(
      this.identity,
      active.targetIdentity,
      active.targetId,
      'target',
    );
    if (targetIdentityFailure) return this.cancel(actorId, state, targetIdentityFailure);
    const originFailure = combatOriginHitFailure(
      active.origin,
      state.actorIdentity,
      this.requireOrigin,
      this.originOptions.validationPort,
      {
        actorId,
        targetId: active.targetId,
        definitionId: active.definitionId,
        comboStep: active.comboStep,
      },
    );
    if (originFailure) return this.cancel(actorId, state, originFailure);
    active.phase = 'hit';
    active.phaseElapsedSeconds = 0;
    const stepDefinition = definition.steps[active.comboStep];
    const reason = this.callbacks.validateHit(actorId, active.targetId, definition);
    const applied = reason ? null : this.callbacks.applyDamage(actorId, active.targetId, stepDefinition.damage);
    state.lastResult = {
      sequence: ++this.resultSequence,
      actionId: active.actionId,
      definitionId: active.definitionId,
      targetId: active.targetId,
      comboStep: active.comboStep,
      outcome: applied === null ? 'miss' : 'hit',
      damage: applied ?? 0,
      ...(reason || applied === null ? { reason: reason ?? 'target-unavailable' } : {}),
    };
  }

  private cancel(actorId: string, state: CombatantState, reason: string): void {
    const active = state.active;
    if (!active) return;
    assertCombatResultCapacity(this.resultSequence, 1);
    state.lockoutSeconds = Math.max(
      state.lockoutSeconds,
      combatRemainingSeconds(active, this.requireDefinition(active.definitionId)),
    );
    state.lastResult = {
      sequence: ++this.resultSequence,
      actionId: active.actionId,
      definitionId: active.definitionId,
      targetId: active.targetId,
      comboStep: active.comboStep,
      outcome: 'cancelled',
      damage: 0,
      reason,
    };
    state.active = null;
    state.pendingHit = null;
    this.lifecycleEvents.push({
      actorId,
      actionId: active.actionId,
      status: 'cancelled',
      result: cloneResult(state.lastResult),
    });
  }

  private pendingResultBound(): number {
    return combatPendingResultBound(this.combatants.values(), (id) => this.requireDefinition(id));
  }

  private installPreparedFrontier(frontier: PreparedCombatFrontier): void {
    this.combatants.clear();
    frontier.combatants.forEach((state, actorId) => this.combatants.set(actorId, state));
    this.actionSequence = frontier.actionSequence;
    this.resultSequence = frontier.resultSequence;
    this.lifecycleEvents.splice(0, this.lifecycleEvents.length, ...frontier.lifecycleEvents);
  }

  private preparedHost(): import('./prepared-combat-mutation').PreparedCombatHost {
    return {
      callbacks: this.callbacks,
      identity: this.identity,
      requireOrigin: this.requireOrigin,
      validationPort: this.originOptions.validationPort,
      capture: () =>
        capturePreparedCombatFrontier(this.combatants, this.actionSequence, this.resultSequence, this.lifecycleEvents),
      signature: () =>
        combatFrontierSignature(this.combatants, this.actionSequence, this.resultSequence, this.lifecycleEvents),
      install: (frontier) => this.installPreparedFrontier(frontier),
      definitionFor: (id) => this.requireDefinition(id),
    };
  }

  private requireDefinition(id: string): MeleeDefinition {
    const definition = this.registry.get(id);
    if (!definition) throw new RangeError(`Unknown melee definition: ${id}`);
    return definition;
  }
}
