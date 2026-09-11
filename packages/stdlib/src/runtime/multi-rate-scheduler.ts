export type SchedulerFrequencyConfig = Readonly<{
  physicsHz: number;
  gameplayHz: number;
  fluidHz: number;
  maxPhysicsCatchUpSteps?: number;
}>;

export type PhysicsDueStep = Readonly<{ tick: number; dtSeconds: number; integratedTimeMs: number }>;
export type CoalescedDue = Readonly<{ due: boolean; elapsedPeriods: number; coalescedPeriods: number }>;

export type MultiRateAdvance = Readonly<{
  physicsSteps: readonly PhysicsDueStep[];
  gameplay: CoalescedDue;
  fluid: CoalescedDue;
  integratedPhysicsTimeMs: number;
  physicsDebtMs: number;
}>;

export type MultiRateSchedulerSnapshot = Readonly<{
  version: 1;
  nextPhysicsDueMs: number;
  nextGameplayDueMs: number;
  nextFluidDueMs: number;
  integratedTimeMs: number;
  physicsTick: number;
  lastTargetMs: number;
}>;

const DUE_EPSILON_MS = 1e-7;

function assertFrequency(name: string, frequency: number) {
  if (!Number.isFinite(frequency) || frequency <= 0) throw new RangeError(`${name} must be positive.`);
}

export function validateMultiRateSchedulerSnapshot(
  snapshot: MultiRateSchedulerSnapshot,
  activeTimeMs: number,
): MultiRateSchedulerSnapshot {
  if (!snapshot || snapshot.version !== 1) throw new TypeError('Scheduler snapshot is invalid.');
  for (const value of [
    snapshot.nextPhysicsDueMs,
    snapshot.nextGameplayDueMs,
    snapshot.nextFluidDueMs,
    snapshot.integratedTimeMs,
    snapshot.lastTargetMs,
  ])
    if (!Number.isFinite(value) || value < 0) throw new TypeError('Scheduler snapshot time is invalid.');
  if (!Number.isSafeInteger(snapshot.physicsTick) || snapshot.physicsTick < 0)
    throw new TypeError('Scheduler snapshot tick is invalid.');
  if (snapshot.lastTargetMs > activeTimeMs) throw new TypeError('Scheduler snapshot frontier exceeds active time.');
  return { ...snapshot };
}

export class MultiRateScheduler {
  private readonly config: SchedulerFrequencyConfig;
  private readonly physicsIntervalMs: number;
  private readonly gameplayIntervalMs: number;
  private readonly fluidIntervalMs: number;
  private readonly maxPhysicsCatchUpSteps: number;
  private nextPhysicsDueMs: number;
  private nextGameplayDueMs: number;
  private nextFluidDueMs: number;
  private integratedTimeMs: number;
  private physicsTick = 0;
  private lastTargetMs: number;

  constructor(config: SchedulerFrequencyConfig, startActiveTimeMs = 0, restored?: MultiRateSchedulerSnapshot) {
    this.config = { ...config };
    assertFrequency('physicsHz', config.physicsHz);
    assertFrequency('gameplayHz', config.gameplayHz);
    assertFrequency('fluidHz', config.fluidHz);
    if (!Number.isFinite(startActiveTimeMs) || startActiveTimeMs < 0)
      throw new RangeError('startActiveTimeMs must be non-negative.');
    this.maxPhysicsCatchUpSteps = config.maxPhysicsCatchUpSteps ?? 4;
    if (!Number.isInteger(this.maxPhysicsCatchUpSteps) || this.maxPhysicsCatchUpSteps < 1)
      throw new RangeError('maxPhysicsCatchUpSteps must be a positive integer.');
    this.physicsIntervalMs = 1_000 / config.physicsHz;
    this.gameplayIntervalMs = 1_000 / config.gameplayHz;
    this.fluidIntervalMs = 1_000 / config.fluidHz;
    this.integratedTimeMs = startActiveTimeMs;
    this.lastTargetMs = startActiveTimeMs;
    this.nextPhysicsDueMs = startActiveTimeMs + this.physicsIntervalMs;
    this.nextGameplayDueMs = startActiveTimeMs + this.gameplayIntervalMs;
    this.nextFluidDueMs = startActiveTimeMs + this.fluidIntervalMs;
    if (restored) this.restore(restored, startActiveTimeMs);
  }

