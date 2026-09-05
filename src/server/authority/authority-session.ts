import {
  bodyWorldAabb,
  isBodyPositionReachable,
  probeBodyContacts,
  recoverBody,
  selectReachableBodyTarget,
  separateBodies,
  stepBody,
  type BodyConfig,
  type BodyState,
  type PhysicsInput,
} from '../../physics';
import { ActiveMonotonicClock } from '../../runtime/active-monotonic-clock';
import { BoundedCostSamples } from '../../runtime/bounded-cost-samples';
import { MultiRateScheduler } from '../../runtime/multi-rate-scheduler';
import { InputCommandBuffer, type InputCommand, type SequenceDecision } from '../../runtime/session-protocol';
import type {
  AuthorityBodySnapshot,
  AuthorityEntity,
  AuthorityLaneTotals,
  AuthorityServerPort,
  AuthoritySnapshot,
  BodyRecoveryDiagnostic,
  BodyRecoveryReason,
  LogicIntent,
} from './authority-session-types';
import { VoxelCollisionWorld, type LoadedVoxelSource } from './voxel-collision-world';

export type * from './authority-session-types';

type AuthoritySessionOptions = Readonly<{
  epoch: string;
  playerId: string;
  server: AuthorityServerPort;
  bodyConfigFor: (entity: AuthorityEntity) => BodyConfig;
  voxelSource: LoadedVoxelSource;
  frequencies: Readonly<{ physicsHz: number; gameplayHz: number; fluidHz: number }>;
  startTimeMs: number;
  requestUnknownChunk?: (chunkKey: string) => void;
  requestFluidWork?: (elapsedPeriods: number) => void;
  publishLogicObservation?: (snapshot: AuthoritySnapshot) => void;
  worldHoursPerSecond?: number;
  initialCommitSequence?: number;
  measureNow?: () => number;
}>;

const toBodyState = (entity: AuthorityEntity): BodyState => ({
  position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
  velocity: {
    x: entity.physicsVelocity?.[0] ?? 0,
    y: entity.physicsVelocity?.[1] ?? 0,
    z: entity.physicsVelocity?.[2] ?? 0,
  },
});

const ZERO_PHYSICS_INPUT: PhysicsInput = {
  wish: { x: 0, z: 0 },
  jumpPressed: false,
  verticalIntent: 0,
};
const MAX_RECOVERY_QUEUE = 512;
const MAX_RECOVERY_RESULTS = 32;
const MAX_RECOVERY_DISTANCE = 8;
const MAX_RECOVERIES_PER_STEP = 4;
const CHARACTER_SEPARATION_DISTANCE = 0.1;
const ITEM_ATTRACTION_RADIUS = 2.25;
const ITEM_ATTRACTION_SPEED = 6;
const ITEM_PICKUP_RADIUS = 0.75;
const MAX_PICKUP_TARGET_CANDIDATES = 8;
const MAX_TRACKED_PICKUP_CURSORS = 512;
const PICKUP_CURSOR_WRAP = 0x80000000;
const ITEM_PICKUP_RETRY_TICKS = 15;

const distanceSquared = (left: readonly number[], right: readonly number[]): number =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

const isCharacter = (entity: AuthorityEntity): boolean =>
  entity.type === 'player' || entity.type === 'creature' || entity.type === 'npc';

export class AuthoritySession {
  private readonly clock: ActiveMonotonicClock;
  private readonly physicsCost = new BoundedCostSamples();
  private readonly scheduler: MultiRateScheduler;
  private readonly input: InputCommandBuffer;
  private readonly collisionWorld: VoxelCollisionWorld;
  private readonly bodies = new Map<string, AuthorityBodySnapshot>();
  private readonly logicIntents = new Map<string, LogicIntent>();
  private readonly recoveryQueue = new Map<string, Readonly<{ reason: BodyRecoveryReason; maxDistance: number }>>();
  private readonly recoveryResults: BodyRecoveryDiagnostic[] = [];
  private readonly pickupAttempts = new Map<string, number>();
  private readonly pickupTargetCursors = new Map<string, number>();
  private physicsTick = 0;
  private gameplayPeriods = 0;
  private fluidPeriods = 0;
  private commitSequence: number;
  private activeTimeMs = 0;
  private integratedPhysicsTimeMs = 0;
  private physicsDebtMs = 0;
  private worldClockRate: number;

