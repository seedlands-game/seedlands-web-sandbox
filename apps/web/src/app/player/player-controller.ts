import * as pc from 'playcanvas';
import { Voxel } from '@seedlands/game-core/world/voxel';
import { releasePointerLock } from './pointer-lock';
import { traceVoxelTarget, type VoxelTarget } from '../../client/presentation/voxel-target';
import {
  DRY_WATER_IMMERSION,
  sampleWaterImmersion,
  type WaterImmersionSnapshot,
} from '@seedlands/game-core/world/water-immersion';
import type { PlayerControllerOptions } from './player-controller-types';
import { PLAYER_FEET_OFFSET } from './player-view-offsets';
import { LocalPlayerPrediction } from '../../client/local-player-prediction';
import { bodyConfigFor } from '@seedlands/game-core/physics';
import { VoxelCollisionWorld } from '@seedlands/game-core/server/authority/voxel-collision-world';
import { CHUNK_SIZE, chunkKey, floorDiv } from '@seedlands/game-core/world/voxel';
import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import { PlayerDebugTimeKeys } from './player-debug-time-keys';
import { bodyOverlapsWorld } from './player-collision-query';

export { PLAYER_FEET_OFFSET } from './player-view-offsets';

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
  private readonly prediction: LocalPlayerPrediction;
  private latestSnapshot: AuthoritySnapshot | null = null;
  private readonly debugTimeKeys: PlayerDebugTimeKeys;

  constructor(private readonly options: PlayerControllerOptions) {
    this.prediction = new LocalPlayerPrediction(options.authority?.epoch ?? 'unit-test', options.physicsHz, {
      estimatedInputTransitMs: options.estimatedInputTransitMs,
    });
    this.debugTimeKeys = new PlayerDebugTimeKeys(options);
  }

  get onGround() {
    return this.grounded;
  }
  get viewAngles(): readonly [number, number] {
    return [this.yaw, this.pitch];
  }
  get aimedVoxel(): readonly [number, number, number] | null {
    return this.aimTarget?.position ?? null;
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

  get predictedPhysicsState() {
    const body = this.prediction.physicalBody;
    if (!body) return null;
    return {
      state: body,
      physicsTick: this.prediction.pendingFrames.at(-1)?.targetPhysicsTick ?? this.latestSnapshot?.physicsTick ?? 0,
    };
  }

  get predictionDiagnostics() {
    return {
      pendingFrames: this.prediction.pendingFrames.length,
      lastResetReason: this.prediction.lastResetReason,
      resetCounts: this.prediction.resetCounts,
      presentationOffset: this.prediction.presentationOffset,
    };
  }

  get isColliding() {
    const world = this.options.getWorld();
    const body = this.prediction.physicalBody ?? this.latestSnapshot?.player.body;
    if (!world || !body) return false;
    return bodyOverlapsWorld(body, bodyConfigFor('player'), this.collisionWorld(world));
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
      if (this.debugTimeKeys.handleKeyDown(event)) return;
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
    window.onkeyup = (event) => {
      this.debugTimeKeys.handleKeyUp(event.code);
      this.keys.delete(event.code);
    };
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
    window.onblur = () => this.releaseInput();
    document.onvisibilitychange = this.handleVisibilityChange;
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
    document.onvisibilitychange = null;
    this.sendNeutralInput();
    this.options.canvas.onclick = null;
    this.options.canvas.oncontextmenu = null;
    this.keys.clear();
    this.debugTimeKeys.clear();
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
    const playerBounds = bodyConfigFor('player').localAabb;
    const feetY = cameraPosition.y - PLAYER_FEET_OFFSET;
    this.immersion = sampleWaterImmersion({
      cameraPosition: [cameraPosition.x, cameraPosition.y, cameraPosition.z],
      bodyBounds: {
        min: [cameraPosition.x + playerBounds.min.x, feetY + playerBounds.min.y, cameraPosition.z + playerBounds.min.z],
        max: [cameraPosition.x + playerBounds.max.x, feetY + playerBounds.max.y, cameraPosition.z + playerBounds.max.z],
      },
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
        const collisionWorld = this.collisionWorld(world);
        const prediction = this.prediction.advance({
          elapsedSeconds: dt,
          snapshot,
          world: collisionWorld,
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
        prediction.commands.forEach((command) => this.options.authority.sendInput(command));
        this.grounded = this.prediction.grounded;
        this.velocity.set(prediction.body.velocity.x, prediction.body.velocity.y, prediction.body.velocity.z);
        const presented = this.prediction.presentedBody(collisionWorld, dt);
        camera.setPosition(presented.position.x, presented.position.y + PLAYER_FEET_OFFSET, presented.position.z);
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
    this.sendNeutralInput();
    this.keys.clear();
    this.debugTimeKeys.clear();
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
      this.prediction.reset();
      return;
    }
    const reconciled = this.prediction.applyAuthoritySnapshot(snapshot, this.collisionWorld(world));
    this.velocity.set(reconciled.body.velocity.x, reconciled.body.velocity.y, reconciled.body.velocity.z);
    if (snapshot.inputResyncRequired) this.resynchronizeInput();
  }

  resynchronizeInput(): void {
    if (this.latestSnapshot) this.prediction.resynchronize(this.latestSnapshot);
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
    this.prediction.reset();
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
    this.prediction.reset();
    this.options.getWorld()?.updateStreaming(this.options.camera.getPosition());
  }

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.releaseInput();
  };

  private sendNeutralInput(): void {
    const snapshot = this.latestSnapshot ?? this.options.authority.snapshot();
    if (snapshot) this.options.authority.sendInput(this.prediction.interrupt(snapshot, performance.now()));
  }

  private collisionWorld(world: NonNullable<ReturnType<PlayerControllerOptions['getWorld']>>) {
    return new VoxelCollisionWorld({
      getChunkRevision: (key) => {
        const [cx, cy, cz] = key.split(',').map(Number);
        return world.getChunkRevision(cx!, cy!, cz!);
      },
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
