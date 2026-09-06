import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import type { GameplayEntity } from './entity-store';

type Position = [number, number, number];

export const distanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

export const clonePosition = (position: readonly [number, number, number]): Position => [...position];

export const attackTargetPoint = (target: GameplayEntity): Position => {
  const bounds = bodyConfigFor(bodyKindForEntity(target)).localAabb;
  return [target.position[0], target.position[1] + (bounds.min.y + bounds.max.y) / 2, target.position[2]];
};