  constructor(private readonly options: AuthoritySessionOptions) {
    this.commitSequence = options.initialCommitSequence ?? 0;
    if (!Number.isSafeInteger(this.commitSequence) || this.commitSequence < 0)
      throw new RangeError('Initial commit sequence must be a non-negative safe integer.');
    this.worldClockRate = options.worldHoursPerSecond ?? 0.04;
    this.assertWorldClockRate(this.worldClockRate);
    this.clock = new ActiveMonotonicClock(options.startTimeMs);
    this.scheduler = new MultiRateScheduler({ ...options.frequencies, maxPhysicsCatchUpSteps: 4 });
    this.input = new InputCommandBuffer(options.epoch, 'player-input');
    this.collisionWorld = new VoxelCollisionWorld(options.voxelSource, options.requestUnknownChunk);
    this.refreshBodies();
    for (const id of this.bodies.keys()) this.requestBodyRecovery(id, 'initialization', 2);
  }

  receiveInput(command: InputCommand): SequenceDecision {
    return this.input.push(command);
  }

  receiveLogicIntents(epoch: string, intents: readonly LogicIntent[]) {
    if (epoch !== this.options.epoch) return false;
    intents.forEach((intent) => {
      if (intent.expiresAtPhysicsTick >= this.physicsTick) this.logicIntents.set(intent.entityId, intent);
    });
    return true;
  }

  requestBodyRecovery(entityId: string, reason: BodyRecoveryReason, maxDistance: number): boolean {
    if (!entityId || !['initialization', 'legacy-restore', 'external-geometry-change'].includes(reason))
      throw new TypeError('身体恢复请求必须包含实体和受支持的原因。');
    if (!Number.isFinite(maxDistance) || maxDistance < 0 || maxDistance > MAX_RECOVERY_DISTANCE)
      throw new RangeError(`身体恢复距离必须位于 0..${MAX_RECOVERY_DISTANCE}。`);
    if (!this.recoveryQueue.has(entityId) && this.recoveryQueue.size >= MAX_RECOVERY_QUEUE) return false;
    this.recoveryQueue.set(entityId, { reason, maxDistance });
    return true;
  }

  wake(nowMs: number): AuthoritySnapshot {
    const clock = this.clock.sample(nowMs);
    this.activeTimeMs = clock.activeTimeMs;
    if (clock.paused) return this.snapshot();
    const due = this.scheduler.advanceTo(clock.activeTimeMs);
    for (const step of due.physicsSteps) {
      this.physicsTick = step.tick;
      const startedAt = this.options.measureNow?.();
      this.stepPhysics(step.dtSeconds);
      if (startedAt !== undefined) this.physicsCost.record(this.options.measureNow!() - startedAt);
    }
    this.integratedPhysicsTimeMs = due.integratedPhysicsTimeMs;
    this.physicsDebtMs = due.physicsDebtMs;
    if (due.gameplay.due) {
      this.gameplayPeriods += due.gameplay.elapsedPeriods;
      const gameplaySeconds = due.gameplay.elapsedPeriods / this.options.frequencies.gameplayHz;
      this.options.server.advanceWorldClock?.(gameplaySeconds * this.worldClockRate);
      this.options.server.advanceGameplayRules(gameplaySeconds);
      this.commitSequence += 1;
    }
    if (due.fluid.due) {
      this.fluidPeriods += due.fluid.elapsedPeriods;
      this.options.requestFluidWork?.(due.fluid.elapsedPeriods);
    }
    const snapshot = this.snapshot();
    if (due.gameplay.due) this.options.publishLogicObservation?.(snapshot);
    return snapshot;
  }

  pause(nowMs: number) {
    this.clock.pause(nowMs);
    this.input.clear();
    this.stopPlayerHorizontalVelocity();
  }

  resume(nowMs: number) {
    this.clock.resume(nowMs);
  }

  get currentCommitSequence() {
    return this.commitSequence;
  }

  get laneTotals(): AuthorityLaneTotals {
    return {
      physicsSteps: this.physicsTick,
      gameplayPeriods: this.gameplayPeriods,
      fluidPeriods: this.fluidPeriods,
    };
  }

  setWorldClockRate(rate: number): number {
    this.assertWorldClockRate(rate);
    if (rate === this.worldClockRate) return rate;
    this.worldClockRate = rate;
    this.commitSequence += 1;
    return rate;
  }

  get inputResyncRequired() {
    return this.input.requiresResync;
  }

