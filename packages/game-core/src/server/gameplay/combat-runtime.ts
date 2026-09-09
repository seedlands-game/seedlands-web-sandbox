import {
  entityReferenceExecutionFailure,
  type EntityIdentityPort,
  type EntityLifetimeReference,
} from '../simulation/action-identity';
import {
  decodeBoundCombatSnapshot,
  encodeBoundCombatSnapshot,
  validateCombatSnapshot,
  validateCombatAllocator,
  type CombatRuntimeSnapshot,
  type CombatRuntimeSnapshotV2,
} from './combat-runtime-snapshot';

export type * from './combat-runtime-snapshot';
export { emptyCombatRuntimeSnapshot } from './combat-runtime-snapshot';

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

export type MeleeStepDefinition = Readonly<{
  damage: number;
  windupSeconds: number;
  hitSeconds: number;
  recoverySeconds: number;
}>;

export type MeleeDefinition = Readonly<{
  id: string;
  range: number;
  steps: readonly MeleeStepDefinition[];
}>;

export type CombatRequestResult =
  Readonly<{ success: true; actionId: string; buffered: boolean }> | Readonly<{ success: false; reason: string }>;

export type CombatLifecycleEvent = Readonly<{
  actorId: string;
  actionId: string;
  status: 'completed' | 'cancelled';
  result: CombatResultSnapshot | null;
}>;

type InternalActiveCombat = {
  actionId: string;
  definitionId: string;
  targetId: string;
  comboStep: number;
  phase: CombatPhase;
  phaseElapsedSeconds: number;
  bufferedTargetId: string | null;
  targetIdentity: EntityLifetimeReference | null;
  bufferedTargetIdentity: EntityLifetimeReference | null;
};

type CombatantState = {
  active: InternalActiveCombat | null;
  lastResult: CombatResultSnapshot | null;
  lockoutSeconds: number;
  actorIdentity: EntityLifetimeReference | null;
};

export type CombatRuntimeCallbacks = Readonly<{
  actorAvailable: (actorId: string) => boolean;
  targetAvailable: (targetId: string) => boolean;
  validateHit: (actorId: string, targetId: string, definition: MeleeDefinition) => string | null;
  applyDamage: (actorId: string, targetId: string, damage: number) => number | null;
}>;

const step = (damage: number, windupSeconds: number, hitSeconds: number, recoverySeconds: number) =>
  Object.freeze({ damage, windupSeconds, hitSeconds, recoverySeconds });

const builtInDefinitions: readonly MeleeDefinition[] = [
  { id: 'unarmed', range: 3, steps: [step(4, 0, 0.01, 0.49)] },
  {
    id: 'wood-sword',
    range: 3,
    steps: [step(5, 0.18, 0.08, 0.24), step(7, 0.14, 0.08, 0.38)],
  },
  {
    id: 'night-stalker-claw',
    range: 1.7,
    steps: [step(2, 0.3, 0.1, 0.6)],
  },
];
const MAX_MELEE_DEFINITIONS = 64;
const MAX_COMBO_STEPS = 8;

const round = (value: number) => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
const cloneResult = (value: CombatResultSnapshot | null): CombatResultSnapshot | null => (value ? { ...value } : null);

export type MeleeDefinitionRegistry = Readonly<{
  get: (id: string) => MeleeDefinition | undefined;
  list: () => readonly MeleeDefinition[];
}>;

export function createMeleeDefinitionRegistry(inputs: readonly MeleeDefinition[]): MeleeDefinitionRegistry {
  if (inputs.length > MAX_MELEE_DEFINITIONS) throw new TypeError('Melee definition registry exceeds its limit.');
  const registered = new Map<string, MeleeDefinition>();
  for (const input of inputs) {
    if (!input.id?.trim() || registered.has(input.id))
      throw new TypeError(`Duplicate or empty melee definition: ${input.id}`);
    if (
      !Number.isFinite(input.range) ||
      input.range <= 0 ||
      !Array.isArray(input.steps) ||
      input.steps.length === 0 ||
      input.steps.length > MAX_COMBO_STEPS
    )
      throw new TypeError(`Melee definition is invalid: ${input.id}`);
    const steps = input.steps.map((value) => {
      if (
        !Number.isFinite(value.damage) ||
        value.damage <= 0 ||
        !Number.isFinite(value.windupSeconds) ||
        value.windupSeconds < 0 ||
        !Number.isFinite(value.hitSeconds) ||
        value.hitSeconds <= 0 ||
        !Number.isFinite(value.recoverySeconds) ||
        value.recoverySeconds < 0
      )
        throw new TypeError(`Melee step is invalid: ${input.id}`);
      return Object.freeze({ ...value });
    });
    registered.set(input.id, Object.freeze({ id: input.id, range: input.range, steps: Object.freeze(steps) }));
  }
  const values = Object.freeze([...registered.values()]);
  return Object.freeze({ get: (id: string) => registered.get(id), list: () => values });
}