  snapshot(): MultiRateSchedulerSnapshot {
    return {
      version: 1,
      nextPhysicsDueMs: this.nextPhysicsDueMs,
      nextGameplayDueMs: this.nextGameplayDueMs,
      nextFluidDueMs: this.nextFluidDueMs,
      integratedTimeMs: this.integratedTimeMs,
      physicsTick: this.physicsTick,
      lastTargetMs: this.lastTargetMs,
    };
  }

  previewAdvanceTo(activeTimeMs: number): MultiRateAdvance {
    return new MultiRateScheduler(this.config, activeTimeMs, this.snapshot()).advanceTo(activeTimeMs);
  }

  advanceTo(activeTimeMs: number): MultiRateAdvance {
    if (!Number.isFinite(activeTimeMs) || activeTimeMs < this.lastTargetMs)
      throw new RangeError('Scheduler target must be finite and monotonic.');
    this.lastTargetMs = activeTimeMs;
    const physicsSteps: PhysicsDueStep[] = [];
    while (
      this.nextPhysicsDueMs <= activeTimeMs + DUE_EPSILON_MS &&
      physicsSteps.length < this.maxPhysicsCatchUpSteps
    ) {
      this.physicsTick += 1;
      this.integratedTimeMs += this.physicsIntervalMs;
      physicsSteps.push({
        tick: this.physicsTick,
        dtSeconds: this.physicsIntervalMs / 1_000,
        integratedTimeMs: this.integratedTimeMs,
      });
      this.nextPhysicsDueMs += this.physicsIntervalMs;
    }
    const gameplay = this.consumeCoalesced(activeTimeMs, 'gameplay');
    const fluid = this.consumeCoalesced(activeTimeMs, 'fluid');
    return {
      physicsSteps,
      gameplay,
      fluid,
      integratedPhysicsTimeMs: this.integratedTimeMs,
      physicsDebtMs: Math.max(0, activeTimeMs - this.integratedTimeMs),
    };
  }

  private consumeCoalesced(activeTimeMs: number, lane: 'gameplay' | 'fluid'): CoalescedDue {
    const interval = lane === 'gameplay' ? this.gameplayIntervalMs : this.fluidIntervalMs;
    const nextDue = lane === 'gameplay' ? this.nextGameplayDueMs : this.nextFluidDueMs;
    if (nextDue > activeTimeMs + DUE_EPSILON_MS) return { due: false, elapsedPeriods: 0, coalescedPeriods: 0 };
    const elapsedPeriods = Math.floor((activeTimeMs - nextDue + DUE_EPSILON_MS) / interval) + 1;
    if (lane === 'gameplay') this.nextGameplayDueMs += elapsedPeriods * interval;
    else this.nextFluidDueMs += elapsedPeriods * interval;
    return { due: true, elapsedPeriods, coalescedPeriods: elapsedPeriods - 1 };
  }

  private restore(snapshot: MultiRateSchedulerSnapshot, activeTimeMs: number): void {
    const restored = validateMultiRateSchedulerSnapshot(snapshot, activeTimeMs);
    this.nextPhysicsDueMs = restored.nextPhysicsDueMs;
    this.nextGameplayDueMs = restored.nextGameplayDueMs;
    this.nextFluidDueMs = restored.nextFluidDueMs;
    this.integratedTimeMs = restored.integratedTimeMs;
    this.physicsTick = restored.physicsTick;
    this.lastTargetMs = restored.lastTargetMs;
  }
}