  commitExternalState(refreshBodies = true) {
    if (refreshBodies) this.refreshBodies();
    this.commitSequence += 1;
    return this.commitSequence;
  }

  synchronizeExternalState() {
    this.refreshBodies();
    this.commitSequence += 1;
  }

  private stepPhysics(dt: number) {
    this.processRecoveryQueue();
    const input = this.input.consumeForTick(this.physicsTick);
    const entities = this.options.server.queryEntities().sort((left, right) => left.id.localeCompare(right.id));
    const pickupTargets = [...(this.options.server.queryPickupTargets?.() ?? [])].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const physicsTargets = pickupTargets.map((target) => ({
      id: target.id,
      position: { x: target.position[0], y: target.position[1], z: target.position[2] },
    }));
    const selectedTargets = new Map<string, string>();
    const seen = new Set<string>();
    const worldItemIds = new Set<string>();
    const nextBodies = new Map<string, AuthorityBodySnapshot>();
    const configs = new Map<string, BodyConfig>();
    for (const entity of entities) {
      seen.add(entity.id);
      const config = this.options.bodyConfigFor(entity);
      configs.set(entity.id, config);
      const physicsInput = this.physicsInput(entity, input);
      const initialState = toBodyState(entity);
      const trackPickupCursor =
        entity.type === 'world-item' &&
        (this.pickupTargetCursors.has(entity.id) || this.pickupTargetCursors.size < MAX_TRACKED_PICKUP_CURSORS);
      const pickupCursor =
        this.pickupTargetCursors.get(entity.id) ??
        (trackPickupCursor
          ? 0
          : ((this.physicsTick - 1) % (PICKUP_CURSOR_WRAP / MAX_PICKUP_TARGET_CANDIDATES)) *
            MAX_PICKUP_TARGET_CANDIDATES);
      const target =
        entity.type === 'world-item'
          ? selectReachableBodyTarget({
              state: initialState,
              config,
              world: this.collisionWorld,
              targets: physicsTargets,
              maxDistance: ITEM_ATTRACTION_RADIUS,
              maxCandidates: MAX_PICKUP_TARGET_CANDIDATES,
              startIndex: pickupCursor,
            })
          : null;
      if (entity.type === 'world-item') {
        worldItemIds.add(entity.id);
        if (trackPickupCursor)
          this.pickupTargetCursors.set(
            entity.id,
            target ? pickupCursor : (pickupCursor + MAX_PICKUP_TARGET_CANDIDATES) % PICKUP_CURSOR_WRAP,
          );
      }
      if (target) selectedTargets.set(entity.id, target.id);
      const attraction = target ? this.itemAttraction(initialState, target.position) : null;
      const result = stepBody({
        state: initialState,
        config: attraction ? { ...config, groundAcceleration: 0, airAcceleration: 0 } : config,
        input: attraction
          ? {
              ...ZERO_PHYSICS_INPUT,
              externalAcceleration: {
                x: (attraction.x - initialState.velocity.x) / dt,
                y: (attraction.y - initialState.velocity.y) / dt,
                z: (attraction.z - initialState.velocity.z) / dt,
              },
            }
          : physicsInput,
        world: this.collisionWorld,
        dt,
      });
      nextBodies.set(entity.id, {
        id: entity.id,
        type: entity.type,
        ...(entity.archetype ? { archetype: entity.archetype } : {}),
        body: result.state,
        grounded: result.grounded,
        contacts: result.contacts,
      });
    }

    const characters = entities.filter(isCharacter);
    for (let leftIndex = 0; leftIndex < characters.length; leftIndex += 1)
      for (let rightIndex = leftIndex + 1; rightIndex < characters.length; rightIndex += 1) {
        const leftEntity = characters[leftIndex];
        const rightEntity = characters[rightIndex];
        const left = nextBodies.get(leftEntity.id)!;
        const right = nextBodies.get(rightEntity.id)!;
        const separation = separateBodies({
          left: left.body,
          leftConfig: configs.get(left.id)!,
          right: right.body,
          rightConfig: configs.get(right.id)!,
          world: this.collisionWorld,
          maxDistance: CHARACTER_SEPARATION_DISTANCE,
        });
        nextBodies.set(left.id, this.afterSeparation(left, separation.left, configs.get(left.id)!));
        nextBodies.set(right.id, this.afterSeparation(right, separation.right, configs.get(right.id)!));
      }

    for (const entity of entities) {
      const body = nextBodies.get(entity.id)!;
      this.options.server.updateEntity(entity.id, {
        position: [body.body.position.x, body.body.position.y, body.body.position.z],
        physicsVelocity: [body.body.velocity.x, body.body.velocity.y, body.body.velocity.z],
      });
      this.bodies.set(entity.id, body);
    }
    this.processPickups(selectedTargets);
    for (const id of this.bodies.keys()) if (!seen.has(id)) this.bodies.delete(id);
    for (const id of this.pickupTargetCursors.keys()) if (!worldItemIds.has(id)) this.pickupTargetCursors.delete(id);
    this.commitSequence += 1;
  }

