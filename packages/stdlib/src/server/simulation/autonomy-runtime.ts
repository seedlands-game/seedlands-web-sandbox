import { projectCombatAction } from './combat-action-snapshot';
import type { CombatAutonomyEffects } from './prepared-combat-effects';
import type { PreparedCombatMutation } from '../gameplay/prepared-combat-mutation';
import { assertCombatResultCapacity } from '../gameplay/combat-runtime-snapshot';
import type { ItemStack } from '../gameplay/item-registry';
import { ActionRuntime, type ActorAction, type ActorActionInput } from './action-runtime';
import {
  MAX_RETAINED_ACTORS,
  STEP_SECONDS,
  cloneActor,
  roundSimulation as round,
  type ActorRegistration,
  type ActorState,
  type SimulationSnapshot,
} from './actor-state';
import { GroundNavigator } from './ground-navigator';
import { PerceptionRuntime, type PerceptionSnapshot } from './perception-runtime';
import { PoiRegistry, type PoiInput } from './poi-registry';
import {
  bindActorNeeds,
  registerAutonomyActor,
  resolveActionTarget,
  restoreAutonomyCharacters,
  updateActorActive,
} from './autonomy-helpers';
import { tickAuthorityActorRules, type ActorAuthorityRulesContext } from './actor-authority-rules';
import type { EntityIdentityPort } from './action-identity';
import { createLegacyActorProfileRegistry, type ActorProfileRegistry } from '../gameplay/actor-profile';
import {
  CombatRuntime,
  createMeleeDefinitionRegistry,
  emptyCombatRuntimeSnapshot,
  listMeleeDefinitions,
  type CombatRequestResult,
  type CombatSnapshot,
} from '../gameplay/combat-runtime';
import { CharacterRuntime } from './character-runtime';
import { prepareAutonomySnapshot } from './autonomy-snapshot-validation';
import { createCharacterNavigationConstraint } from './character-navigation';
import {
  createPreparedAutonomyCancellation,
  createPreparedAutonomyCombatEffects,
  createPreparedAutonomyDeaths,
} from './autonomy-prepared-effects';
import { autonomyAdvanceCommitUpperBound } from './autonomy-advance-capacity';
import type { AutonomyRuntimeOptions as Options } from './autonomy-runtime-options';

export type { ActorBehavior, ActorRegistration, ActorState, SimulationSnapshot } from './actor-state';

export class AutonomyRuntime {
  readonly pois = new PoiRegistry();
  readonly actions: ActionRuntime;
  readonly navigator: GroundNavigator;
  readonly perception: PerceptionRuntime;
  readonly combat: CombatRuntime;
  readonly characters: CharacterRuntime | null;
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
  private readonly actorProfiles: ActorProfileRegistry;

