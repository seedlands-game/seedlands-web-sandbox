export function validateMouseSensitivity(value: number): number {
  if (!Number.isFinite(value) || value < 0.03 || value > 0.5) throw new RangeError('Mouse sensitivity is invalid.');
  return value;
}
