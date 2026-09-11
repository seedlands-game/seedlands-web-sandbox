import { createMovementInputGuard, projectMovementBodies } from './actor-movement-projection';
import type { EntityLifetimeReference } from '../gameplay/entity-store';
import { clearAuthorityHorizontalVelocity } from './authority-input-neutralization';
import {
  bodyWorldAabb,
  probeBodyContacts,
  recoverBody,
  selectReachableBodyTarget,
  separateBodies,
  stepBody,
  type BodyConfig,
  type BodyState,
} from '../../physics';
import { WORLD_ITEM_INTERACTION } from '../../physics/body-registry';
import { ActiveMonotonicClock } from '../../runtime/active-monotonic-clock';
import { BoundedCostSamples } from '../../runtime/bounded-cost-samples';
import { MultiRateScheduler } from '../../runtime/multi-rate-scheduler';
import { InputCommandBuffer, type InputCommand, type SequenceDecision } from '../../runtime/session-protocol';
import type * as SessionContract from './authority-session-types';
import { VoxelCollisionWorld } from './voxel-collision-world';
import { bodyActiveChunkKeys } from './authority-physics-active-chunks';
import { bodyStateForAuthorityEntity } from './creative-physics';
import {
  selectAuthorityPhysicsInput,
  worldItemAttraction,
  ZERO_AUTHORITY_PHYSICS_INPUT,
  acceptBoundPhysicsIntents,
  isAuthorityPlayerBindingCurrent,
} from './authority-physics-input';
import type { AuthorityKernelState } from './authority-kernel-state';
import { settleAuthorityPickups } from './authority-pickup-settlement';
import { assertAdvanceCapacity, MAX_AUTHORITY_RECOVERIES_PER_STEP } from './authority-advance-capacity';
import { commitAuthorityPhysicsEntities } from './authority-physics-entity-commit';
import type { AuthoritySessionOptions } from './authority-session-options';

export type * from './authority-session-types';

type BodySnapshot = SessionContract.AuthorityBodySnapshot;
const MAX_RECOVERY_QUEUE = 512;
const MAX_RECOVERY_RESULTS = 32;
const MAX_RECOVERY_DISTANCE = 8;
const CHARACTER_SEPARATION_DISTANCE = 0.1;
const MAX_PICKUP_TARGET_CANDIDATES = 8;
const MAX_TRACKED_PICKUP_CURSORS = 512;
const PICKUP_CURSOR_WRAP = 0x80000000;
const RECOVERY_PRIORITY = { 'external-geometry-change': 0, initialization: 1, 'legacy-restore': 2 } as const;

const isCharacter = (entity: SessionContract.AuthorityEntity): boolean =>
  entity.type === 'player' || entity.type === 'creature' || entity.type === 'npc';

export class AuthoritySession {
  private readonly clock: ActiveMonotonicClock;
  private readonly physicsCost = new BoundedCostSamples();
  private readonly scheduler: MultiRateScheduler;
  private readonly input: InputCommandBuffer;
  private readonly playerReference: EntityLifetimeReference | null;
  private readonly collisionWorld: VoxelCollisionWorld;
  private readonly bodies = new Map<string, BodySnapshot>();
  private readonly logicIntents = new Map<string, SessionContract.LogicIntent>();
  private readonly recoveryQueue = new Map<
    string,
    Readonly<{ reason: SessionContract.BodyRecoveryReason; maxDistance: number }>
  >();
  private readonly recoveryResults: SessionContract.BodyRecoveryDiagnostic[] = [];
  private readonly pickupAttempts = new Map<string, number>();
  private readonly pickupTargetCursors = new Map<string, number>();
  constructor(private readonly options: AuthoritySessionOptions) {
    const state = this.state;
    const restoredPaused = state.paused;
    if (restoredPaused) this.options.execution.assertCanCommit();
    if (!state.scheduler) state.worldClockRate = options.worldHoursPerSecond ?? state.worldClockRate;
    state.paused = false;
    this.assertWorldClockRate(this.state.worldClockRate);
    this.clock = new ActiveMonotonicClock(options.startTimeMs, {
      activeTimeMs: state.activeTimeMs,
      paused: false,
    });
    this.scheduler = new MultiRateScheduler(
      { ...options.frequencies, maxPhysicsCatchUpSteps: 4 },
      state.activeTimeMs,
      state.scheduler ?? undefined,
    );
    this.input = new InputCommandBuffer(options.epoch, 'player-input');
    this.playerReference = options.server.createEntityReference?.(options.playerId) ?? null;
    this.collisionWorld = new VoxelCollisionWorld(options.voxelSource, options.requestUnknownChunk);
    this.refreshBodies();
    for (const id of this.bodies.keys()) this.requestBodyRecovery(id, 'initialization', 2);
    if (restoredPaused) this.options.execution.commit();
  }

