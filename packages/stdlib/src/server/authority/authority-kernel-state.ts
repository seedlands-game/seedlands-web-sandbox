import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { KernelValue } from '@seedlands/kernel';
import {
  validateMultiRateSchedulerSnapshot,
  type MultiRateSchedulerSnapshot,
} from '../../runtime/multi-rate-scheduler';

export const AUTHORITY_RUNTIME_MODULE = 'seedlands:authority-runtime';
export const AUTHORITY_SESSION_STATE = 'seedlands:authority-session-state';

export type AuthorityKernelState = {
  version: 1;
  activeTimeMs: number;
  integratedPhysicsTimeMs: number;
  physicsDebtMs: number;
  physicsTick: number;
  gameplayPeriods: number;
  fluidPeriods: number;
  worldClockRate: number;
  paused: boolean;
  scheduler: MultiRateSchedulerSnapshot | null;
};

const nonNegativeFinite = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new TypeError(`Authority Kernel ${field} is invalid.`);
  return value;
};

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`Authority Kernel ${field} is invalid.`);
  return value;
};

export const createAuthorityKernelState = (): AuthorityKernelState => ({
  version: 1,
  activeTimeMs: 0,
  integratedPhysicsTimeMs: 0,
  physicsDebtMs: 0,
  physicsTick: 0,
  gameplayPeriods: 0,
  fluidPeriods: 0,
  worldClockRate: 0.04,
  paused: false,
  scheduler: null,
});

export function decodeAuthorityKernelState(value: KernelValue | undefined): AuthorityKernelState {
  if (value === undefined) return createAuthorityKernelState();
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new TypeError('Authority Kernel state is invalid.');
  const source = value as Readonly<Record<string, KernelValue>>;
  if (source.version !== 1 || typeof source.paused !== 'boolean')
    throw new TypeError('Authority Kernel state header is invalid.');
  const worldClockRate = nonNegativeFinite(source.worldClockRate, 'worldClockRate');
  if (worldClockRate > 24) throw new TypeError('Authority Kernel worldClockRate is invalid.');
  const activeTimeMs = nonNegativeFinite(source.activeTimeMs, 'activeTimeMs');
  const integratedPhysicsTimeMs = nonNegativeFinite(source.integratedPhysicsTimeMs, 'integratedPhysicsTimeMs');
  const physicsDebtMs = nonNegativeFinite(source.physicsDebtMs, 'physicsDebtMs');
  const physicsTick = nonNegativeInteger(source.physicsTick, 'physicsTick');
  const rawScheduler = source.scheduler as MultiRateSchedulerSnapshot | null;
  if (rawScheduler !== null && (!rawScheduler || typeof rawScheduler !== 'object'))
    throw new TypeError('Authority Kernel scheduler is invalid.');
  const scheduler = rawScheduler === null ? null : validateMultiRateSchedulerSnapshot(rawScheduler, activeTimeMs);
  if (scheduler && (scheduler.physicsTick !== physicsTick || scheduler.integratedTimeMs !== integratedPhysicsTimeMs))
    throw new TypeError('Authority Kernel scheduler does not match the session frontier.');
  if (scheduler && Math.max(0, activeTimeMs - integratedPhysicsTimeMs) !== physicsDebtMs)
    throw new TypeError('Authority Kernel physics debt does not match the session frontier.');
  return {
    version: 1,
    activeTimeMs,
    integratedPhysicsTimeMs,
    physicsDebtMs,
    physicsTick,
    gameplayPeriods: nonNegativeInteger(source.gameplayPeriods, 'gameplayPeriods'),
    fluidPeriods: nonNegativeInteger(source.fluidPeriods, 'fluidPeriods'),
    worldClockRate,
    paused: source.paused,
    scheduler,
  };
}

export const encodeAuthorityKernelState = (state: AuthorityKernelState): KernelValue =>
  ({
    ...state,
    scheduler: state.scheduler ? { ...state.scheduler } : null,
  }) as KernelValue;

export function installAuthorityKernelState(target: AuthorityKernelState, source: AuthorityKernelState): void {
  Object.assign(target, source, { scheduler: source.scheduler ? { ...source.scheduler } : null });
}

export type AuthorityKernelExecutionPort = Readonly<{
  readonly epoch: number;
  readonly commitSequence: number;
  sessionState(): AuthorityKernelState;
  assertCanCommit(count?: number): void;
  commit(): number;
}>;

export function createAuthorityKernelExecutionPort(
  owner: KernelStateOwner,
  state: AuthorityKernelState,
): AuthorityKernelExecutionPort {
  return Object.freeze({
    get epoch() {
      return owner.epoch;
    },
    get commitSequence() {
      return owner.commitSequence;
    },
    sessionState: () => state,
    assertCanCommit: (count = 1) => {
      owner.assertExpectedEpoch(owner.epoch);
      if (!Number.isSafeInteger(count) || count < 0)
        throw new RangeError('Kernel commit capacity must be a non-negative safe integer.');
      if (owner.commitSequence > Number.MAX_SAFE_INTEGER - count)
        throw new RangeError('Kernel commit sequence is exhausted.');
    },
    commit: () => {
      owner.assertExpectedEpoch(owner.epoch);
      if (owner.commitSequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Kernel commit sequence is exhausted.');
      return owner.commitEvent(owner.epoch);
    },
  });
}
