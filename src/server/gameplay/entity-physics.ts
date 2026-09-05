import { isSolid } from '../../world/voxel';
import { collisionBoxesForVoxel } from '../../world/voxel-model';
import type { EntityStore, GameplayEntity } from './entity-store';

type Position = [number, number, number];
type PickupTarget = { id: string; position: Position };

const STEP_SECONDS = 1 / 60;
const MAX_STEPS_PER_ADVANCE = 600;
const GRAVITY = 18;
const TERMINAL_VELOCITY = 24;
const ITEM_HALF_WIDTH = 0.2;
const ITEM_HALF_HEIGHT = 0.2;
const ACTOR_HALF_WIDTH = 0.32;
const ATTRACTION_RADIUS = 2.25;
const ATTRACTION_SPEED = 6;
const round = (value: number) => Number(value.toFixed(6));
const distanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((total, value, index) => total + (value - right[index]) ** 2, 0);

export function voxelRayIsClear(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  getVoxel: (x: number, y: number, z: number) => number,
): boolean {
  const delta = to.map((value, index) => value - from[index]);
  const length = Math.sqrt(delta.reduce((total, value) => total + value ** 2, 0));
  if (length <= Number.EPSILON) return true;
  const sourceVoxel = from.map(Math.floor).join(',');
  const targetVoxel = to.map(Math.floor).join(',');
  const steps = Math.ceil(length * 8);
  for (let index = 1; index < steps; index += 1) {
    const ratio = index / steps;
    const voxel: Position = [
      Math.floor(from[0] + delta[0] * ratio),
      Math.floor(from[1] + delta[1] * ratio),
      Math.floor(from[2] + delta[2] * ratio),
    ];
    if (voxel.join(',') !== sourceVoxel && voxel.join(',') !== targetVoxel && isSolid(getVoxel(...voxel))) return false;
  }
  return true;
}

export class EntityPhysics {
  private accumulator = 0;

  constructor(
    private readonly options: {
      entities: EntityStore;
      getVoxel: (x: number, y: number, z: number) => number;
      pickupTargets: () => PickupTarget[];
    },
  ) {}

  advance(seconds: number, afterStep: () => void): void {
    this.accumulator = round(this.accumulator + seconds);
    let steps = 0;
    while (this.accumulator + Number.EPSILON >= STEP_SECONDS && steps < MAX_STEPS_PER_ADVANCE) {
      this.accumulator = round(this.accumulator - STEP_SECONDS);
      this.step();
      afterStep();
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_ADVANCE && this.accumulator >= STEP_SECONDS) this.accumulator = STEP_SECONDS;
  }

  private step(): void {
    const targets = this.options.pickupTargets().sort((left, right) => left.id.localeCompare(right.id));
    for (const entity of this.options.entities.query()) {
      if (entity.type === 'player') continue;
      if (entity.type === 'world-item') this.attract(entity, targets);
      this.applyGravity(this.options.entities.get(entity.id)!);
    }
  }

  private attract(entity: GameplayEntity, targets: readonly PickupTarget[]): void {
    const target = targets.find(
      (candidate) =>
        distanceSquared(entity.position, candidate.position) <= ATTRACTION_RADIUS ** 2 &&
        voxelRayIsClear(entity.position, candidate.position, this.options.getVoxel),
    );
    if (!target) return;
    const delta = target.position.map((value, index) => value - entity.position[index]);
    const distance = Math.sqrt(delta.reduce((total, value) => total + value ** 2, 0));
    if (distance <= Number.EPSILON) return;
    const travel = Math.min(distance, ATTRACTION_SPEED * STEP_SECONDS);
    this.options.entities.move(entity.id, [
      round(entity.position[0] + (delta[0] / distance) * travel),
      round(entity.position[1] + (delta[1] / distance) * travel),
      round(entity.position[2] + (delta[2] / distance) * travel),
    ]);
  }

  private applyGravity(entity: GameplayEntity): void {
    const velocity = entity.physicsVelocity ?? [0, 0, 0];
    const nextVelocity: Position = [
      velocity[0],
      Math.max(-TERMINAL_VELOCITY, velocity[1] - GRAVITY * STEP_SECONDS),
      velocity[2],
    ];
    const halfWidth = entity.type === 'world-item' ? ITEM_HALF_WIDTH : ACTOR_HALF_WIDTH;
    const bottomOffset = entity.type === 'world-item' ? ITEM_HALF_HEIGHT : 0;
    const nextY = entity.position[1] + nextVelocity[1] * STEP_SECONDS;
    const floorY = this.floorAt(entity.position, nextY, halfWidth, bottomOffset);
    if (floorY !== null) {
      this.options.entities.update(entity.id, {
        position: [entity.position[0], round(floorY + bottomOffset), entity.position[2]],
        physicsVelocity: [0, 0, 0],
      });
      return;
    }
    this.options.entities.update(entity.id, {
      position: [entity.position[0], round(nextY), entity.position[2]],
      physicsVelocity: [round(nextVelocity[0]), round(nextVelocity[1]), round(nextVelocity[2])],
    });
  }

  private floorAt(position: Position, nextY: number, halfWidth: number, bottomOffset: number): number | null {
    const previousBottom = position[1] - bottomOffset;
    const nextBottom = nextY - bottomOffset;
    if (nextBottom > previousBottom) return null;
    const minimumX = Math.floor(position[0] - halfWidth);
    const maximumX = Math.floor(position[0] + halfWidth - Number.EPSILON);
    const minimumZ = Math.floor(position[2] - halfWidth);
    const maximumZ = Math.floor(position[2] + halfWidth - Number.EPSILON);
    let highest: number | null = null;
    for (let x = minimumX; x <= maximumX; x += 1)
      for (let z = minimumZ; z <= maximumZ; z += 1)
        for (let y = Math.floor(nextBottom); y <= Math.floor(previousBottom - Number.EPSILON); y += 1) {
          for (const box of collisionBoxesForVoxel(this.options.getVoxel(x, y, z))) {
            if (
              x + box.max[0] <= position[0] - halfWidth ||
              x + box.min[0] >= position[0] + halfWidth ||
              z + box.max[2] <= position[2] - halfWidth ||
              z + box.min[2] >= position[2] + halfWidth
            )
              continue;
            const top = y + box.max[1];
            if (top < nextBottom - Number.EPSILON) continue;
            if (highest === null || top > highest) highest = top;
          }
        }
    return highest;
  }
}
