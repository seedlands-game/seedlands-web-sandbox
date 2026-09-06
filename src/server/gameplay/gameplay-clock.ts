export function advanceGameplayClock(seconds: number, advanceStep: (seconds: number) => void): void {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new TypeError('Gameplay seconds must be non-negative and finite.');
  let remaining = seconds;
  while (remaining > 0) {
    const step = Math.min(1, remaining);
    advanceStep(step);
    remaining -= step;
  }
}