  private get state(): AuthorityKernelState {
    return this.options.execution.sessionState();
  }

  get playerBindingCurrent(): boolean {
    return isAuthorityPlayerBindingCurrent(this.playerReference, this.options.server);
  }

  receiveInput(command: InputCommand): SequenceDecision {
    if (!this.movementInput.accept(command)) return 'invalid';
    if (!this.playerBindingCurrent) {
      this.input.clear();
      return 'wrong-epoch';
    }
    return this.input.push(command);
  }

  get currentSnapshot(): SessionContract.AuthoritySnapshot {
    return this.snapshot();
  }

  clearPlayerInput(): void {
    this.input.clear();
    this.stopPlayerHorizontalVelocity();
  }

  clearLogicIntents(): void {
    this.logicIntents.clear();
  }

  receiveLogicIntents(epoch: string, intents: readonly SessionContract.LogicIntent[]) {
    if (epoch !== this.options.epoch) return false;
    return acceptBoundPhysicsIntents(
      this.logicIntents,
      intents,
      this.state.physicsTick,
      this.options.server.resolveEntityReference,
    );
  }

  requestBodyRecovery(entityId: string, reason: SessionContract.BodyRecoveryReason, maxDistance: number): boolean {
    if (!entityId || !['initialization', 'legacy-restore', 'external-geometry-change'].includes(reason))
      throw new TypeError('身体恢复请求必须包含实体和受支持的原因。');
    if (!Number.isFinite(maxDistance) || maxDistance < 0 || maxDistance > MAX_RECOVERY_DISTANCE)
      throw new RangeError(`身体恢复距离必须位于 0..${MAX_RECOVERY_DISTANCE}。`);
    const existing = this.recoveryQueue.get(entityId);
    if (!existing && this.recoveryQueue.size >= MAX_RECOVERY_QUEUE) return false;
    this.recoveryQueue.set(entityId, {
      reason: existing && RECOVERY_PRIORITY[existing.reason] >= RECOVERY_PRIORITY[reason] ? existing.reason : reason,
      maxDistance: Math.max(existing?.maxDistance ?? 0, maxDistance),
    });
    return true;
  }

  wake(nowMs: number): SessionContract.AuthoritySnapshot {
    const previousActiveTimeMs = this.state.activeTimeMs;
    const preview = this.clock.previewSample(nowMs);
    assertAdvanceCapacity(
      this.options,
      this.scheduler,
      preview.activeTimeMs,
      this.recoveryQueue.size,
      previousActiveTimeMs,
    );
    const clock = this.clock.sample(nowMs);
    this.state.activeTimeMs = clock.activeTimeMs;
    if (clock.paused) return this.snapshot();
    return this.advanceToActiveTime(clock.activeTimeMs, clock.activeTimeMs !== previousActiveTimeMs);
  }

