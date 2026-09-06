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

const DUE_EPSILON_MS = 1e-7;

function assertFrequency(name: string, frequency: number) {
  if (!Number.isFinite(frequency) || frequency <= 0) throw new RangeError(`${name} must be positive.`);
}

export class MultiRateScheduler {
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

  constructor(config: SchedulerFrequencyConfig, startActiveTimeMs = 0) {
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
}
