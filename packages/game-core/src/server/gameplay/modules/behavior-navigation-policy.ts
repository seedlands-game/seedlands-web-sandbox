import type { BehaviorArguments } from '../../../runtime/behavior-control-protocol';
import type { CharacterPositionTuple } from '../../simulation/character-runtime-types';

export const behaviorDistance = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const behaviorPosition = (raw: unknown): CharacterPositionTuple =>
  [...(raw as readonly number[])] as CharacterPositionTuple;

export const behaviorNumberArgument = (args: BehaviorArguments, name: string, fallback: number): number =>
  typeof args[name] === 'number' ? args[name] : fallback;

export function behaviorPathIsSafe(
  memory: Readonly<{ position: CharacterPositionTuple }> | undefined,
  path: readonly CharacterPositionTuple[],
  threatClearance: number,
): boolean {
  if (!memory || !path.length) return true;
  const clearance = Math.min(threatClearance, behaviorDistance(path[0], memory.position)) - 0.1;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const delta = path[index].map((coordinate, axis) => coordinate - start[axis]);
    const squared = delta.reduce((sum, coordinate) => sum + coordinate * coordinate, 0);
    const along = squared
      ? Math.max(
          0,
          Math.min(
            1,
            delta.reduce((sum, coordinate, axis) => sum + coordinate * (memory.position[axis] - start[axis]), 0) /
              squared,
          ),
        )
      : 0;
    if (
      behaviorDistance(
        memory.position,
        start.map((coordinate, axis) => coordinate + delta[axis] * along),
      ) < clearance
    )
      return false;
  }
  return true;
}
