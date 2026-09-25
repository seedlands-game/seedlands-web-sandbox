import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import type { GameplayEntity } from './entity-store';

type Position = [number, number, number];
const FACE_INTERIOR_EPSILON = 1e-6;

export const distanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

export const clonePosition = (position: readonly [number, number, number]): Position => [...position];
export const voxelCenter = (position: readonly [number, number, number]): Position => [
  position[0] + 0.5,
  position[1] + 0.5,
  position[2] + 0.5,
];
export const voxelAdjacentFacePoint = (
  hit: readonly [number, number, number],
  adjacent: readonly [number, number, number],
): Position =>
  hit.map(
    (coordinate, axis) => coordinate + 0.5 + (adjacent[axis] - coordinate) * (0.5 + FACE_INTERIOR_EPSILON),
  ) as Position;
export const playerInteractionOrigin = (position: readonly [number, number, number]): Position => [
  position[0],
  position[1] + 1.6,
  position[2],
];
export const positionsInRange = (left: readonly number[], right: readonly number[], radius: number) =>
  distanceSquared(left, right) <= radius * radius;

export const attackTargetPoint = (target: GameplayEntity): Position => {
  const bounds = bodyConfigFor(bodyKindForEntity(target)).localAabb;
  return [target.position[0], target.position[1] + (bounds.min.y + bounds.max.y) / 2, target.position[2]];
};