  advancePaused(elapsedMs: number): SessionContract.AuthoritySnapshot {
    const previousActiveTimeMs = this.state.activeTimeMs;
    const preview = this.clock.previewPausedAdvance(elapsedMs);
    assertAdvanceCapacity(
      this.options,
      this.scheduler,
      preview.activeTimeMs,
      this.recoveryQueue.size,
      previousActiveTimeMs,
    );
    const clock = this.clock.advancePaused(elapsedMs);
    this.state.activeTimeMs = clock.activeTimeMs;
    return this.advanceToActiveTime(clock.activeTimeMs, clock.activeTimeMs !== previousActiveTimeMs);
  }

  private advanceToActiveTime(activeTimeMs: number, activeTimeChanged: boolean): SessionContract.AuthoritySnapshot {
    const before = this.options.execution.commitSequence;
    const due = this.scheduler.advanceTo(activeTimeMs);
    const sessionStateChanged = activeTimeChanged || due.physicsSteps.length > 0 || due.gameplay.due || due.fluid.due;
    this.state.integratedPhysicsTimeMs = due.integratedPhysicsTimeMs;
    this.state.physicsDebtMs = due.physicsDebtMs;
    if (sessionStateChanged) this.state.scheduler = this.scheduler.snapshot();
    if (due.gameplay.due) this.state.gameplayPeriods += due.gameplay.elapsedPeriods;
    if (due.fluid.due) this.state.fluidPeriods += due.fluid.elapsedPeriods;
    for (const step of due.physicsSteps) {
      this.state.physicsTick = step.tick;
      const startedAt = this.options.measureNow?.();
      this.stepPhysics(step.dtSeconds);
      if (startedAt !== undefined) this.physicsCost.record(this.options.measureNow!() - startedAt);
    }
    if (due.gameplay.due) {
      const gameplaySeconds = due.gameplay.elapsedPeriods / this.options.frequencies.gameplayHz;
      const before = this.options.execution.commitSequence;
      this.options.server.advanceWorldClock?.(gameplaySeconds * this.state.worldClockRate);
      this.options.server.advanceGameplayRules(gameplaySeconds);
      if (this.options.execution.commitSequence === before) this.options.execution.commit();
    }
    if (due.fluid.due) {
      this.options.requestFluidWork?.(due.fluid.elapsedPeriods);
    }
    if (sessionStateChanged && this.options.execution.commitSequence === before) this.options.execution.commit();
    const snapshot = this.snapshot();
    if (due.gameplay.due) this.options.publishLogicObservation?.(snapshot);
    return snapshot;
  }

  pause(nowMs: number) {
    this.options.execution.assertCanCommit();
    const before = this.options.execution.commitSequence;
    const previousActiveTimeMs = this.state.activeTimeMs;
    const previouslyPaused = this.state.paused;
    const clock = this.clock.pause(nowMs);
    this.state.activeTimeMs = clock.activeTimeMs;
    this.state.physicsDebtMs = Math.max(0, clock.activeTimeMs - this.state.integratedPhysicsTimeMs);
    this.state.paused = true;
    this.input.clear();
    this.stopPlayerHorizontalVelocity();
    if (
      this.options.execution.commitSequence === before &&
      (this.state.activeTimeMs !== previousActiveTimeMs || this.state.paused !== previouslyPaused)
    )
      this.options.execution.commit();
  }

  resume(nowMs: number) {
    this.options.execution.assertCanCommit();
    const before = this.options.execution.commitSequence;
    const previousActiveTimeMs = this.state.activeTimeMs;
    const previouslyPaused = this.state.paused;
    const clock = this.clock.resume(nowMs);
    this.state.activeTimeMs = clock.activeTimeMs;
    this.state.physicsDebtMs = Math.max(0, clock.activeTimeMs - this.state.integratedPhysicsTimeMs);
    this.state.paused = false;
    if (
      this.options.execution.commitSequence === before &&
      (this.state.activeTimeMs !== previousActiveTimeMs || this.state.paused !== previouslyPaused)
    )
      this.options.execution.commit();
  }

  get currentCommitSequence() {
    return this.options.execution.commitSequence;
  }

  get laneTotals(): SessionContract.AuthorityLaneTotals {
    return {
      physicsSteps: this.state.physicsTick,
      gameplayPeriods: this.state.gameplayPeriods,
      fluidPeriods: this.state.fluidPeriods,
    };
  }

