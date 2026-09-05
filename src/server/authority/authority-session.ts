import { stepBody, type BodyConfig, type BodyState, type Contact, type PhysicsInput } from '../../physics';
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

export type AuthoritySnapshot = Readonly<{
  kind: 'snapshot';
  protocolVersion: 1;
  epoch: string;
  physicsTick: number;
  commitSequence: number;
  worldMutationCount: number;
  acknowledgedInputSequence: number;
  activeTimeMs: number;
  integratedPhysicsTimeMs: number;
  physicsDebtMs: number;
  player: AuthorityBodySnapshot;
  entities: readonly AuthorityBodySnapshot[];
  chunkRevisions: Readonly<Record<string, number>>;
  worldRevision: number;
  worldTime: number;
  paused: boolean;
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
}>;

const toBodyState = (entity: AuthorityEntity): BodyState => ({
  position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
  velocity: {
    x: entity.physicsVelocity?.[0] ?? 0,
    y: entity.physicsVelocity?.[1] ?? 0,
    z: entity.physicsVelocity?.[2] ?? 0,
  },
});

export class AuthoritySession {
  private readonly clock: ActiveMonotonicClock;
  private readonly scheduler: MultiRateScheduler;
  private readonly input: InputCommandBuffer;
  private readonly collisionWorld: VoxelCollisionWorld;
  private readonly bodies = new Map<string, AuthorityBodySnapshot>();
  private readonly logicIntents = new Map<string, LogicIntent>();
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
    if (due.gameplay.due)
      this.options.server.advanceGameplayRules(due.gameplay.elapsedPeriods / this.options.frequencies.gameplayHz);
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

  synchronizeExternalState() {
    this.refreshBodies();
  }

  private stepPhysics(dt: number) {
    const input = this.input.consumeForTick(this.physicsTick);
    const seen = new Set<string>();
    for (const entity of this.options.server.queryEntities()) {
      seen.add(entity.id);
      const physicsInput = this.physicsInput(entity, input);
      const result = stepBody({
        state: toBodyState(entity),
        config: this.options.bodyConfigFor(entity),
        input: physicsInput,
        world: this.collisionWorld,
        dt,
      });
      this.options.server.updateEntity(entity.id, {
        position: [result.state.position.x, result.state.position.y, result.state.position.z],
        physicsVelocity: [result.state.velocity.x, result.state.velocity.y, result.state.velocity.z],
      });
      this.bodies.set(entity.id, {
        id: entity.id,
        type: entity.type,
        ...(entity.archetype ? { archetype: entity.archetype } : {}),
        body: result.state,
        grounded: result.grounded,
        contacts: result.contacts,
      });
    }
    for (const id of this.bodies.keys()) if (!seen.has(id)) this.bodies.delete(id);
    this.commitSequence += 1;
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
    };
  }
}