const defaultRegistry = createMeleeDefinitionRegistry(builtInDefinitions);

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

  constructor(
    private readonly callbacks: CombatRuntimeCallbacks,
    private readonly registry: MeleeDefinitionRegistry = defaultRegistry,
    private readonly identity?: EntityIdentityPort,
  ) {}

  hasDefinition(id: string): boolean {
    return this.registry.get(id) !== undefined;
  }

  request(actorId: string, targetId: string, definitionId: string, createActionId?: () => string): CombatRequestResult {
    if (!actorId.trim() || !targetId.trim()) return { success: false, reason: 'invalid-target' };
    const definition = this.registry.get(definitionId);
    if (!definition) return { success: false, reason: 'invalid-definition' };
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
      if (!this.canBuffer(existing, definition)) return { success: false, reason: 'combo-window-closed' };
      const validation = this.callbacks.validateHit(actorId, targetId, definition);
      if (validation) return { success: false, reason: validation };
      existing.bufferedTargetId = targetId;
      existing.bufferedTargetIdentity = targetIdentity ? { ...targetIdentity } : null;
      return { success: true, actionId: existing.actionId, buffered: true };
    }
    if (currentState && currentState.lockoutSeconds > 0) return { success: false, reason: 'cooldown' };
    const validation = this.callbacks.validateHit(actorId, targetId, definition);
    if (validation) return { success: false, reason: validation };
    if (!createActionId && this.actionSequence >= Number.MAX_SAFE_INTEGER)
      return { success: false, reason: 'action-sequence-exhausted' };
    const actionId = createActionId?.() ?? `combat-${++this.actionSequence}`;
    const state = currentState ?? { active: null, lastResult: null, lockoutSeconds: 0, actorIdentity: null };
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
    for (const actorId of [...this.combatants.keys()]) this.advanceActor(actorId, seconds);
  }

  cancelActor(actorId: string, reason: string): boolean {
    const state = this.combatants.get(actorId);
    if (!state?.active) return false;
    this.cancel(actorId, state, reason);
    return true;
  }

  cancelTarget(targetId: string, reason = 'target-missing', exceptActorId?: string): void {
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
      active: this.projectActive(active, definition),
      cooldownRemainingSeconds: this.remainingSeconds(active, definition),
      lastResult: cloneResult(state?.lastResult ?? null),
    };
  }

  snapshot(): CombatRuntimeSnapshot {
    if (this.identity)
      return encodeBoundCombatSnapshot(this.actionSequence, this.resultSequence, this.combatants, (actorId) =>
        this.snapshotFor(actorId),
      );
    return {
      version: 1,
      actionSequence: this.actionSequence,
      resultSequence: this.resultSequence,
      combatants: [...this.combatants.entries()].map(([actorId]) => ({ actorId, combat: this.snapshotFor(actorId) })),
    };
  }

  restore(raw: unknown): void {
    const snapshot = raw as CombatRuntimeSnapshot;
    validateCombatAllocator(snapshot);
    if (snapshot.version === 2) return this.restoreBoundSnapshot(snapshot);
    const restored = new Map<string, CombatantState>();
    for (const entry of snapshot.combatants) {
      if (!entry?.actorId?.trim() || restored.has(entry.actorId))
        throw new TypeError('Combat actor is invalid or duplicated.');
      validateCombatSnapshot(entry.combat, snapshot.resultSequence, (id) => this.requireDefinition(id));
      restored.set(entry.actorId, {
        active: entry.combat.active
          ? {
              ...entry.combat.active,
              bufferedTargetId: null,
              targetIdentity: null,
              bufferedTargetIdentity: null,
            }
          : null,
        lastResult: cloneResult(entry.combat.lastResult),
        // An active projection already includes any buffered next step in this value.
        // Preserve that authority promise even though restore deliberately discards the queued target and cancels the action.
        lockoutSeconds: entry.combat.cooldownRemainingSeconds,
        actorIdentity: null,
      });
    }
    this.combatants.clear();
    restored.forEach((state, actorId) => this.combatants.set(actorId, state));
    this.actionSequence = snapshot.actionSequence;
    this.resultSequence = snapshot.resultSequence;
    this.lifecycleEvents.length = 0;
    for (const [actorId, state] of this.combatants) if (state.active) this.cancel(actorId, state, 'restore-cancelled');
  }

  takeLifecycleEvents(): CombatLifecycleEvent[] {
    return this.lifecycleEvents.splice(0);
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
      const duration = this.phaseDuration(active, definition);
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
        active.bufferedTargetId = null;
        active.bufferedTargetIdentity = null;
        active.phase = 'windup';
        active.phaseElapsedSeconds = 0;
        if (this.phaseDuration(active, definition) === 0) this.enterHit(actorId, state, definition);
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
    const actorIdentityFailure = entityReferenceExecutionFailure(this.identity, state.actorIdentity, actorId, 'actor');
    if (actorIdentityFailure) return this.cancel(actorId, state, actorIdentityFailure);
    const targetIdentityFailure = entityReferenceExecutionFailure(
      this.identity,
      active.targetIdentity,
      active.targetId,
      'target',
    );
    if (targetIdentityFailure) return this.cancel(actorId, state, targetIdentityFailure);
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
    state.lockoutSeconds = Math.max(
      state.lockoutSeconds,
      this.remainingSeconds(active, this.requireDefinition(active.definitionId)),
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
    this.lifecycleEvents.push({
      actorId,
      actionId: active.actionId,
      status: 'cancelled',
      result: cloneResult(state.lastResult),
    });
  }

  private projectActive(active: InternalActiveCombat, definition: MeleeDefinition): ActiveCombatSnapshot {
    return {
      actionId: active.actionId,
      definitionId: active.definitionId,
      targetId: active.targetId,
      comboStep: active.comboStep,
      comboLength: definition.steps.length,
      phase: active.phase,
      phaseElapsedSeconds: active.phaseElapsedSeconds,
      phaseDurationSeconds: this.phaseDuration(active, definition),
      canBuffer: this.canBuffer(active, definition),
      buffered: active.bufferedTargetId !== null,
    };
  }

  private phaseDuration(active: InternalActiveCombat, definition: MeleeDefinition): number {
    const current = definition.steps[active.comboStep];
    if (active.phase === 'windup') return current.windupSeconds;
    if (active.phase === 'hit') return current.hitSeconds;
    return current.recoverySeconds;
  }

  private canBuffer(active: InternalActiveCombat, definition: MeleeDefinition): boolean {
    return active.comboStep + 1 < definition.steps.length && (active.phase === 'hit' || active.phase === 'recovery');
  }

  private remainingSeconds(active: InternalActiveCombat, definition: MeleeDefinition): number {
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
  }

  private restoreBoundSnapshot(snapshot: CombatRuntimeSnapshotV2): void {
    if (!this.identity) throw new TypeError('Combat snapshot version 2 requires an entity identity port.');
    const decoded = decodeBoundCombatSnapshot(snapshot, {
      identity: this.identity,
      definitionFor: (id) => this.requireDefinition(id),
    });
    this.combatants.clear();
    decoded.combatants.forEach((state, actorId) => this.combatants.set(actorId, state));
    this.actionSequence = snapshot.actionSequence;
    this.resultSequence = decoded.resultSequence;
    this.lifecycleEvents.splice(0, this.lifecycleEvents.length, ...decoded.events);
  }

  private requireDefinition(id: string): MeleeDefinition {
    const definition = this.registry.get(id);
    if (!definition) throw new RangeError(`Unknown melee definition: ${id}`);
    return definition;
  }
}
