import type { EntityStore } from '../gameplay/entity-store';
import type { ItemStack } from '../gameplay/item-registry';
import { ActionRuntime, type ActorAction, type ActorActionInput } from './action-runtime';
import {
  MAX_RETAINED_ACTORS,
  STEP_SECONDS,
  cloneActor,
  rangeByArchetype,
  roundSimulation as round,
  type ActorRegistration,
  type ActorState,
  type SimulationSnapshot,
} from './actor-state';
import { GroundNavigator } from './ground-navigator';
import { PerceptionRuntime, type PerceptionSnapshot } from './perception-runtime';
import { PoiRegistry, type PoiInput } from './poi-registry';
import { resolveActionTarget, updateActorActive } from './autonomy-helpers';
import { tickAuthorityActorRules, type ActorAuthorityRulesContext } from './actor-authority-rules';
import type { CoreClone } from '../../runtime/platform-ports';
import type { EntityIdentityPort } from './action-identity';
import {
  CombatRuntime,
  createMeleeDefinitionRegistry,
  emptyCombatRuntimeSnapshot,
  type CombatRequestResult,
  type CombatRuntimeCallbacks,
  type CombatSnapshot,
  type MeleeDefinition,
} from '../gameplay/combat-runtime';

export type { ActorBehavior, ActorRegistration, ActorState, SimulationSnapshot } from './actor-state';

type Options = {
  entities: EntityStore;
  getVoxel: (x: number, y: number, z: number) => number;
  getWorldTime: () => number;
  isPlayerAlive: (id: string) => boolean;
  clone: CoreClone;
  combat?: CombatRuntimeCallbacks;
  meleeDefinitions?: readonly MeleeDefinition[];
};

export class AutonomyRuntime {
  readonly pois = new PoiRegistry();
  readonly actions: ActionRuntime;
  readonly navigator: GroundNavigator;
  readonly perception: PerceptionRuntime;
  readonly combat: CombatRuntime;
  private readonly actors = new Map<string, ActorState>();
  private time = 0;
  private stepAccumulator = 0;
  private needsAccumulator = 0;
  private perceptionAccumulator = 0;
  private behaviorAccumulator = 0;
  private starterVersion = 0;
  private behaviorEvaluationCount = 0;
  private navigationPlanCount = 0;
  private navigationExpandedNodeCount = 0;
  private pathRecomputeCount = 0;
  private actionCompletionCount = 0;
  private actionFailureCount = 0;
  private actionInterruptionCount = 0;

  constructor(private readonly options: Options) {
    const identity: EntityIdentityPort = {
      referenceFor: (entityId) => options.entities.createReference(entityId),
      resolve: (reference) => options.entities.resolveReference(reference)?.id ?? null,
      rebind: (reference) => {
        const current = options.entities.createReference(reference.entityId);
        return current?.lifetime === reference.lifetime ? current : null;
      },
    };
    this.actions = new ActionRuntime(options.clone, identity);
    this.navigator = new GroundNavigator(options.getVoxel);
    this.perception = new PerceptionRuntime({
      entities: options.entities,
      pois: this.pois,
      getVoxel: options.getVoxel,
      isPlayerAlive: options.isPlayerAlive,
    });
    this.combat = new CombatRuntime(
      options.combat ?? {
        actorAvailable: () => false,
        targetAvailable: () => false,
        validateHit: () => 'combat-unavailable',
        applyDamage: () => null,
      },
      options.meleeDefinitions ? createMeleeDefinitionRegistry(options.meleeDefinitions) : undefined,
      identity,
    );
  }

  registerActor(entityId: string, input: ActorRegistration): ActorState {
    if (this.actors.size >= MAX_RETAINED_ACTORS) throw new Error('Autonomous actor limit reached.');
    if (this.actors.has(entityId)) throw new Error(`Actor already registered: ${entityId}`);
    const entity = this.options.entities.get(entityId);
    if (!entity || entity.archetype !== input.archetype || !['creature', 'npc'].includes(entity.type))
      throw new TypeError('Actor registration does not match a canonical autonomous entity.');
    const hunger = input.hunger ?? 0;
    if (!Number.isFinite(hunger) || hunger < 0 || hunger > 100) throw new TypeError('Actor hunger is invalid.');
    const actor: ActorState = {
      entityId,
      archetype: input.archetype,
      hunger,
      behavior: 'idle',
      targetEntityId: null,
      homePoiId: input.homePoiId ?? null,
      workPoiId: input.workPoiId ?? null,
      foodPoiId: input.foodPoiId ?? null,
      active: false,
      wanderIndex: 0,
    };
    this.bindActorNeeds(actor);
    this.actors.set(entityId, actor);
    updateActorActive(actor, this.options.entities, this.options.isPlayerAlive);
    return cloneActor(actor);
  }

