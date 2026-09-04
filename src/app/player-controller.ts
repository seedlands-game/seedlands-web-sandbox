import * as pc from 'playcanvas';
import { Voxel, isSolid, voxelNames } from '../world/voxel';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { AppElements } from './app-elements';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';

const PLAYER_HALF_WIDTH = 0.32;
export const PLAYER_FEET_OFFSET = 1.6;
const PLAYER_HEAD_OFFSET = 0.2;
const COLLISION_EPSILON = 0.001;

type PlayerControllerOptions = {
  camera: pc.Entity;
  elements: Pick<AppElements, 'canvas' | 'debug' | 'hotbar' | 'interactionFeedback'>;
  telemetry: PerformanceTelemetry;
  getWorld: () => World | null;
  getEnvironment: () => WorldEnvironment | null;
  onToggleMap: () => void;
  onQueueSave: () => void;
  onFlushSave: () => void;
};

export class PlayerController {
  readonly velocity = new pc.Vec3();
  private yaw = 0;
  private pitch = -16;
  private grounded = false;
  private chosen: number = Voxel.Dirt;
  private readonly keys = new Set<string>();
  private attempts = 0;
  private spectator = false;
  private feedbackTimer: number | null = null;

  constructor(private readonly options: PlayerControllerOptions) {}

  get onGround() {
    return this.grounded;
  }

  get interactionAttempts() {
    return this.attempts;
  }

  get position() {
    return this.options.camera.getPosition();
  }

  get isColliding() {
    return this.collides(this.options.camera.getPosition());
  }

