import {
  bodyWorldAabb,
  probeBodyContacts,
  recoverBody,
  separateBodies,
  stepBody,
  sweepBodyThroughWorld,
  type BodyConfig,
  type BodyState,
  type Contact,
  type PhysicsInput,
} from '../../physics';
import { ActiveMonotonicClock } from '../../runtime/active-monotonic-clock';
import { MultiRateScheduler } from '../../runtime/multi-rate-scheduler';
import { InputCommandBuffer, type InputCommand, type SequenceDecision } from '../../runtime/session-protocol';
import { VoxelCollisionWorld, type LoadedVoxelSource } from './voxel-collision-world';

export type AuthorityEntity = Readonly<{
  id: string;
  type: 'player' | 'world-item' | 'creature' | 'npc';
  archetype?: 'grazer' | 'night-stalker' | 'settler';
  position: [number, number, number];
  physicsVelocity?: [number, number, number];
}>;

export type AuthorityPickupTarget = Readonly<{
  id: string;
  position: [number, number, number];
}>;

export type AuthorityServerPort = {
  readonly worldRevision: number;
  readonly mutationCount: number;
  readonly worldTime: number;
  getEntity: (id: string) => AuthorityEntity | null;
  queryEntities: () => AuthorityEntity[];
  updateEntity: (
    id: string,
    update: { position: [number, number, number]; physicsVelocity: [number, number, number] },
  ) => unknown;
  advanceGameplayRules: (seconds: number) => unknown;
  advanceWorldClock?: (hours: number) => unknown;
  queryPickupTargets?: () => readonly AuthorityPickupTarget[];
  pickupItem?: (playerId: string, itemId: string) => Readonly<{ success: boolean }>;
};

export type LogicIntent = Readonly<{
  entityId: string;
  wish: Readonly<{ x: number; z: number }>;
  jumpRequested: boolean;
  verticalIntent: -1 | 0 | 1;
  expiresAtPhysicsTick: number;
}>;

export type AuthorityBodySnapshot = Readonly<{
  id: string;
  type: AuthorityEntity['type'];
  archetype?: AuthorityEntity['archetype'];
  body: BodyState;
  grounded: boolean;
  contacts: readonly Contact[];
}>;

export type BodyRecoveryReason = 'initialization' | 'legacy-restore' | 'external-geometry-change';

export type BodyRecoveryDiagnostic = Readonly<{
  entityId: string;
  reason: BodyRecoveryReason;
  status: 'recovered' | 'blocked' | 'missing';
  distance: number;
  physicsTick: number;
}>;

export type AuthoritySnapshot = Readonly<{
  kind: 'snapshot';
  protocolVersion: 1;
  epoch: string;
  physicsTick: number;
  commitSequence: number;
  worldMutationCount: number;
  acknowledgedInputSequence: number;
  inputResyncRequired: boolean;
  activeTimeMs: number;
  integratedPhysicsTimeMs: number;
  physicsDebtMs: number;
  player: AuthorityBodySnapshot;
  entities: readonly AuthorityBodySnapshot[];
  chunkRevisions: Readonly<Record<string, number>>;
  worldRevision: number;
  worldTime: number;
  paused: boolean;
  diagnostics?: Readonly<{ recoveryResults: readonly BodyRecoveryDiagnostic[] }>;
}>;

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
const ITEM_PICKUP_RETRY_TICKS = 15;
const PICKUP_PATH_EPSILON = 1e-6;

const distanceSquared = (left: readonly number[], right: readonly number[]): number =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

const isCharacter = (entity: AuthorityEntity): boolean =>
  entity.type === 'player' || entity.type === 'creature' || entity.type === 'npc';

export class AuthoritySession {
  private readonly clock: ActiveMonotonicClock;
  private readonly scheduler: MultiRateScheduler;
  private readonly input: InputCommandBuffer;
  private readonly collisionWorld: VoxelCollisionWorld;
  private readonly bodies = new Map<string, AuthorityBodySnapshot>();
  private readonly logicIntents = new Map<string, LogicIntent>();
  private readonly recoveryQueue = new Map<string, Readonly<{ reason: BodyRecoveryReason; maxDistance: number }>>();
  private readonly recoveryResults: BodyRecoveryDiagnostic[] = [];
  private readonly pickupAttempts = new Map<string, number>();
  private physicsTick = 0;
  private commitSequence = 0;
  private activeTimeMs = 0;
  private integratedPhysicsTimeMs = 0;
  private physicsDebtMs = 0;