  unregisterActor(entityId: string, reason = 'entity-removed'): ItemStack | null {
    const actor = this.actors.get(entityId);
    if (!actor) return null;
    this.cancelCombat(entityId, reason);
    if (this.actions.interruptActor(entityId, this.time, reason)) this.actionInterruptionCount += 1;
    this.actors.delete(entityId);
    return actor.archetype === 'grazer'
      ? { itemId: 'berry', count: 2 }
      : actor.archetype === 'night-stalker'
        ? { itemId: 'stone-block', count: 1 }
        : null;
  }

  getActor(entityId: string): ActorState | null {
    const actor = this.actors.get(entityId);
    return actor ? cloneActor(actor, this.combat.snapshotFor(entityId).cooldownRemainingSeconds) : null;
  }

  queryActors(): ActorState[] {
    return [...this.actors.values()].map((actor) =>
      cloneActor(actor, this.combat.snapshotFor(actor.entityId).cooldownRemainingSeconds),
    );
  }

  requestCombat(actorId: string, targetId: string, definitionId: string): CombatRequestResult {
    return this.combat.request(actorId, targetId, definitionId);
  }

  requestActorCombat(
    actorId: string,
    targetId: string,
    definitionId: string,
    existingActionId?: string,
  ): CombatRequestResult {
    const actor = this.actors.get(actorId);
    if (!actor) return { success: false, reason: 'invalid-attacker' };
    if (existingActionId) return this.combat.retain(actorId, existingActionId);
    const result = this.combat.request(actorId, targetId, definitionId, () => {
      const action = this.startAction(actorId, { type: 'attack', targetEntityId: targetId });
      this.actions.markRunning(action.id, []);
      return action.id;
    });
    if (result.success) {
      actor.behavior = 'attack';
      actor.targetEntityId = targetId;
    }
    return result;
  }

  combatSnapshotFor(actorId: string): CombatSnapshot {
    return this.combat.snapshotFor(actorId);
  }

  restoreCombatLockout(actorId: string, seconds: number): void {
    this.combat.restoreLockout(actorId, seconds);
  }

  assertCanCancelCombat(actorId: string): void {
    this.combat.assertCanCancelActor(actorId);
  }

  cancelCombat(actorId: string, reason: string): boolean {
    const cancelled = this.combat.cancelActor(actorId, reason);
    this.reconcileCombatEvents();
    return cancelled;
  }

  cancelCombatTarget(targetId: string, reason = 'target-missing', exceptActorId?: string): void {
    this.combat.cancelTarget(targetId, reason, exceptActorId);
    this.reconcileCombatEvents();
  }

  registerPoi(input: PoiInput) {
    return this.pois.register(input);
  }

  startAction(actorId: string, input: Omit<ActorActionInput, 'actorId'>): ActorAction {
    if (!this.actors.has(actorId)) throw new RangeError(`Unknown autonomous actor: ${actorId}`);
    this.interruptAction(actorId, 'replaced');
    return this.actions.start({ ...input, actorId }, this.time);
  }

  interruptAction(actorId: string, reason = 'stopped'): boolean {
    const combatCancelled = this.cancelCombat(actorId, reason);
    const actionInterrupted = this.actions.interruptActor(actorId, this.time, reason);
    if (actionInterrupted) this.actionInterruptionCount += 1;
    return combatCancelled || actionInterrupted;
  }

  observe(actorId: string, range?: number): PerceptionSnapshot {
    const actor = this.actors.get(actorId);
    if (!actor && !this.options.entities.get(actorId)) throw new RangeError(`Unknown observer: ${actorId}`);
    return this.perception.observe(actorId, range ?? (actor ? rangeByArchetype[actor.archetype] : 10));
  }

  recordAttacked(entityId: string, attackerId: string): void {
    const actor = this.actors.get(entityId);
    if (!actor) return;
    actor.behavior = 'flee';
    actor.targetEntityId = attackerId;
    this.perception.record(entityId, { type: 'attacked', subjectId: attackerId });
  }

