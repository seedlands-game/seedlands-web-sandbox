import * as pc from 'playcanvas';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft']);

export function updatePlayerMovementKeys(keys: Set<string>, code: string, pressed: boolean): boolean {
  const wasHeld = keys.has(code);
  if (pressed) keys.add(code);
  else keys.delete(code);
  return wasHeld !== pressed && MOVEMENT_KEYS.has(code);
}

/** Both event capture and fixed-step prediction use the current view basis. */
export function samplePlayerMovementInput(camera: pc.Entity, keys: ReadonlySet<string>) {
  const forward = new pc.Vec3().copy(camera.forward);
  forward.y = 0;
  forward.normalize();
  const right = new pc.Vec3().copy(camera.right);
  right.y = 0;
  right.normalize();
  return {
    forward: { x: forward.x, z: forward.z },
    right: { x: right.x, z: right.z },
    keys: {
      forward: keys.has('KeyW'),
      back: keys.has('KeyS'),
      left: keys.has('KeyA'),
      right: keys.has('KeyD'),
      jump: keys.has('Space'),
      crouch: keys.has('ShiftLeft'),
    },
  };
}