  constructor(private readonly options: Options) {
    this.actorProfiles =
      options.actorProfiles ??
      createLegacyActorProfileRegistry(options.entities.items, options.meleeDefinitions ?? listMeleeDefinitions());
    const identity: EntityIdentityPort = {
      referenceFor: (entityId) => options.entities.createReference(entityId),
      resolve: (reference) => options.entities.resolveReference(reference)?.id ?? null,
      rebind: (reference) => {
        const current = options.entities.createReference(reference.entityId);
        return current?.lifetime === reference.lifetime ? current : null;
      },
    };
    this.actions = new ActionRuntime(options.clone, identity, () => this.characters?.retainedActionIds() ?? []);
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
      options.combatOrigin,
    );
    this.characters = options.character
      ? new CharacterRuntime({
          entities: options.entities,
          capabilities: options.character.capabilities,
          domain: options.character.domain,
          now: () => this.time,
          actor: (entityId) => this.actors.get(entityId) ?? null,
          observe: (entityId) => this.observe(entityId),
          poi: (id) => this.pois.get(id),
          action: (id) => this.actions.get(id),
          canStartAction: () => this.actions.canStart(),
          startAction: (actorId, input) => this.startCharacterAction(actorId, input),
          markActionRunning: (actionId, path) => this.actions.markRunning(actionId, path),
          setActionPathIndex: (actionId, pathIndex) => this.actions.setPathIndex(actionId, pathIndex),
          updateActionPath: (actionId, path, repathCount, target) =>
            this.actions.updatePath(actionId, path, repathCount, target),
          plan: (actorId, start, target) =>
            this.navigator.plan(start, target, {
              constraint: createCharacterNavigationConstraint({
                actorId,
                target,
                perception: this.observe(actorId),
                resolveEntity: (id) => this.options.entities.get(id),
              }),
            }),
          interruptAction: (actorId, reason) => this.interruptAction(actorId, reason),
          failAction: (actionId, reason) => this.finishFailure(actionId, reason),
          succeedAction: (actionId, result) => this.finishSuccess(actionId, result),
          clearDanger: (entityId) => {
            const actor = this.actors.get(entityId);
            if (!actor) return;
            this.interruptAction(entityId, 'danger-cleared');
            actor.behavior = 'idle';
            actor.targetEntityId = null;
          },
          worldTime: () => options.getWorldTime(),
          requestCombat: (actorId, targetId, existingActionId) =>
            this.requestCharacterCombat(actorId, targetId, existingActionId),
          changed: options.character.changed,
        })
      : null;
  }

  registerActor(entityId: string, input: ActorRegistration): ActorState {
    this.validateActorRegistration(input);
    return registerAutonomyActor(entityId, input, {
      actors: this.actors,
      entities: this.options.entities,
      profiles: this.actorProfiles,
      enforceProfiles: this.options.enforceActorProfiles,
      isPlayerAlive: this.options.isPlayerAlive,
    });
  }

  validateActorRegistration(input: ActorRegistration): void {
    if (this.actors.size >= MAX_RETAINED_ACTORS) throw new Error('Autonomous actor limit reached.');
    this.actorProfiles.require(input.archetype);
    const hunger = input.hunger ?? 0;
    if (!Number.isFinite(hunger) || hunger < 0 || hunger > 100) throw new TypeError('Actor hunger is invalid.');
  }

  prepareDeaths(ids: readonly string[]) {
    return createPreparedAutonomyDeaths(ids, this.preparedEffectsOptions());
  }

  prepareCombatEffects(combatPlan: PreparedCombatMutation, input: CombatAutonomyEffects = {}) {
    return createPreparedAutonomyCombatEffects(combatPlan, input, this.preparedEffectsOptions());
  }

  prepareInterruption(actorId: string, reason: string) {
    return this.prepareCancellation([actorId], reason, true);
  }

  prepareCancellation(actorIds: readonly string[], reason: string, interruptActions = false) {
    return createPreparedAutonomyCancellation(actorIds, reason, interruptActions, this.combat, (combat, input) =>
      this.prepareCombatEffects(combat, input),
    );
  }

  get usesRegisteredCombat(): boolean {
    return this.options.registeredCombat === true;
  }

  actorDeathDrop(entityId: string): ItemStack | null {
    const archetype = this.actors.get(entityId)?.archetype;
    const drop = archetype ? this.actorProfiles.get(archetype)?.deathDrop : undefined;
    return drop ? this.options.entities.items.normalizeStack(drop) : null;
  }

  assertCanRemoveActor(entityId: string, exceptActorId: string): void {
    const snapshot = this.combat.snapshot();
    const affected = snapshot.combatants.filter(
      ({ actorId, combat }) =>
        combat.active &&
        (actorId === entityId ||
          (actorId !== exceptActorId && combat.active.targetId === entityId && combat.active.phase === 'windup')),
    );
    assertCombatResultCapacity(snapshot.resultSequence, affected.length);
  }

  unregisterActor(entityId: string, reason = 'entity-removed'): ItemStack | null {
    const actor = this.actors.get(entityId);
    if (!actor) return null;
    const drop = this.actorDeathDrop(entityId);
    this.characters?.unregister(entityId, reason);
    this.cancelCombat(entityId, reason);
    if (this.actions.interruptActor(entityId, this.time, reason)) this.actionInterruptionCount += 1;
    this.actors.delete(entityId);
    return drop;
  }

  getActor(entityId: string): ActorState | null {
    const actor = this.actors.get(entityId);
    return actor ? cloneActor(actor, this.combat.snapshotFor(entityId).cooldownRemainingSeconds) : null;
  }

  actorIds(): readonly string[] {
    return [...this.actors.keys()];
  }

  queryActors(): ActorState[] {
    return [...this.actors.values()].map((actor) =>
      cloneActor(actor, this.combat.snapshotFor(actor.entityId).cooldownRemainingSeconds),
    );
  }

  requestCombat(actorId: string, targetId: string, definitionId: string): CombatRequestResult {
    if (this.options.registeredCombat)
      return (
        this.options.registeredCombatRequest?.(actorId, targetId) ?? { success: false, reason: 'combat-unavailable' }
      );
    return this.combat.request(actorId, targetId, definitionId);
  }

  requestActorCombat(
    actorId: string,
    targetId: string,
    definitionId: string,
    existingActionId?: string,
    controlSource: 'autonomous' | 'behavior' = 'autonomous',
  ): CombatRequestResult {
    if (this.options.entities.actorStateAccess(actorId).controlSource !== controlSource)
      return { success: false, reason: 'control-owner-mismatch' };
    if (this.options.registeredCombat)
      return (
        this.options.registeredCombatRequest?.(actorId, targetId, existingActionId) ?? {
          success: false,
          reason: 'combat-unavailable',
        }
      );
    const actor = this.actors.get(actorId);
    if (!actor) return { success: false, reason: 'invalid-attacker' };
    if (existingActionId) return this.combat.retain(actorId, existingActionId);
    const result = this.combat.request(actorId, targetId, definitionId, () => {
      const action =
        controlSource === 'behavior'
          ? this.startCharacterAction(actorId, { type: 'attack', targetEntityId: targetId })
          : this.startAction(actorId, { type: 'attack', targetEntityId: targetId });
      this.actions.markRunning(action.id, []);
      return action.id;
    });
    if (result.success) {
      actor.behavior = 'attack';
      actor.targetEntityId = targetId;
    }
    return result;
  }

  actionForActor(actorId: string) {
    return projectCombatAction(this.actions.forActor(actorId), this.combat.snapshotFor(actorId));
  }
  actionById(actionId: string) {
    const action = this.actions.get(actionId);
    return projectCombatAction(action, action ? this.combat.snapshotFor(action.actorId) : undefined);
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
    if (this.options.entities.actorStateAccess(actorId).controlSource !== 'autonomous')
      throw new Error('Autonomous control does not own this actor.');
    this.interruptAction(actorId, 'replaced');
    return this.actions.start({ ...input, actorId }, this.time);
  }

  startCharacterAction(actorId: string, input: Omit<ActorActionInput, 'actorId'>): ActorAction {
    if (!this.characters?.has(actorId)) throw new RangeError(`Unknown Character actor: ${actorId}`);
    if (this.options.entities.actorStateAccess(actorId).controlSource !== 'behavior')
      throw new Error('Behavior control does not own this actor.');
    this.interruptAction(actorId, 'replaced');
    return this.actions.start({ ...input, actorId }, this.time);
  }

  requestCharacterCombat(actorId: string, targetId: string, existingActionId?: string): CombatRequestResult {
    if (!this.characters?.has(actorId) || this.options.entities.actorStateAccess(actorId).controlSource !== 'behavior')
      return { success: false, reason: 'control-owner-mismatch' };
    return this.requestActorCombat(actorId, targetId, 'unarmed', existingActionId, 'behavior');
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
    return this.perception.observe(
      actorId,
      range ?? (actor ? this.actorProfiles.require(actor.archetype).navigation.perceptionRange : 10),
    );
  }

  recordAttacked(entityId: string, attackerId: string): void {
    const actor = this.actors.get(entityId);
    if (!actor) return;
    this.perception.record(entityId, { type: 'attacked', subjectId: attackerId });
    if (!this.characters?.has(entityId)) {
      actor.behavior = 'flee';
      actor.targetEntityId = attackerId;
    }
    this.characters?.recordAttacked(entityId, attackerId);
  }

  advanceAuthorityRules(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Actor rule seconds must be non-negative.');
    if (!this.options.registeredCombat) {
      this.combat.advance(seconds);
      this.reconcileCombatEvents();
    }
    this.stepAccumulator = round(this.stepAccumulator + seconds);
    while (this.stepAccumulator + Number.EPSILON >= STEP_SECONDS) {
      this.stepAccumulator = round(this.stepAccumulator - STEP_SECONDS);
      this.time = round(this.time + STEP_SECONDS);
      if (!this.options.registeredNeeds) this.needsAccumulator = round(this.needsAccumulator + STEP_SECONDS);
      tickAuthorityActorRules(this.authorityRulesContext(), STEP_SECONDS);
      this.characters?.advance(STEP_SECONDS);
      this.actions.pruneHistory();
      if (!this.options.registeredNeeds && this.needsAccumulator + Number.EPSILON >= 5) {
        this.needsAccumulator = round(this.needsAccumulator - 5);
        this.actors.forEach((actor) => (actor.hunger = round(Math.min(100, actor.hunger + 1))));
      }
    }
  }

  advanceCommitUpperBound(seconds: number, registeredOperationCount = 0): number {
    return autonomyAdvanceCommitUpperBound(
      seconds,
      this.stepAccumulator,
      this.characters,
      this.options.registeredCombat ?? false,
      this.combat,
      registeredOperationCount,
    );
  }

  snapshot(): SimulationSnapshot {
    const tombstones = this.characters?.tombstoneSnapshot();
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
      ...(tombstones?.characters.length ? { characterTombstones: tombstones } : {}),
    };
  }

  restore(raw: unknown): void {
    try {
      const {
        snapshot,
        actors: restored,
        actions,
      } = prepareAutonomySnapshot(raw, this.options.entities, this.actorProfiles);
      this.pois.restore(snapshot.pois);
      this.actions.restore(actions, { deferPruning: true });
      this.actors.clear();
      restored.forEach((actor, id) => {
        bindActorNeeds(actor, this.options.entities);
        this.actors.set(id, actor);
      });
      this.time = snapshot.time;
      this.stepAccumulator = snapshot.stepAccumulator;
      this.needsAccumulator = snapshot.needsAccumulator;
      this.perceptionAccumulator = snapshot.perceptionAccumulator;
      this.behaviorAccumulator = snapshot.behaviorAccumulator;
      this.starterVersion = snapshot.starterEcologyVersion;
      this.combat.restore(snapshot.combat ?? emptyCombatRuntimeSnapshot());
      restoreAutonomyCharacters(this.characters, snapshot, this.options.entities);
      this.actions.pruneHistory();
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

  private preparedEffectsOptions() {
    return {
      combat: this.combat,
      actions: this.actions,
      actors: this.actors,
      perception: this.perception,
      characters: this.characters,
      now: this.time,
      counted: (interrupted: number, completed: number) => {
        this.actionInterruptionCount += interrupted;
        this.actionCompletionCount += completed;
      },
    };
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

  private reconcileCombatEvents(): void {
    for (const event of this.combat.takeLifecycleEvents()) {
      const actor = this.actors.get(event.actorId);
      const action = this.actions.forActor(event.actorId);
      if (action?.id === event.actionId) {
        if (event.status === 'cancelled') {
          if (this.actions.interruptActor(event.actorId, this.time, event.result?.reason ?? 'combat-cancelled'))
            this.actionInterruptionCount += 1;
        } else this.finishSuccess(event.actionId, event.result ?? undefined);
      }
      if (actor && !this.characters?.has(event.actorId)) {
        actor.behavior = 'idle';
        actor.targetEntityId = null;
      }
    }
  }
}
