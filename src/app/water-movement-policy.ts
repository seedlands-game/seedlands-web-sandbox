export type WaterMovementMedium = { bodyFraction: number; swimming: boolean };

export type WaterMovementResolution = {
  horizontalSpeed: number;
  horizontalResponse: number;
  gravity: number;
  verticalVelocity: number;
  jumpAllowed: boolean;
};

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function resolveWaterMovement(
  medium: WaterMovementMedium,
  currentVerticalVelocity: number,
  seconds: number,
  verticalInput: -1 | 0 | 1,
): WaterMovementResolution {
  const immersion = clamp01(medium.bodyFraction);
  const horizontalSpeed = lerp(5.5, 2.35, immersion);
  const horizontalResponse = lerp(12, 5.5, immersion);
  const gravity = lerp(20, 2.8, immersion);
  if (!medium.swimming)
    return {
      horizontalSpeed,
      horizontalResponse,
      gravity,
      verticalVelocity: currentVerticalVelocity - gravity * seconds,
      jumpAllowed: true,
    };

  const drag = Math.exp(-5.5 * Math.max(0, seconds));
  const buoyancy = (immersion - 0.62) * 5.5;
  const verticalAcceleration = verticalInput * 7.5 + buoyancy;
  return {
    horizontalSpeed,
    horizontalResponse,
    gravity,
    verticalVelocity: currentVerticalVelocity * drag + verticalAcceleration * seconds,
    jumpAllowed: false,
  };
}
