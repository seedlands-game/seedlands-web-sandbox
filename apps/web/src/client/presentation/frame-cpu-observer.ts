import type { AuthorityReceiveWallSnapshot } from '../authority/authority-receive-wall-observer';

export type FrameCpuSample = Readonly<{
  frameSequence: number;
  updateWallMs: number;
  renderWallMs: number;
  renderEnvelopeWallMs: number;
  renderTailWallMs: number;
  tickWallMs: number;
  interTickGapWallMs: number | null;
  receiveGapWallMs: number | null;
  receiveGapCount: number | null;
}>;
export type FrameCpuSnapshot = Readonly<{ sampleCount: number; samples: readonly FrameCpuSample[] }>;

type FrameEvents = {
  on(name: string, listener: () => void): unknown;
  off(name: string, listener: () => void): unknown;
};
type PendingFrame = {
  sequence: number;
  start: number;
  gap: number | null;
  receiveGap: Readonly<{ wallMs: number; count: number }> | null;
  updateEnd?: number;
  renderStart?: number;
  renderEnd?: number;
};

// Public default-build events measure synchronous CPU/driver wall intervals, never GPU execution.
export class FrameCpuObserver {
  private events: FrameEvents | null = null;
  private pending: PendingFrame | null = null;
  private sequence = 0;
  private lastEnd: number | null = null;
  private receiveBaseline: AuthorityReceiveWallSnapshot | null = null;
  private readonly samples: FrameCpuSample[] = [];
  private readonly listeners: Readonly<Record<string, () => void>> = {
    frameupdate: () => {
      const start = this.now();
      const gap = this.lastEnd === null ? null : start - this.lastEnd;
      this.pending =
        Number.isFinite(start) && (this.lastEnd === null || start >= this.lastEnd)
          ? { sequence: ++this.sequence, start, gap, receiveGap: this.receiveDelta(gap) }
          : null;
      this.lastEnd = null;
      this.receiveBaseline = null;
    },
    framerender: () => {
      const end = this.now();
      if (!this.pending || this.pending.updateEnd !== undefined || !Number.isFinite(end) || end < this.pending.start)
        this.pending = null;
      else this.pending.updateEnd = end;
    },
    prerender: () => {
      const start = this.now();
      const updateEnd = this.pending?.updateEnd;
      if (
        updateEnd === undefined ||
        this.pending?.renderStart !== undefined ||
        !Number.isFinite(start) ||
        start < updateEnd
      )
        this.pending = null;
      else this.pending!.renderStart = start;
    },
    postrender: () => {
      const end = this.now();
      const frame = this.pending;
      if (
        !frame ||
        frame.renderStart === undefined ||
        frame.renderEnd !== undefined ||
        !Number.isFinite(end) ||
        end < frame.renderStart
      )
        this.pending = null;
      else frame.renderEnd = end;
    },
    frameend: () => {
      const end = this.now();
      const frame = this.pending;
      this.pending = null;
      if (
        !frame ||
        frame.updateEnd === undefined ||
        frame.renderStart === undefined ||
        frame.renderEnd === undefined ||
        !Number.isFinite(end) ||
        end < frame.renderEnd
      )
        return;
      this.lastEnd = end;
      this.receiveBaseline = this.readReceive();
      this.samples.push(
        Object.freeze({
          frameSequence: frame.sequence,
          updateWallMs: frame.updateEnd - frame.start,
          renderWallMs: frame.renderEnd - frame.renderStart,
          renderEnvelopeWallMs: end - frame.updateEnd,
          renderTailWallMs: end - frame.renderEnd,
          tickWallMs: end - frame.start,
          interTickGapWallMs: frame.gap,
          receiveGapWallMs: frame.receiveGap?.wallMs ?? null,
          receiveGapCount: frame.receiveGap?.count ?? null,
        }),
      );
      if (this.samples.length > this.capacity) this.samples.shift();
    },
    destroy: () => this.reset(),
  };

  constructor(
    private readonly now: () => number,
    private readonly capacity = 128,
    private readonly receive: () => AuthorityReceiveWallSnapshot | null = () => null,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024) throw new RangeError('Invalid frame capacity.');
  }

  attach(events: FrameEvents): void {
    if (this.events === events) return;
    this.reset();
    this.events = events;
    for (const [name, listener] of Object.entries(this.listeners)) events.on(name, listener);
  }

  reset(): void {
    for (const [name, listener] of Object.entries(this.listeners)) this.events?.off(name, listener);
    this.events = null;
    this.pending = null;
    this.sequence = 0;
    this.lastEnd = null;
    this.receiveBaseline = null;
    this.samples.length = 0;
  }

  snapshot(): FrameCpuSnapshot {
    return Object.freeze({
      sampleCount: this.samples.length,
      samples: Object.freeze(this.samples.map((sample) => Object.freeze({ ...sample }))),
    });
  }

  private readReceive(): AuthorityReceiveWallSnapshot | null {
    const value = this.receive();
    return value &&
      typeof value.runtimeEpoch === 'string' &&
      value.runtimeEpoch.length > 0 &&
      Number.isSafeInteger(value.generation) &&
      value.generation >= 0 &&
      Number.isSafeInteger(value.count) &&
      value.count >= 0 &&
      Number.isFinite(value.totalWallMs) &&
      value.totalWallMs >= 0
      ? { ...value }
      : null;
  }

  private receiveDelta(gap: number | null): Readonly<{ wallMs: number; count: number }> | null {
    const before = this.receiveBaseline;
    const after = this.readReceive();
    if (
      gap === null ||
      !before ||
      !after ||
      before.runtimeEpoch !== after.runtimeEpoch ||
      before.generation !== after.generation ||
      after.count < before.count ||
      after.totalWallMs < before.totalWallMs
    )
      return null;
    const wallMs = after.totalWallMs - before.totalWallMs;
    return wallMs <= gap ? { wallMs, count: after.count - before.count } : null;
  }
}
