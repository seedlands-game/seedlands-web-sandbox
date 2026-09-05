import * as pc from 'playcanvas';
import { Voxel } from '../world/voxel';
import { releasePointerLock } from './pointer-lock';
import { traceVoxelTarget, type VoxelTarget } from '../client/voxel-target';
import { DRY_WATER_IMMERSION, sampleWaterImmersion, type WaterImmersionSnapshot } from '../world/water-immersion';
import type { PlayerControllerOptions } from './player-controller-types';
import { PLAYER_FEET_OFFSET, PLAYER_HEAD_OFFSET } from './player-collision-shapes';
import { PlayerInputStream } from '../client/player-input-stream';
import { PredictionBuffer } from '../client/prediction-buffer';
import { bodyConfigFor, bodyWorldAabb, stepBody, type BodyState, type WorldAabb } from '../physics';
import { VoxelCollisionWorld } from '../server/authority/voxel-collision-world';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../world/voxel';
import type { AuthoritySnapshot } from '../server/authority/authority-session';

export { PLAYER_FEET_OFFSET } from './player-collision-shapes';

export class PlayerController {
  readonly velocity = new pc.Vec3();
  private yaw = 0;
  private pitch = -16;
  private grounded = false;
  private readonly keys = new Set<string>();
  private attempts = 0;
  private spectator = false;
  private miningHeld = false;
  private activeMiningTarget: string | null = null;
  private attackCooldownSeconds = 0;
  private attackBlocking = false;
  private publishedAimTarget: VoxelTarget | null = null;
  private immersion: WaterImmersionSnapshot = DRY_WATER_IMMERSION;
  private readonly inputStream: PlayerInputStream;
  private readonly prediction = new PredictionBuffer();
  private predictedBody: BodyState | null = null;
  private latestSnapshot: AuthoritySnapshot | null = null;
  private predictionAccumulator = 0;

  constructor(private readonly options: PlayerControllerOptions) {
    this.inputStream = new PlayerInputStream(options.authority?.epoch ?? 'unit-test');
  }

  get onGround() {
    return this.grounded;
  }

  get interactionAttempts() {
    return this.attempts;
  }

  get waterImmersion(): WaterImmersionSnapshot {
    return { ...this.immersion };
  }

  get position() {
    return this.options.camera.getPosition();
  }

  get isColliding() {
    const world = this.options.getWorld();
    const body = this.predictedBody ?? this.latestSnapshot?.player.body;
    if (!world || !body) return false;
    const bounds = bodyWorldAabb(body, bodyConfigFor('player'));
    return this.collisionWorld(world)
      .querySolids(bounds)
      .some((collider) => this.overlaps(bounds, collider.aabb));
  }

  get interactionBlocked() {
    return Boolean(this.options.isPaused?.() || this.options.isUiBlockingInput());
  }

  get aimTarget(): VoxelTarget | null {
    if (this.interactionBlocked) return null;
    const target = this.traceTarget();
    return target?.inRange ? target : null;
  }

  private traceTarget(): VoxelTarget | null {
    const world = this.options.getWorld();
    if (!world) return null;
    const position = this.options.camera.getPosition();
    const direction = this.options.camera.forward;
    return traceVoxelTarget([position.x, position.y, position.z], [direction.x, direction.y, direction.z], (x, y, z) =>
      world.getVoxel(x, y, z),
    );
  }

