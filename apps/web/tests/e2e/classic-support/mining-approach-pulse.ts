import { bodyConfigFor } from '@seedlands/stdlib/physics';
import type { ClassicSnapshot } from './harness-snapshot';
import type { Point, RoutePoint } from './scenario';
import { routeInputSettled, routePulseDurationMs } from './route-progress';
import { voxelInteractionDistance } from './target-aim';

export function createMiningApproachPulsePlanner(target: Point, approach: RoutePoint) {
  const speed = bodyConfigFor('player').maxHorizontalSpeed;
  if (!speed) throw new Error('Mining approach requires configured player speed.');
  let previous: Readonly<{ position: Point; requestedMs: number; epoch: string }> | undefined;
  let observedExcess = false;
  return (current: ClassicSnapshot): number => {
    const release = current.nativeMovementInput?.release;
    if (!current.onGround || current.colliding || !release?.neutral || !routeInputSettled(current, release.sequence)) {
      previous = undefined;
      observedExcess = false;
      return 100;
    }
    const epoch = current.nativeMovementInput!.epoch;
    if (previous?.epoch === epoch) {
      const travel = Math.hypot(
        current.serverPlayerPosition[0] - previous.position[0],
        current.serverPlayerPosition[2] - previous.position[2],
      );
      observedExcess ||= travel > (speed * previous.requestedMs) / 1000 + 0.05;
    } else observedExcess = false;
    const tooClose = [current.player, current.serverPlayerPosition].every(
      (position) => voxelInteractionDistance(position, target) < 2.5,
    );
    const maximumMs = observedExcess && tooClose ? 1 : 100;
    previous = {
      position: [...current.serverPlayerPosition],
      requestedMs: routePulseDurationMs(current.player, approach, maximumMs),
      epoch,
    };
    return maximumMs;
  };
}