  install() {
    const { canvas, debug } = this.options.elements;
    window.onkeydown = (event) => {
      if (event.code === 'F3') {
        event.preventDefault();
        debug.hidden = !debug.hidden;
        return;
      }
      if (event.code === 'KeyM') {
        this.options.onToggleMap();
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
      if (/^Digit[1-4]$/.test(event.code)) {
        this.chosen = [Voxel.Dirt, Voxel.Stone, Voxel.Wood, Voxel.Sand][Number(event.code[5]) - 1];
        this.renderHotbar();
      }
    };
    window.onkeyup = (event) => this.keys.delete(event.code);
    canvas.oncontextmenu = (event) => event.preventDefault();
    canvas.onclick = () => canvas.requestPointerLock();
    document.onmousemove = (event) => {
      if (document.pointerLockElement === canvas) {
        this.yaw -= event.movementX * 0.13;
        this.pitch = Math.max(-88, Math.min(88, this.pitch - event.movementY * 0.13));
      }
    };
    document.onmousedown = (event) => {
      if (document.pointerLockElement !== canvas) return;
      if (event.button === 0)
        this.options.telemetry.withSpan('input', 'PointerInteraction', () => this.interact(false));
      if (event.button === 2) this.options.telemetry.withSpan('input', 'PointerInteraction', () => this.interact(true));
    };
    this.renderHotbar();
  }

  dispose() {
    window.onkeydown = null;
    window.onkeyup = null;
    document.onmousemove = null;
    document.onmousedown = null;
    this.options.elements.canvas.onclick = null;
    this.options.elements.canvas.oncontextmenu = null;
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.keys.clear();
  }

  update(dt: number) {
    const world = this.options.getWorld();
    if (!world) return;
    const camera = this.options.camera;
    camera.setEulerAngles(this.pitch, this.yaw, 0);
    const span = this.options.telemetry.beginSpan('player', 'PlayerMovement');
    if (!this.spectator) {
      const forward = new pc.Vec3().copy(camera.forward);
      forward.y = 0;
      forward.normalize();
      const right = new pc.Vec3().copy(camera.right);
      right.y = 0;
      right.normalize();
      const wish = new pc.Vec3();
      if (this.keys.has('KeyW')) wish.add(forward);
      if (this.keys.has('KeyS')) wish.sub(forward);
      if (this.keys.has('KeyD')) wish.add(right);
      if (this.keys.has('KeyA')) wish.sub(right);
      if (wish.lengthSq() > 0) wish.normalize().mulScalar(5.5);
      this.velocity.x += (wish.x - this.velocity.x) * Math.min(1, dt * 12);
      this.velocity.z += (wish.z - this.velocity.z) * Math.min(1, dt * 12);
      this.velocity.y -= 20 * dt;
      if (this.keys.has('Space') && this.grounded) {
        this.velocity.y = 7.5;
        this.grounded = false;
      }
      this.moveAxis('x', this.velocity.x * dt);
      this.moveAxis('z', this.velocity.z * dt);
      this.grounded = false;
      this.moveAxis('y', this.velocity.y * dt);
    }
    this.options.telemetry.endSpan(span);
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

  moveHarnessPlayer(x: number, z: number) {
    const world = this.options.getWorld();
    if (!world) return;
    const position = this.options.camera.getPosition();
    this.options.camera.setPosition(x, position.y, z);
    world.updateStreaming(this.options.camera.getPosition());
  }

  movePlayerTo(x: number, y: number, z: number) {
    const world = this.options.getWorld();
    if (!world) return;
    this.options.camera.setPosition(x, y, z);
    world.updateStreaming(this.options.camera.getPosition());
  }

  burstEdits() {
    const world = this.options.getWorld();
    if (!world) return;
    const position = this.options.camera.getPosition();
    const y = Math.floor(position.y - 4),
      x = Math.floor(position.x) + 4,
      z = Math.floor(position.z) + 4;
    for (let index = 0; index < 6; index += 1) world.edit(x + index, y, z, index % 2 ? Voxel.Dirt : Voxel.Air);
    this.options.onQueueSave();
  }

  removeVoxel(x: number, y: number, z: number) {
    const world = this.options.getWorld();
    if (!world) return;
    world.edit(x, y, z, Voxel.Air);
    this.options.onFlushSave();
  }

  prepareFlatMovement() {
    const world = this.options.getWorld();
    if (!world) return;
    for (let x = -2; x <= 2; x += 1) for (let z = -8; z <= 2; z += 1) world.edit(x, 56, z, Voxel.Stone);
    this.resetFixture(true, 0.5, 58.6, 0.5);
  }

  prepareCenterExcavation() {
    const world = this.options.getWorld();
    if (!world) return;
    for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) world.edit(x, 56, z, Voxel.Stone);
    world.edit(0, 56, 0, Voxel.Air);
    this.resetFixture(false, 0, 58.6, 0);
  }

  prepareStepDown() {
    const world = this.options.getWorld();
    if (!world) return;
    for (let x = -2; x <= 2; x += 1)
      for (let z = -8; z <= 2; z += 1) {
        world.edit(x, 55, z, Voxel.Stone);
        world.edit(x, 56, z, z >= 0 ? Voxel.Stone : Voxel.Air);
      }
    this.resetFixture(true, 0.5, 58.6, 0.5);
  }

  private shiftWorldTime(delta: number) {
    const world = this.options.getWorld();
    const environment = this.options.getEnvironment();
    if (!world || !environment) return;
    world.server.setWorldTime(world.server.worldTime + delta);
    environment.setTime(world.server.worldTime);
  }

  private resetFixture(onGround: boolean, x: number, y: number, z: number) {
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.grounded = onGround;
    this.options.camera.setPosition(x, y, z);
    this.options.getWorld()?.updateStreaming(this.options.camera.getPosition());
  }

  private moveAxis(axis: 'x' | 'y' | 'z', amount: number) {
    const world = this.options.getWorld();
    if (!world || amount === 0) return;
    const position = this.options.camera.getPosition();
    const previousOverlap = axis === 'y' ? 0 : this.collisionOverlap(position);
    (position as unknown as Record<string, number>)[axis] += amount;
    if (axis === 'y') {
      const collisionY =
        amount < 0
          ? Math.floor(position.y - PLAYER_FEET_OFFSET)
          : Math.floor(position.y + PLAYER_HEAD_OFFSET - COLLISION_EPSILON);
      const blocked = amount < 0 ? this.hasGroundSupport(position, collisionY) : this.collidesAtY(position, collisionY);
      if (blocked) {
        position.set(
          position.x,
          amount < 0 ? collisionY + 1 + PLAYER_FEET_OFFSET : collisionY - PLAYER_HEAD_OFFSET,
          position.z,
        );
        if (amount < 0) this.grounded = true;
        this.velocity.y = 0;
        if (amount < 0) this.depenetrateHorizontally(position);
      }
    } else {
      const nextOverlap = this.collisionOverlap(position);
      if (nextOverlap > 0 && nextOverlap >= previousOverlap)
        (position as unknown as Record<string, number>)[axis] -= amount;
    }
    this.options.camera.setPosition(position);
  }

  private collides(position: pc.Vec3) {
    return this.collisionOverlap(position) > 0;
  }

  private collisionOverlap(position: pc.Vec3) {
    const world = this.options.getWorld();
    if (!world) return 0;
    const minX = position.x - PLAYER_HALF_WIDTH;
    const maxX = position.x + PLAYER_HALF_WIDTH;
    const minY = position.y - PLAYER_FEET_OFFSET + COLLISION_EPSILON;
    const maxY = position.y + PLAYER_HEAD_OFFSET - COLLISION_EPSILON;
    const minZ = position.z - PLAYER_HALF_WIDTH;
    const maxZ = position.z + PLAYER_HALF_WIDTH;
    let overlap = 0;
    for (let x = Math.floor(minX); x <= Math.floor(maxX - COLLISION_EPSILON); x += 1) {
      const overlapX = Math.min(maxX, x + 1) - Math.max(minX, x);
      for (let y = Math.floor(minY); y <= Math.floor(maxY - COLLISION_EPSILON); y += 1) {
        const overlapY = Math.min(maxY, y + 1) - Math.max(minY, y);
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ - COLLISION_EPSILON); z += 1)
          if (isSolid(world.getVoxel(x, y, z)))
            overlap += overlapX * overlapY * (Math.min(maxZ, z + 1) - Math.max(minZ, z));
      }
    }
    return overlap;
  }

  private depenetrateHorizontally(position: pc.Vec3) {
    const world = this.options.getWorld();
    if (!world || this.collisionOverlap(position) === 0) return;
    const minX = position.x - PLAYER_HALF_WIDTH;
    const maxX = position.x + PLAYER_HALF_WIDTH;
    const minY = position.y - PLAYER_FEET_OFFSET + COLLISION_EPSILON;
    const maxY = position.y + PLAYER_HEAD_OFFSET - COLLISION_EPSILON;
    const minZ = position.z - PLAYER_HALF_WIDTH;
    const maxZ = position.z + PLAYER_HALF_WIDTH;
    let left = Infinity,
      right = -Infinity,
      backward = Infinity,
      forward = -Infinity;
    for (let x = Math.floor(minX); x <= Math.floor(maxX - COLLISION_EPSILON); x += 1)
      for (let y = Math.floor(minY); y <= Math.floor(maxY - COLLISION_EPSILON); y += 1)
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ - COLLISION_EPSILON); z += 1) {
          if (!isSolid(world.getVoxel(x, y, z))) continue;
          left = Math.min(left, x - maxX - COLLISION_EPSILON);
          right = Math.max(right, x + 1 - minX + COLLISION_EPSILON);
          backward = Math.min(backward, z - maxZ - COLLISION_EPSILON);
          forward = Math.max(forward, z + 1 - minZ + COLLISION_EPSILON);
        }
    const resolved = [
      [left, 0],
      [right, 0],
      [0, backward],
      [0, forward],
    ]
      .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
      .map(([x, z]) => ({ x, z, distance: Math.abs(x) + Math.abs(z) }))
      .sort((a, b) => a.distance - b.distance)
      .find(({ x, z }) => this.collisionOverlap(new pc.Vec3(position.x + x, position.y, position.z + z)) === 0);
    if (resolved) position.set(position.x + resolved.x, position.y, position.z + resolved.z);
  }

  private collidesAtY(position: pc.Vec3, y: number) {
    const world = this.options.getWorld();
    if (!world) return false;
    for (const x of [position.x - PLAYER_HALF_WIDTH, position.x + PLAYER_HALF_WIDTH])
      for (const z of [position.z - PLAYER_HALF_WIDTH, position.z + PLAYER_HALF_WIDTH])
        if (isSolid(world.getVoxel(Math.floor(x), y, Math.floor(z)))) return true;
    return false;
  }

  private hasGroundSupport(position: pc.Vec3, y: number) {
    const world = this.options.getWorld();
    return !!world && isSolid(world.getVoxel(Math.floor(position.x), y, Math.floor(position.z)));
  }

  private interact(place: boolean) {
    this.attempts += 1;
    const world = this.options.getWorld();
    if (!world) return;
    const position = this.options.camera.getPosition();
    const direction = this.options.camera.forward;
    let last: [number, number, number] | null = null;
    let hit: [number, number, number] | null = null;
    for (let distance = 0.15; distance < 7; distance += 0.08) {
      const cell: [number, number, number] = [
        Math.floor(position.x + direction.x * distance),
        Math.floor(position.y + direction.y * distance),
        Math.floor(position.z + direction.z * distance),
      ];
      if (isSolid(world.getVoxel(...cell))) {
        hit = cell;
        break;
      }
      last = cell;
    }
    const target = place ? last : hit;
    if (!target) return this.showFeedback('距离过远');
    if (place && this.playerOccupies(target)) return this.showFeedback('无法在玩家位置放置');
    const previous = world.getVoxel(...target);
    world.edit(...target, place ? this.chosen : Voxel.Air);
    this.showFeedback(place ? `放置 · ${voxelNames[this.chosen]}` : `采集 · ${voxelNames[previous] ?? '体素'}`);
    this.options.onQueueSave();
  }

  private showFeedback(message: string) {
    const feedback = this.options.elements.interactionFeedback;
    feedback.textContent = message;
    feedback.dataset.visible = 'true';
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => {
      feedback.dataset.visible = 'false';
      this.feedbackTimer = null;
    }, 900);
  }

  private playerOccupies([x, y, z]: [number, number, number]) {
    const position = this.options.camera.getPosition();
    return (
      x + 1 > position.x - PLAYER_HALF_WIDTH &&
      x < position.x + PLAYER_HALF_WIDTH &&
      z + 1 > position.z - PLAYER_HALF_WIDTH &&
      z < position.z + PLAYER_HALF_WIDTH &&
      y + 1 > position.y - PLAYER_FEET_OFFSET &&
      y < position.y + PLAYER_HEAD_OFFSET
    );
  }

  private renderHotbar() {
    const ids = [Voxel.Dirt, Voxel.Stone, Voxel.Wood, Voxel.Sand];
    const atlasTiles: Record<number, readonly [number, number]> = {
      [Voxel.Dirt]: [2, 0],
      [Voxel.Stone]: [0, 1],
      [Voxel.Wood]: [2, 1],
      [Voxel.Sand]: [1, 1],
    };
    this.options.elements.hotbar.innerHTML = ids
      .map((id, index) => {
        const [column, row] = atlasTiles[id];
        return `<div class="slot ${id === this.chosen ? 'active' : ''}" data-material="${voxelNames[id]}"><span class="slot-key">${index + 1}</span><span class="slot-swatch" style="--tile-x:${column};--tile-y:${row}"></span><span class="slot-name">${voxelNames[id]}</span></div>`;
      })
      .join('');
  }
}
