export type PhysicsTickObservation = Readonly<{ physicsTick: number }>;

export type DoorCollisionObservationWindow<Observation extends PhysicsTickObservation> = Readonly<{
  initialPhysicsTick: number;
  maximumPhysicsTick: number;
  deadlineMs: number;
  now: () => number;
  observe: () => Promise<Observation>;
  yieldControl: (milliseconds: number) => Promise<void>;
  isComplete: (observations: readonly Observation[]) => boolean;
}>;

/**
 * Collect only new Authority physics observations while retaining the caller's
 * original wall-clock and tick budgets. Repeated ticks yield for a bounded interval.
 */
export async function collectDoorCollisionObservations<Observation extends PhysicsTickObservation>(
  window: DoorCollisionObservationWindow<Observation>,
): Promise<Observation[]> {
  const observations: Observation[] = [];
  let previousTick = window.initialPhysicsTick;
  while (
    window.now() < window.deadlineMs &&
    previousTick < window.maximumPhysicsTick &&
    !window.isComplete(observations)
  ) {
    const current = await window.observe();
    // An asynchronous RPC may complete after either original budget has expired.
    if (window.now() >= window.deadlineMs || current.physicsTick > window.maximumPhysicsTick) break;
    if (current.physicsTick <= previousTick) {
      await window.yieldControl(16);
      continue;
    }
    observations.push(current);
    previousTick = current.physicsTick;
    if (window.isComplete(observations)) break;
  }
  return observations;
}