  private afterSeparation(snapshot: AuthorityBodySnapshot, body: BodyState, config: BodyConfig): AuthorityBodySnapshot {
    if (snapshot.body === body) return snapshot;
    const probe = probeBodyContacts({ state: body, config, world: this.collisionWorld });
    return { ...snapshot, body, grounded: probe.grounded, contacts: probe.contacts };
  }

  private itemAttraction(state: BodyState, target: BodyState['position']): BodyState['velocity'] | null {
    const delta = {
      x: target.x - state.position.x,
      y: target.y - state.position.y,
      z: target.z - state.position.z,
    };
    const distance = Math.hypot(delta.x, delta.y, delta.z);
    if (distance <= Number.EPSILON) return null;
    return {
      x: (delta.x / distance) * ITEM_ATTRACTION_SPEED,
      y: (delta.y / distance) * ITEM_ATTRACTION_SPEED,
      z: (delta.z / distance) * ITEM_ATTRACTION_SPEED,
    };
  }

  private processPickups(selectedTargets: ReadonlyMap<string, string>): void {
    const entities = this.options.server.queryEntities().sort((left, right) => left.id.localeCompare(right.id));
    const entityIds = new Set(entities.map((entity) => entity.id));
    const targets = [...(this.options.server.queryPickupTargets?.() ?? [])].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    for (const attempt of this.pickupAttempts.keys()) {
      const [itemId, targetId] = attempt.split('\0');
      const item = entities.find((entity) => entity.id === itemId);
      const target = targets.find((candidate) => candidate.id === targetId);
      if (
        !item ||
        !target ||
        selectedTargets.get(itemId) !== targetId ||
        distanceSquared(item.position, target.position) > ITEM_PICKUP_RADIUS ** 2
      )
        this.pickupAttempts.delete(attempt);
    }
    if (!this.options.server.pickupItem) return;
    for (const item of entities.filter((entity) => entity.type === 'world-item')) {
      const target = targets.find((candidate) => candidate.id === selectedTargets.get(item.id));
      if (!target || distanceSquared(item.position, target.position) > ITEM_PICKUP_RADIUS ** 2) continue;
      const body = this.bodies.get(item.id);
      if (!body) continue;
      const targetPosition = { x: target.position[0], y: target.position[1], z: target.position[2] };
      if (!isBodyPositionReachable(body.body, this.options.bodyConfigFor(item), this.collisionWorld, targetPosition))
        continue;
      const attempt = `${item.id}\0${target.id}`;
      const previousTick = this.pickupAttempts.get(attempt);
      if (previousTick !== undefined && this.physicsTick - previousTick < ITEM_PICKUP_RETRY_TICKS) continue;
      this.pickupAttempts.set(attempt, this.physicsTick);
      if (this.options.server.pickupItem(target.id, item.id).success) {
        this.bodies.delete(item.id);
        entityIds.delete(item.id);
      }
    }
    for (const id of this.bodies.keys()) if (!entityIds.has(id)) this.bodies.delete(id);
  }

