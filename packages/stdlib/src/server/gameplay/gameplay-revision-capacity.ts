export function assertGameplayRevisionCapacity(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('Gameplay revision capacity is exhausted.');
}