  advanceAuthorityRules(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Actor rule seconds must be non-negative.');
    this.combat.advance(seconds);
    this.reconcileCombatEvents();
    this.stepAccumulator = round(this.stepAccumulator + seconds);
    while (this.stepAccumulator + Number.EPSILON >= STEP_SECONDS) {
      this.stepAccumulator = round(this.stepAccumulator - STEP_SECONDS);
      this.time = round(this.time + STEP_SECONDS);
      this.needsAccumulator = round(this.needsAccumulator + STEP_SECONDS);
      tickAuthorityActorRules(this.authorityRulesContext(), STEP_SECONDS);
      if (this.needsAccumulator + Number.EPSILON >= 5) {
        this.needsAccumulator = round(this.needsAccumulator - 5);
        this.actors.forEach((actor) => (actor.hunger = round(Math.min(100, actor.hunger + 1))));
      }
    }
  }

  snapshot(): SimulationSnapshot {
    return {
      version: 1,
      time: this.time,
      stepAccumulator: this.stepAccumulator,
      needsAccumulator: this.needsAccumulator,
      perceptionAccumulator: this.perceptionAccumulator,
      behaviorAccumulator: this.behaviorAccumulator,
      starterEcologyVersion: this.starterVersion,
      actors: this.queryActors(),
      pois: this.pois.snapshot(),
      actions: this.actions.snapshot(),
      combat: this.combat.snapshot(),
    };
  }

