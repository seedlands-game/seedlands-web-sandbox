import type { EntityStore, GameplayEntity } from '../gameplay/entity-store';
import type { ItemStack } from '../gameplay/item-registry';
import { ActionRuntime, type ActorAction, type ActorActionInput, type ActorActionType } from './action-runtime';
import {
  ACTIVE_RADIUS_SQUARED,
  MAX_RETAINED_ACTORS,
  STEP_SECONDS,
  cloneActor,
  rangeByArchetype,
  roundSimulation as round,
  simulationDistanceSquared as distanceSquared,
  speedByArchetype,
  type ActorRegistration,
  type ActorState,
  type SimulationSnapshot,
} from './actor-state';
import { GroundNavigator, type NavigationPosition } from './ground-navigator';
import { PerceptionRuntime, type PerceptionSnapshot } from './perception-runtime';
import { PoiRegistry, type PoiInput } from './poi-registry';

export type { ActorBehavior, ActorRegistration, ActorState, SimulationSnapshot } from './actor-state';

type Options = {
  entities: EntityStore;
  getVoxel: (x: number, y: number, z: number) => number;
  getWorldTime: () => number;
  isPlayerAlive: (id: string) => boolean;
  damagePlayer: (actorId: string, targetId: string, amount: number) => boolean;
  consumeWorldItem: (entityId: string) => boolean;
  spawnWorldItem: (position: [number, number, number], stack: ItemStack) => void;
};

