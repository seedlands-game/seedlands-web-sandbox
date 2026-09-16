export type ClockHandshake = Readonly<{ sessionOffsetMs: number }>;

export function createClockHandshake(input: { sessionTimeMs: number; localTimeMs: number }): ClockHandshake {
  if (!Number.isFinite(input.sessionTimeMs) || !Number.isFinite(input.localTimeMs))
    throw new TypeError('Clock handshake values must be finite.');
  return { sessionOffsetMs: input.sessionTimeMs - input.localTimeMs };
}

export function toSessionTime(handshake: ClockHandshake, localTimeMs: number): number {
  if (!Number.isFinite(localTimeMs)) throw new TypeError('Local time must be finite.');
  return localTimeMs + handshake.sessionOffsetMs;
}

export type ActiveClockSnapshot = Readonly<{
  activeTimeMs: number;
  elapsedRealTimeMs: number;
  paused: boolean;
}>;

export class ActiveMonotonicClock {
  private readonly startedAtMs: number;
  private lastTimeMs: number;
  private activeTimeMs = 0;
  private pausedValue = false;

  constructor(startTimeMs: number, initial: Readonly<{ activeTimeMs?: number; paused?: boolean }> = {}) {
    this.assertTime(startTimeMs);
    this.assertTime(initial.activeTimeMs ?? 0);
    if ((initial.activeTimeMs ?? 0) < 0) throw new RangeError('Initial active time must be non-negative.');
    this.startedAtMs = startTimeMs;
    this.lastTimeMs = startTimeMs;
    this.activeTimeMs = initial.activeTimeMs ?? 0;
    this.pausedValue = initial.paused ?? false;
  }

  get paused() {
    return this.pausedValue;
  }

  previewSample(nowMs: number): ActiveClockSnapshot {
    this.assertTime(nowMs);
    if (nowMs < this.lastTimeMs) throw new RangeError('Clock input must be monotonic.');
    return {
      activeTimeMs: this.activeTimeMs + (this.pausedValue ? 0 : nowMs - this.lastTimeMs),
      elapsedRealTimeMs: nowMs - this.startedAtMs,
      paused: this.pausedValue,
    };
  }

  sample(nowMs: number): ActiveClockSnapshot {
    const preview = this.previewSample(nowMs);
    this.activeTimeMs = preview.activeTimeMs;
    this.lastTimeMs = nowMs;
    return preview;
  }

  pause(nowMs: number) {
    const snapshot = this.sample(nowMs);
    this.pausedValue = true;
    return { ...snapshot, paused: true };
  }

  resume(nowMs: number) {
    const snapshot = this.sample(nowMs);
    this.pausedValue = false;
    return { ...snapshot, paused: false };
  }

  /** 暂停态的确定推进只增加模拟 active time，不把宿主 wall-clock 游标推到未来。 */
  advancePaused(elapsedMs: number): ActiveClockSnapshot {
    if (!this.pausedValue) throw new Error('Active clock must be paused before deterministic advancement.');
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
      throw new RangeError('Paused clock advance must be finite and non-negative.');
    this.activeTimeMs += elapsedMs;
    return {
      activeTimeMs: this.activeTimeMs,
      elapsedRealTimeMs: this.lastTimeMs - this.startedAtMs,
      paused: true,
    };
  }

  previewPausedAdvance(elapsedMs: number): ActiveClockSnapshot {
    if (!this.pausedValue) throw new Error('Active clock must be paused before deterministic advancement.');
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
      throw new RangeError('Paused clock advance must be finite and non-negative.');
    return {
      activeTimeMs: this.activeTimeMs + elapsedMs,
      elapsedRealTimeMs: this.lastTimeMs - this.startedAtMs,
      paused: true,
    };
  }

  private assertTime(timeMs: number) {
    if (!Number.isFinite(timeMs)) throw new TypeError('Clock input must be finite.');
  }
}
