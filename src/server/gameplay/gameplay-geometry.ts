import type { GameplayEntity } from './entity-store';

type Position = [number, number, number];

export const distanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

export const clonePosition = (position: readonly [number, number, number]): Position => [...position];

export const attackTargetPoint = (target: GameplayEntity): Position => {
  const height = target.archetype === 'grazer' ? 1.9 : target.archetype === 'settler' ? 2.35 : 2.1;
  return [target.position[0], target.position[1] + height / 2, target.position[2]];
};