export class AutonomyRuntime {
  readonly pois = new PoiRegistry();
  readonly actions = new ActionRuntime();
  readonly navigator: GroundNavigator;
  readonly perception: PerceptionRuntime;
  private readonly actors = new Map<string, ActorState>();
  private readonly perceptions = new Map<string, PerceptionSnapshot>();
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
    this.navigator = new GroundNavigator(options.getVoxel);
    this.perception = new PerceptionRuntime({
      entities: options.entities,
      pois: this.pois,
      getVoxel: options.getVoxel,
      isPlayerAlive: options.isPlayerAlive,
    });
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
      attackCooldownSeconds: 0,
      wanderIndex: 0,
    };
    this.actors.set(entityId, actor);
    this.updateActive(actor);
    return cloneActor(actor);
  }

  unregisterActor(entityId: string, reason = 'entity-removed'): ItemStack | null {
    const actor = this.actors.get(entityId);
    if (!actor) return null;
    if (this.actions.interruptActor(entityId, this.time, reason)) this.actionInterruptionCount += 1;
    this.actors.delete(entityId);
    this.perceptions.delete(entityId);
    return actor.archetype === 'grazer'
      ? { itemId: 'berry', count: 2 }
      : actor.archetype === 'night-stalker'
        ? { itemId: 'stone-block', count: 1 }
        : null;
  }

  getActor(entityId: string): ActorState | null {
    const actor = this.actors.get(entityId);
    return actor ? cloneActor(actor) : null;
  }

  queryActors(): ActorState[] {
    return [...this.actors.values()].map(cloneActor);
  }

  registerPoi(input: PoiInput) {
    return this.pois.register(input);
  }

  startAction(actorId: string, input: Omit<ActorActionInput, 'actorId'>): ActorAction {
    if (!this.actors.has(actorId)) throw new RangeError(`Unknown autonomous actor: ${actorId}`);
    if (this.actions.forActor(actorId) && this.actions.interruptActor(actorId, this.time, 'replaced'))
      this.actionInterruptionCount += 1;
    return this.actions.start({ ...input, actorId }, this.time);
  }

  interruptAction(actorId: string, reason = 'stopped'): boolean {
    const interrupted = this.actions.interruptActor(actorId, this.time, reason);
    if (interrupted) this.actionInterruptionCount += 1;
    return interrupted;
  }

  observe(actorId: string, range?: number): PerceptionSnapshot {
    const actor = this.actors.get(actorId);
    if (!actor && !this.options.entities.get(actorId)) throw new RangeError(`Unknown observer: ${actorId}`);
    const observation = this.perception.observe(actorId, range ?? (actor ? rangeByArchetype[actor.archetype] : 10));
    this.perceptions.set(actorId, observation);
    return structuredClone(observation);
  }

  recordAttacked(entityId: string, attackerId: string): void {
    if (!this.actors.has(entityId)) return;
    this.perception.record(entityId, { type: 'attacked', subjectId: attackerId });
  }

  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Simulation seconds must be non-negative.');
    this.stepAccumulator = round(this.stepAccumulator + seconds);
    while (this.stepAccumulator + Number.EPSILON >= STEP_SECONDS) {
      this.stepAccumulator = round(this.stepAccumulator - STEP_SECONDS);
      this.time = round(this.time + STEP_SECONDS);
      this.tickStep();
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
      this.pois.restore(snapshot.pois);
      this.actions.restore(snapshot.actions);
      this.actors.clear();
      restored.forEach((actor, id) => this.actors.set(id, actor));
      this.time = snapshot.time;
      this.stepAccumulator = snapshot.stepAccumulator;
      this.needsAccumulator = snapshot.needsAccumulator;
      this.perceptionAccumulator = snapshot.perceptionAccumulator;
      this.behaviorAccumulator = snapshot.behaviorAccumulator;
      this.starterVersion = snapshot.starterEcologyVersion;
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

  private tickStep(): void {
    this.needsAccumulator = round(this.needsAccumulator + STEP_SECONDS);
    this.perceptionAccumulator = round(this.perceptionAccumulator + STEP_SECONDS);
    this.behaviorAccumulator = round(this.behaviorAccumulator + STEP_SECONDS);
    this.actors.forEach((actor) => {
      this.updateActive(actor);
      actor.attackCooldownSeconds = round(Math.max(0, actor.attackCooldownSeconds - STEP_SECONDS));
      if (actor.active) this.advanceMovement(actor);
    });
    if (this.needsAccumulator + Number.EPSILON >= 5) {
      this.needsAccumulator = round(this.needsAccumulator - 5);
      this.actors.forEach((actor) => (actor.hunger = round(Math.min(100, actor.hunger + 1))));
    }
    if (this.perceptionAccumulator + Number.EPSILON >= 0.5) {
      this.perceptionAccumulator = round(this.perceptionAccumulator - 0.5);
      this.actors.forEach((actor) => {
        if (actor.active)
          this.perceptions.set(
            actor.entityId,
            this.perception.observe(actor.entityId, rangeByArchetype[actor.archetype]),
          );
      });
    }
    if (this.behaviorAccumulator + Number.EPSILON >= 1) {
      this.behaviorAccumulator = round(this.behaviorAccumulator - 1);
      this.actors.forEach((actor) => {
        if (!actor.active) return;
        this.behaviorEvaluationCount += 1;
        this.evaluate(actor, this.perceptions.get(actor.entityId) ?? this.observe(actor.entityId));
      });
    }
  }

  private evaluate(actor: ActorState, perception: PerceptionSnapshot): void {
    const entity = this.options.entities.get(actor.entityId);
    if (!entity) return;
    const threat = perception.threats[0];
    const attacked = perception.observations.find((event) => event.type === 'attacked');
    if ((threat || attacked) && actor.archetype !== 'night-stalker') {
      const source = this.options.entities.get(threat?.entityId ?? attacked!.subjectId);
      const target = this.fleeTarget(entity.position, source?.position);
      actor.behavior = 'flee';
      actor.targetEntityId = source?.id ?? null;
      this.ensureAction(actor, 'flee', { targetPosition: target });
      return;
    }
    if (actor.archetype === 'grazer') return this.evaluateGrazer(actor, entity, perception);
    if (actor.archetype === 'night-stalker') return this.evaluateHostile(actor, entity, perception);
    this.evaluateSettler(actor, entity);
  }

  private evaluateGrazer(actor: ActorState, entity: GameplayEntity, perception: PerceptionSnapshot): void {
    const food = perception.food[0];
    if (actor.hunger >= 50 && food) {
      actor.behavior = 'seek-food';
      actor.targetEntityId = food.entityId;
      if (food.distance <= 1.1) return this.consumeFood(actor, food.entityId);
      this.ensureAction(actor, 'eat', { targetEntityId: food.entityId });
      return;
    }
    actor.targetEntityId = null;
    this.ensureWander(actor, entity);
  }

  private evaluateHostile(actor: ActorState, entity: GameplayEntity, perception: PerceptionSnapshot): void {
    const hour = this.options.getWorldTime();
    const night = hour >= 18 || hour < 6;
    const target = night ? perception.threats[0] : undefined;
    if (!target) {
      actor.targetEntityId = null;
      if (actor.homePoiId && !this.atPoi(entity, actor.homePoiId)) {
        actor.behavior = 'wander';
        this.ensureAction(actor, 'go-to-poi', { poiId: actor.homePoiId });
      } else {
        actor.behavior = 'idle';
        this.interruptAction(actor.entityId, 'no-night-target');
      }
      return;
    }
    actor.targetEntityId = target.entityId;
    if (target.distance <= 1.7) {
      actor.behavior = 'attack';
      if (actor.attackCooldownSeconds <= 0) {
        const action = this.startAction(actor.entityId, { type: 'attack', targetEntityId: target.entityId });
        if (this.options.damagePlayer(actor.entityId, target.entityId, 2)) {
          actor.attackCooldownSeconds = 1;
          this.finishSuccess(action.id, { damage: 2 });
        } else this.finishFailure(action.id, 'target-unavailable');
      }
      return;
    }
    actor.behavior = 'chase';
    this.ensureAction(actor, 'move-to', { targetEntityId: target.entityId });
  }

  private evaluateSettler(actor: ActorState, entity: GameplayEntity): void {
    if (actor.hunger >= 60 && actor.foodPoiId) {
      actor.behavior = 'seek-food';
      if (this.atPoi(entity, actor.foodPoiId)) actor.hunger = 0;
      else this.ensureAction(actor, 'go-to-poi', { poiId: actor.foodPoiId });
      return;
    }
    const hour = this.options.getWorldTime();
    const daytime = hour >= 6 && hour < 18;
    const poiId = daytime ? actor.workPoiId : actor.homePoiId;
    actor.behavior = daytime ? 'routine-work' : 'routine-home';
    actor.targetEntityId = null;
    if (poiId && !this.atPoi(entity, poiId)) this.ensureAction(actor, 'go-to-poi', { poiId });
    else if (!poiId) this.ensureWander(actor, entity);
  }

  private advanceMovement(actor: ActorState): void {
    const action = this.actions.forActor(actor.entityId);
    if (!action || action.type === 'attack' || action.type === 'idle') return;
    if (action.status === 'pending') {
      if (!this.planAction(action)) return;
    }
    const current = this.actions.forActor(actor.entityId);
    if (!current || current.status !== 'running') return;
    if (current.pathIndex >= current.path.length) return this.arrive(actor, current);
    const next = current.path[current.pathIndex];
    if (!this.navigator.isPathStepValid(next)) return this.repath(current);
    const entity = this.options.entities.get(actor.entityId);
    if (!entity) return this.finishFailure(current.id, 'actor-missing');
    const delta = next.map((value, index) => value - entity.position[index]);
    const length = Math.sqrt(delta.reduce((sum, value) => sum + value ** 2, 0));
    const travel = speedByArchetype[actor.archetype] * STEP_SECONDS;
    if (length <= travel + Number.EPSILON) {
      this.options.entities.move(actor.entityId, [...next]);
      this.actions.setPathIndex(current.id, current.pathIndex + 1);
      if (current.pathIndex + 1 >= current.path.length) this.arrive(actor, this.actions.get(current.id)!);
      return;
    }
    this.options.entities.move(actor.entityId, [
      round(entity.position[0] + (delta[0] / length) * travel),
      round(entity.position[1] + (delta[1] / length) * travel),
      round(entity.position[2] + (delta[2] / length) * travel),
    ]);
  }

  private planAction(action: ActorAction): boolean {
    const entity = this.options.entities.get(action.actorId);
    const target = this.actionTarget(action);
    if (!entity || !target) {
      this.finishFailure(action.id, entity ? 'target-missing' : 'actor-missing');
      return false;
    }
    const result = this.navigator.plan(entity.position, target, { maxExpanded: 384 });
    this.navigationPlanCount += 1;
    this.navigationExpandedNodeCount += result.expandedNodes;
    if (result.status !== 'reached') {
      this.finishFailure(action.id, result.status);
      return false;
    }
    this.actions.markRunning(action.id, result.path);
    if (result.path.length <= 1) this.arrive(this.requireActor(action.actorId), this.actions.get(action.id)!);
    return true;
  }

  private repath(action: ActorAction): void {
    const count = action.repathCount + 1;
    this.pathRecomputeCount += 1;
    if (count > 3) return this.finishFailure(action.id, 'path-invalidated');
    const entity = this.options.entities.get(action.actorId);
    const target = this.actionTarget(action);
    if (!entity || !target) return this.finishFailure(action.id, 'target-missing');
    const result = this.navigator.plan(entity.position, target, { maxExpanded: 384 });
    this.navigationPlanCount += 1;
    this.navigationExpandedNodeCount += result.expandedNodes;
    if (result.status !== 'reached') {
      if (count >= 3) return this.finishFailure(action.id, result.status);
      this.actions.updatePath(action.id, [entity.position], count);
      return;
    }
    this.actions.updatePath(action.id, result.path, count);
  }

  private arrive(actor: ActorState, action: ActorAction): void {
    if (action.type === 'eat' && action.targetEntityId) this.consumeFood(actor, action.targetEntityId, action.id);
    else {
      if (action.type === 'go-to-poi' && action.poiId === actor.foodPoiId) actor.hunger = 0;
      this.finishSuccess(action.id, { position: this.options.entities.get(actor.entityId)?.position });
    }
  }

  private consumeFood(actor: ActorState, entityId: string, actionId?: string): void {
    if (!this.options.consumeWorldItem(entityId)) {
      if (actionId) this.finishFailure(actionId, 'food-missing');
      return;
    }
    actor.hunger = 0;
    actor.targetEntityId = null;
    if (actionId) this.finishSuccess(actionId, { consumedEntityId: entityId });
  }

  private ensureWander(actor: ActorState, entity: GameplayEntity): void {
    actor.behavior = 'wander';
    const current = this.actions.forActor(actor.entityId);
    if (current) return;
    actor.wanderIndex += 1;
    const target = this.wanderTarget(entity, actor.wanderIndex);
    this.startAction(actor.entityId, { type: 'wander', targetPosition: target });
  }

  private ensureAction(
    actor: ActorState,
    type: ActorActionType,
    target: Partial<Pick<ActorActionInput, 'targetPosition' | 'targetEntityId' | 'poiId'>>,
  ): void {
    const current = this.actions.forActor(actor.entityId);
    if (
      current?.type === type &&
      current.targetEntityId === target.targetEntityId &&
      current.poiId === target.poiId &&
      JSON.stringify(current.targetPosition) === JSON.stringify(target.targetPosition)
    )
      return;
    this.startAction(actor.entityId, { type, ...target });
  }

  private actionTarget(action: ActorAction): NavigationPosition | null {
    if (action.targetPosition) return [...action.targetPosition];
    if (action.targetEntityId) return this.options.entities.get(action.targetEntityId)?.position ?? null;
    if (action.poiId) return this.pois.get(action.poiId)?.position ?? null;
    return null;
  }

  private atPoi(entity: GameplayEntity, poiId: string): boolean {
    const poi = this.pois.get(poiId);
    return Boolean(poi && distanceSquared(entity.position, poi.position) <= 0.8 ** 2);
  }

  private fleeTarget(
    from: readonly [number, number, number],
    threat?: readonly [number, number, number],
  ): NavigationPosition {
    const dx = threat ? from[0] - threat[0] : 1;
    const dz = threat ? from[2] - threat[2] : 0;
    const length = Math.hypot(dx, dz) || 1;
    return [from[0] + (dx / length) * 6, from[1], from[2] + (dz / length) * 6];
  }

  private wanderTarget(entity: GameplayEntity, index: number): NavigationPosition {
    const seed = [...entity.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) + index;
    const [dx, dz] = [
      [3, 0],
      [0, 3],
      [-3, 0],
      [0, -3],
    ][seed % 4];
    return [entity.position[0] + dx, entity.position[1], entity.position[2] + dz];
  }

  private updateActive(actor: ActorState): void {
    const entity = this.options.entities.get(actor.entityId);
    actor.active = Boolean(
      entity &&
      this.options.entities
        .query({ type: 'player' })
        .some(
          (player) =>
            this.options.isPlayerAlive(player.id) &&
            distanceSquared(entity.position, player.position) <= ACTIVE_RADIUS_SQUARED,
        ),
    );
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

  private requireActor(entityId: string): ActorState {
    const actor = this.actors.get(entityId);
    if (!actor) throw new RangeError(`Unknown autonomous actor: ${entityId}`);
    return actor;
  }

  private validateActor(actor: ActorState): void {
    if (
      !actor.entityId?.trim() ||
      !['grazer', 'night-stalker', 'settler'].includes(actor.archetype) ||
      !Number.isFinite(actor.hunger) ||
      actor.hunger < 0 ||
      actor.hunger > 100 ||
      !Number.isFinite(actor.attackCooldownSeconds) ||
      !Number.isInteger(actor.wanderIndex)
    )
      throw new TypeError('actor fields are invalid');
  }
}