  setWorldClockRate(rate: number): number {
    this.assertWorldClockRate(rate);
    if (rate === this.state.worldClockRate) return rate;
    this.options.execution.assertCanCommit();
    this.state.worldClockRate = rate;
    this.options.execution.commit();
    return rate;
  }

  get inputResyncRequired() {
    return this.input.requiresResync;
  }

  commitExternalState(refreshBodies = true) {
    this.options.execution.assertCanCommit();
    if (refreshBodies) this.refreshBodies();
    return this.options.execution.commit();
  }

  synchronizeExternalState() {
    this.refreshBodies();
  }

  private stepPhysics(dt: number) {
    const before = this.options.execution.commitSequence;
    this.movementInput.synchronize();
    this.collisionWorld.beginStep();
    this.processRecoveryQueue();
    if (!this.playerBindingCurrent) this.input.clear();
    const input = this.input.consumeForTick(this.state.physicsTick);
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
    const nextBodies = new Map<string, BodySnapshot>();
    const configs = new Map<string, BodyConfig>();
    for (const entity of entities) {
      seen.add(entity.id);
      const config = this.options.bodyConfigFor(entity);
      configs.set(entity.id, config);
      const physicsInput = selectAuthorityPhysicsInput(
        entity,
        this.options.playerId,
        input,
        this.logicIntents,
        this.state.physicsTick,
        this.options.server.resolveEntityReference,
      );
      const modeState = this.options.server.getActorModeState?.(entity.id);
      const authorizedPhysicsInput =
        modeState?.mode === 'creative' && modeState.flight.enabled
          ? { ...physicsInput, controlledFlight: { verticalSpeed: config.maxHorizontalSpeed ?? 4.5 } }
          : physicsInput;
      const initialState = bodyStateForAuthorityEntity(entity);
      const trackPickupCursor =
        entity.type === 'world-item' &&
        (this.pickupTargetCursors.has(entity.id) || this.pickupTargetCursors.size < MAX_TRACKED_PICKUP_CURSORS);
      const pickupCursor =
        this.pickupTargetCursors.get(entity.id) ??
        (trackPickupCursor
          ? 0
          : ((this.state.physicsTick - 1) % (PICKUP_CURSOR_WRAP / MAX_PICKUP_TARGET_CANDIDATES)) *
            MAX_PICKUP_TARGET_CANDIDATES);
      const target =
        entity.type === 'world-item'
          ? selectReachableBodyTarget({
              state: initialState,
              config,
              world: this.collisionWorld,
              targets: physicsTargets,
              maxDistance: WORLD_ITEM_INTERACTION.attractionRadius,
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
      const attraction = target ? worldItemAttraction(initialState, target.position) : null;
      const result = stepBody({
        state: initialState,
        config: attraction ? { ...config, groundAcceleration: 0, airAcceleration: 0 } : config,
        input: attraction
          ? {
              ...ZERO_AUTHORITY_PHYSICS_INPUT,
              externalAcceleration: {
                x: (attraction.x - initialState.velocity.x) / dt,
                y: (attraction.y - initialState.velocity.y) / dt,
                z: (attraction.z - initialState.velocity.z) / dt,
              },
            }
          : authorizedPhysicsInput,
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

    commitAuthorityPhysicsEntities(this.options.server, entities, nextBodies, this.bodies);
    settleAuthorityPickups(
      {
        server: this.options.server,
        bodyConfigFor: this.options.bodyConfigFor,
        collisionWorld: this.collisionWorld,
        bodies: this.bodies,
        attempts: this.pickupAttempts,
        physicsTick: this.state.physicsTick,
      },
      selectedTargets,
    );
    for (const id of this.bodies.keys()) if (!seen.has(id)) this.bodies.delete(id);
    for (const id of this.pickupTargetCursors.keys()) if (!worldItemIds.has(id)) this.pickupTargetCursors.delete(id);
    this.options.server.setPhysicsActiveChunks?.(this.collisionWorld.activeChunkKeys);
    if (this.options.execution.commitSequence === before) this.options.execution.commit();
  }

  private afterSeparation(snapshot: BodySnapshot, body: BodyState, config: BodyConfig): BodySnapshot {
    if (snapshot.body === body) return snapshot;
    const probe = probeBodyContacts({ state: body, config, world: this.collisionWorld });
    return { ...snapshot, body, grounded: probe.grounded, contacts: probe.contacts };
  }

  private processRecoveryQueue(): void {
    const requests = [...this.recoveryQueue]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, MAX_AUTHORITY_RECOVERIES_PER_STEP);
    for (const [entityId, request] of requests) {
      this.recoveryQueue.delete(entityId);
      const entity = this.options.server.getEntity(entityId);
      if (!entity) {
        this.recordRecovery({
          entityId,
          reason: request.reason,
          status: 'missing',
          distance: 0,
          physicsTick: this.state.physicsTick,
        });
        continue;
      }
      const state = bodyStateForAuthorityEntity(entity);
      const config = this.options.bodyConfigFor(entity);
      if (!this.overlapsStatic(state, config)) {
        this.recordRecovery({
          entityId,
          reason: request.reason,
          status: 'recovered',
          distance: 0,
          physicsTick: this.state.physicsTick,
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
        physicsTick: this.state.physicsTick,
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

  private recordRecovery(result: SessionContract.BodyRecoveryDiagnostic): void {
    this.recoveryResults.push(result);
    if (this.recoveryResults.length > MAX_RECOVERY_RESULTS)
      this.recoveryResults.splice(0, this.recoveryResults.length - MAX_RECOVERY_RESULTS);
  }

  private refreshBodies() {
    const entities = this.options.server.queryEntities();
    entities.forEach((entity) => {
      this.bodies.set(entity.id, {
        id: entity.id,
        type: entity.type,
        ...(entity.archetype ? { archetype: entity.archetype } : {}),
        body: bodyStateForAuthorityEntity(entity),
        grounded: false,
        contacts: [],
      });
    });
    this.options.server.setPhysicsActiveChunks?.(bodyActiveChunkKeys(entities, this.options.bodyConfigFor));
  }

  private stopPlayerHorizontalVelocity() {
    if (clearAuthorityHorizontalVelocity(this.options.server, this.options.playerId)) this.refreshBodies();
  }

  private assertWorldClockRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0 || rate > 24)
      throw new RangeError('World clock rate must be finite and within 0..24 hours per second.');
  }

  private readonly movementInput = createMovementInputGuard(
    () => this.options.server.getActorModeState?.(this.options.playerId),
    () => this.input.clear(),
  );
  private snapshot(): SessionContract.AuthoritySnapshot {
    return {
      kind: 'snapshot',
      protocolVersion: 1,
      epoch: this.options.epoch,
      physicsTick: this.state.physicsTick,
      commitSequence: this.options.execution.commitSequence,
      acknowledgedInputSequence: this.input.acknowledgedSequence,
      inputResyncRequired: this.input.requiresResync,
      activeTimeMs: this.state.activeTimeMs,
      integratedPhysicsTimeMs: this.state.integratedPhysicsTimeMs,
      physicsDebtMs: this.state.physicsDebtMs,
      ...projectMovementBodies(this.options, this.bodies),
      chunkRevisions: this.collisionWorld.revisionVector(),
      worldRevision: this.options.server.worldRevision,
      worldMutationCount: this.options.server.mutationCount,
      worldTime: this.options.server.worldTime,
      paused: this.clock.paused,
      diagnostics: {
        recoveryResults: this.recoveryResults.map((result) => ({ ...result })),
        physicsCost: this.options.measureNow ? this.physicsCost.snapshot() : null,
        ...(this.options.server.fluidDiagnostics ? { fluid: { ...this.options.server.fluidDiagnostics } } : {}),
      },
    };
  }
}