  restore(raw: unknown): void {
    try {
      const snapshot = raw as SimulationSnapshot;
      if (
        !snapshot ||
        snapshot.version !== 1 ||
        ![
          snapshot.time,
          snapshot.stepAccumulator,
          snapshot.needsAccumulator,
          snapshot.perceptionAccumulator,
          snapshot.behaviorAccumulator,
        ].every((value) => Number.isFinite(value) && value >= 0) ||
        !Number.isInteger(snapshot.starterEcologyVersion) ||
        snapshot.starterEcologyVersion < 0 ||
        !Array.isArray(snapshot.actors)
      )
        throw new TypeError('header is invalid');
      const restored = new Map<string, ActorState>();
      for (const actor of snapshot.actors) {
        this.validateActor(actor);
        const entity = this.options.entities.get(actor.entityId);
        if (!entity || entity.archetype !== actor.archetype) throw new TypeError('actor entity is missing');
        if (restored.has(actor.entityId)) throw new TypeError('duplicate actor id');
        restored.set(actor.entityId, cloneActor(actor));
      }
      this.validateCombatActionLinks(snapshot, restored);
      this.pois.restore(snapshot.pois);
      this.actions.restore(snapshot.actions);
      this.actors.clear();
      restored.forEach((actor, id) => {
        this.bindActorNeeds(actor);
        this.actors.set(id, actor);
      });
      this.time = snapshot.time;
      this.stepAccumulator = snapshot.stepAccumulator;
      this.needsAccumulator = snapshot.needsAccumulator;
      this.perceptionAccumulator = snapshot.perceptionAccumulator;
      this.behaviorAccumulator = snapshot.behaviorAccumulator;
      this.starterVersion = snapshot.starterEcologyVersion;
      this.combat.restore(snapshot.combat ?? emptyCombatRuntimeSnapshot());
      if (!snapshot.combat) {
        for (const actorId of restored.keys()) {
          const action = this.actions.forActor(actorId);
          if (action?.type === 'attack' && this.actions.interruptActor(actorId, snapshot.time, 'restore-cancelled'))
            this.actionInterruptionCount += 1;
        }
      }
      this.reconcileCombatEvents();
    } catch (error) {
      throw new Error(`Invalid simulation snapshot: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }

  set starterEcologyVersion(version: number) {
    if (!Number.isInteger(version) || version < 0) throw new TypeError('Starter ecology version is invalid.');
    this.starterVersion = version;
  }

  metrics() {
    return {
      retainedActorCount: this.actors.size,
      activeActorCount: [...this.actors.values()].filter((actor) => actor.active).length,
      behaviorEvaluationCount: this.behaviorEvaluationCount,
      navigationPlanCount: this.navigationPlanCount,
      navigationExpandedNodeCount: this.navigationExpandedNodeCount,
      pathRecomputeCount: this.pathRecomputeCount,
      actionCompletionCount: this.actionCompletionCount,
      actionFailureCount: this.actionFailureCount,
      actionInterruptionCount: this.actionInterruptionCount,
      perceptionLineOfSightCheckCount: this.perception.totalLineOfSightChecks,
      simulationTime: this.time,
    };
  }

  authorityRulesContext(): ActorAuthorityRulesContext {
    return {
      actors: this.actors,
      actions: this.actions,
      entities: this.options.entities,
      time: this.time,
      worldTime: this.options.getWorldTime(),
      updateActive: (actor) => updateActorActive(actor, this.options.entities, this.options.isPlayerAlive),
      actionTarget: (action) => resolveActionTarget(action, this.options.entities, this.pois),
      finishSuccess: (id, result) => this.finishSuccess(id, result),
      finishFailure: (id, reason) => this.finishFailure(id, reason),
    };
  }

  private bindActorNeeds(actor: ActorState): void {
    const state = this.options.entities.actorStateAccess(actor.entityId);
    state.hunger = actor.hunger;
    Object.defineProperty(actor, 'hunger', {
      enumerable: true,
      configurable: true,
      get: () => state.hunger,
      set: (value: number) => {
        state.hunger = value;
      },
    });
  }

  private finishSuccess(id: string, result?: unknown): void {
    this.actions.succeed(id, this.time, result);
    this.actionCompletionCount += 1;
    this.perception.record(this.actions.get(id)!.actorId, { type: 'action-completed', subjectId: id });
  }

  private finishFailure(id: string, reason: string): void {
    this.actions.fail(id, this.time, reason);
    this.actionFailureCount += 1;
    this.perception.record(this.actions.get(id)!.actorId, { type: 'action-failed', subjectId: id });
  }

  private validateActor(actor: ActorState): void {
    if (
      !actor.entityId?.trim() ||
      !['grazer', 'night-stalker', 'settler'].includes(actor.archetype) ||
      !Number.isFinite(actor.hunger) ||
      actor.hunger < 0 ||
      actor.hunger > 100 ||
      (actor.attackCooldownSeconds !== undefined &&
        (!Number.isFinite(actor.attackCooldownSeconds) || actor.attackCooldownSeconds < 0)) ||
      !Number.isInteger(actor.wanderIndex)
    )
      throw new TypeError('actor fields are invalid');
  }

  private validateCombatActionLinks(snapshot: SimulationSnapshot, actors: ReadonlyMap<string, ActorState>): void {
    if (!snapshot.combat || !Array.isArray(snapshot.combat.combatants) || !Array.isArray(snapshot.actions?.actions))
      return;
    const runningAttacks = new Map<string, ActorAction>();
    for (const action of snapshot.actions.actions) {
      if (
        !actors.has(action.actorId) ||
        action.type !== 'attack' ||
        ['succeeded', 'failed', 'interrupted'].includes(action.status)
      )
        continue;
      if (action.status !== 'running' || runningAttacks.has(action.actorId))
        throw new TypeError('autonomous combat action is invalid or duplicated');
      runningAttacks.set(action.actorId, action);
    }
    const activeCombatActors = new Set<string>();
    for (const entry of snapshot.combat.combatants) {
      if (!actors.has(entry.actorId) || !entry.combat?.active) continue;
      if (activeCombatActors.has(entry.actorId))
        throw new TypeError('autonomous combat action is invalid or duplicated');
      activeCombatActors.add(entry.actorId);
      const action = runningAttacks.get(entry.actorId);
      if (
        !action ||
        action.id !== entry.combat.active.actionId ||
        action.targetEntityId !== entry.combat.active.targetId
      )
        throw new TypeError('autonomous combat action does not match its running action');
      runningAttacks.delete(entry.actorId);
    }
    if (runningAttacks.size > 0) throw new TypeError('running attack action is missing autonomous combat');
  }

  private reconcileCombatEvents(): void {
    for (const event of this.combat.takeLifecycleEvents()) {
      const actor = this.actors.get(event.actorId);
      if (!actor) continue;
      const action = this.actions.forActor(event.actorId);
      if (action?.id === event.actionId) {
        if (event.status === 'cancelled') {
          if (this.actions.interruptActor(event.actorId, this.time, event.result?.reason ?? 'combat-cancelled'))
            this.actionInterruptionCount += 1;
        } else this.finishSuccess(event.actionId, event.result ?? undefined);
      }
      actor.behavior = 'idle';
      actor.targetEntityId = null;
    }
  }
}