  private processRecoveryQueue(): void {
    const requests = [...this.recoveryQueue]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, MAX_RECOVERIES_PER_STEP);
    for (const [entityId, request] of requests) {
      this.recoveryQueue.delete(entityId);
      const entity = this.options.server.getEntity(entityId);
      if (!entity) {
        this.recordRecovery({
          entityId,
          reason: request.reason,
          status: 'missing',
          distance: 0,
          physicsTick: this.physicsTick,
        });
        continue;
      }
      const state = toBodyState(entity);
      const config = this.options.bodyConfigFor(entity);
      if (!this.overlapsStatic(state, config)) {
        this.recordRecovery({
          entityId,
          reason: request.reason,
          status: 'recovered',
          distance: 0,
          physicsTick: this.physicsTick,
        });
        continue;
      }
      const result = recoverBody({ state, config, world: this.collisionWorld, maxDistance: request.maxDistance });
      if (result.recovered)
        this.options.server.updateEntity(entityId, {
          position: [result.state.position.x, result.state.position.y, result.state.position.z],
          physicsVelocity: [result.state.velocity.x, result.state.velocity.y, result.state.velocity.z],
        });
      this.recordRecovery({
        entityId,
        reason: request.reason,
        status: result.recovered ? 'recovered' : 'blocked',
        distance: result.recovered ? result.distance : 0,
        physicsTick: this.physicsTick,
      });
    }
  }

  private overlapsStatic(state: BodyState, config: BodyConfig): boolean {
    const bounds = bodyWorldAabb(state, config);
    return this.collisionWorld
      .querySolids(bounds)
      .some(
        (collider) =>
          Math.min(bounds.max.x, collider.aabb.max.x) - Math.max(bounds.min.x, collider.aabb.min.x) > 1e-6 &&
          Math.min(bounds.max.y, collider.aabb.max.y) - Math.max(bounds.min.y, collider.aabb.min.y) > 1e-6 &&
          Math.min(bounds.max.z, collider.aabb.max.z) - Math.max(bounds.min.z, collider.aabb.min.z) > 1e-6,
      );
  }

  private recordRecovery(result: BodyRecoveryDiagnostic): void {
    this.recoveryResults.push(result);
    if (this.recoveryResults.length > MAX_RECOVERY_RESULTS)
      this.recoveryResults.splice(0, this.recoveryResults.length - MAX_RECOVERY_RESULTS);
  }

  private physicsInput(
    entity: AuthorityEntity,
    playerInput: ReturnType<InputCommandBuffer['consumeForTick']>,
  ): PhysicsInput {
    if (entity.id === this.options.playerId) {
      return {
        wish: { x: playerInput.state.moveX, z: playerInput.state.moveZ },
        jumpPressed: playerInput.jumpRequested,
        verticalIntent: playerInput.state.verticalIntent,
      };
    }
    const intent = this.logicIntents.get(entity.id);
    if (!intent || intent.expiresAtPhysicsTick < this.physicsTick) {
      this.logicIntents.delete(entity.id);
      return { wish: { x: 0, z: 0 }, jumpPressed: false, verticalIntent: 0 };
    }
    return { wish: intent.wish, jumpPressed: intent.jumpRequested, verticalIntent: intent.verticalIntent };
  }

  private refreshBodies() {
    this.options.server.queryEntities().forEach((entity) => {
      this.bodies.set(entity.id, {
        id: entity.id,
        type: entity.type,
        ...(entity.archetype ? { archetype: entity.archetype } : {}),
        body: toBodyState(entity),
        grounded: false,
        contacts: [],
      });
    });
  }

  private stopPlayerHorizontalVelocity() {
    const entity = this.options.server.getEntity(this.options.playerId);
    if (!entity) return;
    const velocity: [number, number, number] = [0, entity.physicsVelocity?.[1] ?? 0, 0];
    this.options.server.updateEntity(entity.id, { position: [...entity.position], physicsVelocity: velocity });
    this.refreshBodies();
  }

  private assertWorldClockRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0 || rate > 24)
      throw new RangeError('World clock rate must be finite and within 0..24 hours per second.');
  }

  private snapshot(): AuthoritySnapshot {
    const player = this.bodies.get(this.options.playerId);
    if (!player) throw new Error(`Authority player is missing: ${this.options.playerId}`);
    return {
      kind: 'snapshot',
      protocolVersion: 1,
      epoch: this.options.epoch,
      physicsTick: this.physicsTick,
      commitSequence: this.commitSequence,
      acknowledgedInputSequence: this.input.acknowledgedSequence,
      inputResyncRequired: this.input.requiresResync,
      activeTimeMs: this.activeTimeMs,
      integratedPhysicsTimeMs: this.integratedPhysicsTimeMs,
      physicsDebtMs: this.physicsDebtMs,
      player,
      entities: [...this.bodies.values()],
      chunkRevisions: this.collisionWorld.revisionVector(),
      worldRevision: this.options.server.worldRevision,
      worldMutationCount: this.options.server.mutationCount,
      worldTime: this.options.server.worldTime,
      paused: this.clock.paused,
      diagnostics: {
        recoveryResults: this.recoveryResults.map((result) => ({ ...result })),
        physicsCost: this.options.measureNow ? this.physicsCost.snapshot() : null,
      },
    };
  }
}
