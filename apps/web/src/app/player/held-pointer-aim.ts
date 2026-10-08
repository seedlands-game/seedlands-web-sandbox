import type { PlayerControllerOptions } from './player-controller-types';

/** Captures the latest actual mouse orientation without waiting for a render frame. */
export function captureHeldPointerAim(
  options: PlayerControllerOptions,
  pitch: number,
  yaw: number,
  maxDistance = 3,
): boolean {
  options.camera.setEulerAngles(pitch, yaw, 0);
  const direction = options.camera.forward;
  const position = options.camera.getPosition();
  return (options.onHeldAttackTarget ?? options.onAttackTarget)(
    [position.x, position.y, position.z],
    [direction.x, direction.y, direction.z],
    maxDistance,
  );
}