  install() {
    const { canvas } = this.options;
    window.onkeydown = (event) => {
      if (this.options.isPaused?.()) {
        this.stopMining();
        return;
      }
      if (event.code === 'F4') {
        event.preventDefault();
        this.options.onToggleCommandShell();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === 'KeyE') {
        event.preventDefault();
        this.options.onToggleInventory();
        return;
      }
      if (event.code === 'Escape' && this.options.isUiBlockingInput()) {
        this.options.onCloseUi();
        return;
      }
      if (event.code === 'KeyM') {
        this.options.onToggleMap();
        return;
      }
      if (this.interactionBlocked) {
        this.stopMining();
        return;
      }
      if (event.code === 'F3') {
        event.preventDefault();
        this.options.onToggleDebug();
        return;
      }
      if (event.code === 'KeyP') {
        const environment = this.options.getEnvironment();
        if (environment) environment.setPaused(!environment.paused);
        return;
      }
      if (event.code === 'KeyT') {
        this.options.getEnvironment()?.cycleSpeed();
        return;
      }
      if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        this.shiftWorldTime(event.code === 'BracketLeft' ? -1 : 1);
        return;
      }
      this.keys.add(event.code);
      if (/^Digit[1-8]$/.test(event.code)) {
        this.options.onSelectHotbarSlot(Number(event.code[5]) - 1);
        if (this.miningHeld) this.cancelActiveMining();
      }
    };
    window.onkeyup = (event) => this.keys.delete(event.code);
    canvas.oncontextmenu = (event) => event.preventDefault();
    canvas.onclick = () => {
      if (!this.interactionBlocked) void canvas.requestPointerLock();
    };
    document.onmousemove = (event) => {
      if (document.pointerLockElement === canvas) {
        this.yaw -= event.movementX * 0.13;
        this.pitch = Math.max(-88, Math.min(88, this.pitch - event.movementY * 0.13));
      }
    };
    document.onpointerlockchange = () => {
      if (document.pointerLockElement !== canvas) this.stopMining();
    };
    window.onblur = () => this.stopMining();
    document.onmousedown = (event) => {
      if (this.interactionBlocked) return;
      if (document.pointerLockElement !== canvas) {
        if (event.target !== canvas || event.button !== 2) return;
        void canvas.requestPointerLock();
      }
      if (event.button === 0) this.options.telemetry.withSpan('input', 'PointerInteraction', () => this.startMining());
      if (event.button === 2) this.options.telemetry.withSpan('input', 'PointerInteraction', () => this.interact(true));
    };
    document.onmouseup = (event) => {
      if (event.button === 0) this.stopMining();
    };
  }

  dispose() {
    window.onkeydown = null;
    window.onkeyup = null;
    document.onmousemove = null;
    document.onmousedown = null;
    document.onmouseup = null;
    document.onpointerlockchange = null;
    window.onblur = null;
    this.options.canvas.onclick = null;
    this.options.canvas.oncontextmenu = null;
    this.keys.clear();
    this.stopMining();
    this.publishAimTarget(null);
  }

  update(dt: number) {
    const world = this.options.getWorld();
    if (!world) {
      this.immersion = DRY_WATER_IMMERSION;
      this.stopMining();
      this.publishAimTarget(null);
      return;
    }
    const camera = this.options.camera;
    camera.setEulerAngles(this.pitch, this.yaw, 0);
    const cameraPosition = camera.getPosition();
    this.immersion = sampleWaterImmersion({
      position: [cameraPosition.x, cameraPosition.y, cameraPosition.z],
      feetOffset: PLAYER_FEET_OFFSET,
      headOffset: PLAYER_HEAD_OFFSET,
      previousCameraSubmerged: this.immersion.cameraSubmerged,
      getVoxel: (x, y, z) => world.getVoxel(x, y, z),
      getFluidLevel: (x, y, z) => world.getFluidCell(x, y, z)?.level ?? null,
    });
    const span = this.options.telemetry.beginSpan('player', 'PlayerMovement');
    if (!this.spectator) {
      const forward = new pc.Vec3().copy(camera.forward);
      forward.y = 0;
      forward.normalize();
      const right = new pc.Vec3().copy(camera.right);
      right.y = 0;
      right.normalize();
      const snapshot = this.latestSnapshot ?? this.options.authority.snapshot();
      if (snapshot) {
        const stepSeconds = 1 / this.options.physicsHz;
        this.predictionAccumulator = Math.min(stepSeconds * 4, this.predictionAccumulator + dt);
        while (this.predictionAccumulator + Number.EPSILON >= stepSeconds) {
          this.predictionAccumulator -= stepSeconds;
          const command = this.inputStream.sample({
            physicsTick: snapshot.physicsTick,
            issuedAtMs: performance.now(),
            forward: { x: forward.x, z: forward.z },
            right: { x: right.x, z: right.z },
            keys: {
              forward: this.keys.has('KeyW'),
              back: this.keys.has('KeyS'),
              left: this.keys.has('KeyA'),
              right: this.keys.has('KeyD'),
              jump: this.keys.has('Space'),
              crouch: this.keys.has('ShiftLeft'),
            },
          });
          if (!command) continue;
          this.options.authority.sendInput(command);
          const collisionWorld = this.collisionWorld(world);
          const result = stepBody({
            state: this.predictedBody ?? snapshot.player.body,
            config: bodyConfigFor('player'),
            input: {
              wish: { x: command.state.moveX, z: command.state.moveZ },
              jumpPressed: command.state.jumpHeld || command.edges.jumpPressed,
              verticalIntent: command.state.verticalIntent,
            },
            world: collisionWorld,
            dt: stepSeconds,
          });
          this.predictedBody = result.state;
          this.grounded = result.grounded;
          this.velocity.set(result.state.velocity.x, result.state.velocity.y, result.state.velocity.z);
          this.prediction.record({
            sequence: command.sequence,
            targetPhysicsTick: command.targetPhysicsTick,
            input: command,
            predictedBody: result.state,
            collisionRevisionVector: collisionWorld.revisionVector(),
          });
        }
        const body = this.predictedBody ?? snapshot.player.body;
        camera.setPosition(body.position.x, body.position.y + PLAYER_FEET_OFFSET, body.position.z);
      }
    }
    this.attackCooldownSeconds = Math.max(0, this.attackCooldownSeconds - dt);
    const target = this.aimTarget;
    this.publishAimTarget(target);
    if (this.miningHeld) {
      if (this.interactionBlocked) this.stopMining();
      else this.continueMining(target);
    }
    this.options.telemetry.endSpan(span);
  }

  releaseInput() {
    this.keys.clear();
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.stopMining();
    releasePointerLock();
  }

  applyAuthoritySnapshot(snapshot: AuthoritySnapshot): void {
    this.latestSnapshot = snapshot;
    this.grounded = snapshot.player.grounded;
    const world = this.options.getWorld();
    if (!world) {
      this.predictedBody = snapshot.player.body;
      return;
    }
    const collisionWorld = this.collisionWorld(world);
    const reconciled = this.prediction.reconcile({
      acknowledgedInputSequence: snapshot.acknowledgedInputSequence,
      authoritativeBody: snapshot.player.body,
      collisionRevisionVector: snapshot.chunkRevisions,
      replay: (body, command) =>
        stepBody({
          state: body,
          config: bodyConfigFor('player'),
          input: {
            wish: { x: command.state.moveX, z: command.state.moveZ },
            jumpPressed: command.state.jumpHeld || command.edges.jumpPressed,
            verticalIntent: command.state.verticalIntent,
          },
          world: collisionWorld,
          dt: 1 / this.options.physicsHz,
        }).state,
    });
    this.predictedBody = reconciled.body;
    this.velocity.set(reconciled.body.velocity.x, reconciled.body.velocity.y, reconciled.body.velocity.z);
    if (snapshot.inputResyncRequired) this.resynchronizeInput();
  }

  resynchronizeInput(): void {
    const tick = this.latestSnapshot?.physicsTick ?? 0;
    this.inputStream.resynchronize(tick);
    this.prediction.clear('authority-resync');
    this.predictedBody = this.latestSnapshot?.player.body ?? null;
    this.predictionAccumulator = 0;
  }

  setView(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = Math.max(-88, Math.min(88, pitch));
    this.options.camera.setEulerAngles(this.pitch, this.yaw, 0);
  }

  setSpectatorPosition(x: number, y: number, z: number) {
    this.spectator = true;
    this.velocity.set(0, 0, 0);
    this.options.camera.setPosition(x, y, z);
    this.options.getWorld()?.updateStreaming(this.options.camera.getPosition());
  }

  moveHarnessPlayer(x: number, z: number): Promise<void> {
    const world = this.options.getWorld();
    if (!world) return Promise.resolve();
    const position = this.options.camera.getPosition();
    return this.movePlayerTo(x, position.y, z);
  }

  async movePlayerTo(x: number, y: number, z: number) {
    const world = this.options.getWorld();
    if (!world) return;
    this.options.camera.setPosition(x, y, z);
    await this.options.authority.setPlayerPosition([x, y - PLAYER_FEET_OFFSET, z]);
    this.prediction.clear('teleport');
    this.predictedBody = null;
    world.updateStreaming(this.options.camera.getPosition());
  }

  async burstEdits() {
    const world = this.options.getWorld();
    if (!world) return;
    const position = this.options.camera.getPosition();
    const y = Math.floor(position.y - 4),
      x = Math.floor(position.x) + 4,
      z = Math.floor(position.z) + 4;
    await world.editBatch({
      actorId: 'harness-burst',
      edits: Array.from({ length: 6 }, (_, index) => ({
        x: x + index,
        y,
        z,
        value: index % 2 ? Voxel.Dirt : Voxel.Air,
      })),
    });
    this.options.onQueueSave();
  }

  async removeVoxel(x: number, y: number, z: number) {
    const world = this.options.getWorld();
    if (!world) return;
    await world.edit(x, y, z, Voxel.Air);
    this.options.onFlushSave();
  }

  async prepareFlatMovement() {
    const world = this.options.getWorld();
    if (!world) return;
    const edits = [];
    for (let x = -2; x <= 2; x += 1) for (let z = -8; z <= 2; z += 1) edits.push({ x, y: 56, z, value: Voxel.Stone });
    await world.editBatch({ actorId: 'harness-flat-movement', edits });
    await this.resetFixture(true, 0.5, 58.6, 0.5);
  }

  async prepareCenterExcavation() {
    const world = this.options.getWorld();
    if (!world) return;
    const edits = [];
    for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) edits.push({ x, y: 56, z, value: Voxel.Stone });
    edits.push({ x: 0, y: 56, z: 0, value: Voxel.Air });
    await world.editBatch({ actorId: 'harness-center-excavation', edits });
    await this.resetFixture(false, 0, 58.6, 0);
  }

  async prepareStepDown() {
    const world = this.options.getWorld();
    if (!world) return;
    const edits = [];
    for (let x = -2; x <= 2; x += 1)
      for (let z = -8; z <= 2; z += 1) {
        edits.push({ x, y: 55, z, value: Voxel.Stone });
        edits.push({ x, y: 56, z, value: z >= 0 ? Voxel.Stone : Voxel.Air });
      }
    await world.editBatch({ actorId: 'harness-step-down', edits });
    await this.resetFixture(true, 0.5, 58.6, 0.5);
  }

  private async shiftWorldTime(delta: number) {
    const world = this.options.getWorld();
    const environment = this.options.getEnvironment();
    if (!world || !environment) return;
    environment.setTime(await world.setWorldTime(world.worldTime + delta));
  }

  private async resetFixture(onGround: boolean, x: number, y: number, z: number) {
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.grounded = onGround;
    this.options.camera.setPosition(x, y, z);
    await this.options.authority.setPlayerPosition([x, y - PLAYER_FEET_OFFSET, z]);
    this.prediction.clear('harness-fixture');
    this.predictedBody = null;
    this.options.getWorld()?.updateStreaming(this.options.camera.getPosition());
  }

  private collisionWorld(world: NonNullable<ReturnType<PlayerControllerOptions['getWorld']>>) {
    return new VoxelCollisionWorld({
      getLoadedVoxel: (x, y, z) => {
        const cx = floorDiv(x, CHUNK_SIZE);
        const cy = floorDiv(y, CHUNK_SIZE);
        const cz = floorDiv(z, CHUNK_SIZE);
        const revision = world.getChunkRevision(cx, cy, cz);
        if (revision === null) return null;
        const fluid = world.getFluidCell(x, y, z);
        return {
          voxel: world.getVoxel(x, y, z),
          chunkKey: chunkKey(cx, cy, cz),
          revision,
          ...(fluid ? { fluid: { level: fluid.level } } : {}),
        };
      },
    });
  }

  private overlaps(left: WorldAabb, right: WorldAabb) {
    const epsilon = 1e-7;
    return (
      left.min.x < right.max.x - epsilon &&
      left.max.x > right.min.x + epsilon &&
      left.min.y < right.max.y - epsilon &&
      left.max.y > right.min.y + epsilon &&
      left.min.z < right.max.z - epsilon &&
      left.max.z > right.min.z + epsilon
    );
  }

  private interact(place: boolean) {
    this.attempts += 1;
    if (place && this.options.onUseHeldItem()) return;
    const target = this.aimTarget;
    if (!target) return this.options.onFeedback('距离过远', 'error');
    if (place) {
      if (!target.adjacent) return this.options.onFeedback('无法放置', 'error');
      this.options.onPlace(target.adjacent);
    }
  }

  private startMining() {
    this.attempts += 1;
    this.miningHeld = true;
    this.attackCooldownSeconds = 0;
    this.continueMining(this.aimTarget);
  }

  private continueMining(target: VoxelTarget | null) {
    const position = this.options.camera.getPosition();
    const direction = this.options.camera.forward;
    if (this.attackCooldownSeconds === 0) {
      this.attackCooldownSeconds = 0.2;
      const obstacle = this.traceTarget();
      this.attackBlocking = this.options.onAttackTarget(
        [position.x, position.y, position.z],
        [direction.x, direction.y, direction.z],
        Math.min(3, obstacle?.distance ?? 3),
      );
      if (this.attackBlocking) {
        this.cancelActiveMining();
        return;
      }
    }
    if (this.attackBlocking) return;
    const targetKey = target?.position.join(',') ?? null;
    if (!target || !targetKey) {
      this.cancelActiveMining();
      return;
    }
    if (targetKey === this.activeMiningTarget) return;
    this.cancelActiveMining();
    this.options.onBeginBreak(target.position);
    this.activeMiningTarget = targetKey;
  }

  private cancelActiveMining() {
    if (!this.activeMiningTarget) return;
    this.options.onCancelBreak();
    this.activeMiningTarget = null;
  }

  private stopMining() {
    this.miningHeld = false;
    this.cancelActiveMining();
  }

  private publishAimTarget(target: VoxelTarget | null) {
    const previous = this.publishedAimTarget;
    const adjacentEqual =
      previous?.adjacent === target?.adjacent ||
      Boolean(
        previous?.adjacent &&
        target?.adjacent &&
        previous.adjacent.every((value, index) => value === target.adjacent![index]),
      );
    const equal =
      previous === target ||
      Boolean(
        previous &&
        target &&
        previous.voxel === target.voxel &&
        previous.inRange === target.inRange &&
        previous.position.every((value, index) => value === target.position[index]) &&
        adjacentEqual,
      );
    if (equal) return;
    this.publishedAimTarget = target;
    this.options.onAimTarget?.(target);
  }
}