  constructor(private readonly options: AuthoritySessionOptions) {
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
      this.stepPhysics(step.dtSeconds);
    }
    this.integratedPhysicsTimeMs = due.integratedPhysicsTimeMs;
    this.physicsDebtMs = due.physicsDebtMs;
    if (due.gameplay.due) {
      const gameplaySeconds = due.gameplay.elapsedPeriods / this.options.frequencies.gameplayHz;
      this.options.server.advanceWorldClock?.(gameplaySeconds * (this.options.worldHoursPerSecond ?? 0.04));
      this.options.server.advanceGameplayRules(gameplaySeconds);
      this.commitSequence += 1;
    }
    if (due.fluid.due) this.options.requestFluidWork?.(due.fluid.elapsedPeriods);
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
    const seen = new Set<string>();
    const nextBodies = new Map<string, AuthorityBodySnapshot>();
    const configs = new Map<string, BodyConfig>();
    for (const entity of entities) {
      seen.add(entity.id);
      const config = this.options.bodyConfigFor(entity);
      configs.set(entity.id, config);
      const physicsInput = this.physicsInput(entity, input);
      const attraction = entity.type === 'world-item' ? this.itemAttraction(entity, pickupTargets) : null;
      const initialState = toBodyState(entity);
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
    this.processPickups();
    for (const id of this.bodies.keys()) if (!seen.has(id)) this.bodies.delete(id);
    this.commitSequence += 1;
  }

  private afterSeparation(snapshot: AuthorityBodySnapshot, body: BodyState, config: BodyConfig): AuthorityBodySnapshot {
    if (snapshot.body === body) return snapshot;
    const probe = probeBodyContacts({ state: body, config, world: this.collisionWorld });
    return { ...snapshot, body, grounded: probe.grounded, contacts: probe.contacts };
  }

  private itemAttraction(
    entity: AuthorityEntity,
    targets: readonly AuthorityPickupTarget[],
  ): BodyState['velocity'] | null {
    const target = targets.find(
      (candidate) => distanceSquared(entity.position, candidate.position) <= ITEM_ATTRACTION_RADIUS ** 2,
    );
    if (!target) return null;
    const delta = {
      x: target.position[0] - entity.position[0],
      y: target.position[1] - entity.position[1],
      z: target.position[2] - entity.position[2],
    };
    const distance = Math.hypot(delta.x, delta.y, delta.z);
    if (distance <= Number.EPSILON) return null;
    return {
      x: (delta.x / distance) * ITEM_ATTRACTION_SPEED,
      y: (delta.y / distance) * ITEM_ATTRACTION_SPEED,
      z: (delta.z / distance) * ITEM_ATTRACTION_SPEED,
    };
  }

  private processPickups(): void {
    const entities = this.options.server.queryEntities().sort((left, right) => left.id.localeCompare(right.id));
    const entityIds = new Set(entities.map((entity) => entity.id));
    const targets = [...(this.options.server.queryPickupTargets?.() ?? [])].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    for (const attempt of this.pickupAttempts.keys()) {
      const [itemId, targetId] = attempt.split('\0');
      const item = entities.find((entity) => entity.id === itemId);
      const target = targets.find((candidate) => candidate.id === targetId);
      if (!item || !target || distanceSquared(item.position, target.position) > ITEM_PICKUP_RADIUS ** 2)
        this.pickupAttempts.delete(attempt);
    }
    if (!this.options.server.pickupItem) return;
    for (const item of entities.filter((entity) => entity.type === 'world-item')) {
      const target = targets.find(
        (candidate) => distanceSquared(item.position, candidate.position) <= ITEM_PICKUP_RADIUS ** 2,
      );
      if (!target) continue;
      const body = this.bodies.get(item.id);
      if (!body) continue;
      const targetPosition = { x: target.position[0], y: target.position[1], z: target.position[2] };
      const path = sweepBodyThroughWorld(body.body, this.options.bodyConfigFor(item), this.collisionWorld, {
        x: targetPosition.x - body.body.position.x,
        y: targetPosition.y - body.body.position.y,
        z: targetPosition.z - body.body.position.z,
      });
      if (
        distanceSquared(
          [path.position.x, path.position.y, path.position.z],
          [targetPosition.x, targetPosition.y, targetPosition.z],
        ) >
        PICKUP_PATH_EPSILON ** 2
      )
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
      diagnostics: { recoveryResults: this.recoveryResults.map((result) => ({ ...result })) },
    };
  }
}
