import type { Point } from './scenario';

const MOUSE_SENSITIVITY_DEGREES = 0.13;
const MAX_MOUSE_STEP = 80;

const normalizeDegrees = (value: number) => {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
};

const clampStep = (value: number) => Math.max(-MAX_MOUSE_STEP, Math.min(MAX_MOUSE_STEP, value));

export const voxelInteractionDistance = (player: Point, target: Point) =>
  Math.hypot(target[0] + 0.5 - player[0], target[1] + 0.5 - player[1], target[2] + 0.5 - player[2]);

export function mouseCorrectionToVoxel(
  player: Point,
  viewAngles: readonly [number, number],
  target: Point,
): Readonly<{ dx: number; dy: number }> {
  const x = target[0] + 0.5 - player[0];
  const y = target[1] + 0.5 - player[1];
  const z = target[2] + 0.5 - player[2];
  const targetYaw = (Math.atan2(-x, -z) * 180) / Math.PI;
  const targetPitch = (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
  return {
    dx: clampStep(normalizeDegrees(viewAngles[0] - targetYaw) / MOUSE_SENSITIVITY_DEGREES),
    dy: clampStep((viewAngles[1] - targetPitch) / MOUSE_SENSITIVITY_DEGREES),
  };
}

export function mouseCorrectionToPoint(
  player: Point,
  viewAngles: readonly [number, number],
  target: Point,
): Readonly<{ dx: number; dy: number }> {
  const x = target[0] - player[0];
  const y = target[1] - player[1];
  const z = target[2] - player[2];
  const targetYaw = (Math.atan2(-x, -z) * 180) / Math.PI;
  const targetPitch = (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
  return {
    dx: clampStep(normalizeDegrees(viewAngles[0] - targetYaw) / MOUSE_SENSITIVITY_DEGREES),
    dy: clampStep((viewAngles[1] - targetPitch) / MOUSE_SENSITIVITY_DEGREES),
  };
}

export function horizontalMouseCorrectionToRoute(
  player: Point,
  yaw: number,
  target: readonly [number, number],
  direction: 'KeyW' | 'KeyS',
): number {
  const x = target[0] - player[0];
  const z = target[1] - player[2];
  const targetYaw = (Math.atan2(-x, -z) * 180) / Math.PI + (direction === 'KeyS' ? 180 : 0);
  return clampStep(normalizeDegrees(yaw - targetYaw) / MOUSE_SENSITIVITY_DEGREES);
}

export async function correctMouseToRoute(
  options: Readonly<{
    target: readonly [number, number];
    direction: 'KeyW' | 'KeyS';
    observe: () => Promise<Readonly<{ player: Point; viewAngles: readonly [number, number] }> | null>;
    move: (dx: number, dy: number) => Promise<void>;
  }>,
): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await options.observe();
    if (!current) continue;
    const dx = horizontalMouseCorrectionToRoute(
      current.player,
      current.viewAngles[0],
      options.target,
      options.direction,
    );
    if (Math.abs(dx) < 1) return;
    await options.move(dx, 0);
  }
}

export async function correctMouseUntilEntityAimed(
  options: Readonly<{
    entityId: string;
    observe: () => Promise<Readonly<{
      aimedEntityId: string | null;
      entityPosition: Point;
      player: Point;
      viewAngles: readonly [number, number];
    }> | null>;
    move: (dx: number, dy: number) => Promise<void>;
  }>,
): Promise<void> {
  let aimedEntityId: string | null = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const aim = await options.observe();
    if (!aim) throw new Error('Classic hostile presentation disappeared before combat aim.');
    aimedEntityId = aim.aimedEntityId;
    if (aimedEntityId === options.entityId) return;
    const target: Point = [aim.entityPosition[0], aim.entityPosition[1] + 0.9, aim.entityPosition[2]];
    const correction = mouseCorrectionToPoint(aim.player, aim.viewAngles, target);
    await options.move(correction.dx, correction.dy);
  }
  throw new Error(`Real mouse input did not acquire hostile ${options.entityId}; aimed=${String(aimedEntityId)}.`);
}
