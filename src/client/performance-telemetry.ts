export type SpanCategory =
  | 'frame'
  | 'input'
  | 'player'
  | 'streaming'
  | 'worldgen'
  | 'persistence'
  | 'meshing'
  | 'worker'
  | 'mutation'
  | 'entity'
  | 'render'
  | 'gpu-upload-estimated'
  | 'hud'
  | 'memory';

export type PerformanceSpan = {
  spanId: string;
  parentSpanId?: string;
  frameId?: number;
  traceId?: string;
  category: SpanCategory | string;
  name: string;
  lane: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
};

export type TraceMark = { name: string; lane: string; timestampMs: number };
export type PerformanceTrace = {
  traceId: string;
  category: string;
  name: string;
  lane: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  complete: boolean;
  marks: TraceMark[];
};
export type FrameSample = {
  frameId: number;
  durationMs: number;
  topSpans: Array<{ category: string; durationMs: number }>;
};
export type PerformanceIncident = {
  incidentId: string;
  trigger: 'long-frame' | 'chunk-latency';
  timestampMs: number;
  frameId?: number;
  topSpans: Array<{ category: string; durationMs: number }>;
  likelyCategory: string;
};
export type ChromeTrace = {
  traceEvents: Array<{ name: string; cat: string; ph: 'X'; ts: number; dur: number; pid: string; tid: string }>;
};

export type PerformanceTelemetryOptions = {
  now: () => number;
  frameCapacity?: number;
  eventCapacity?: number;
  incidentThresholdMs?: number;
  chunkLatencyIncidentMs?: number;
};
export type CompletedSpanInput = {
  category: SpanCategory | string;
  name: string;
  lane: string;
  durationMs: number;
  traceId?: string;
};

type CurrentFrame = { frameId: number; startMs: number; spans: PerformanceSpan[] };

const percentile = (values: number[], quantile: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
};

export class PerformanceTelemetry {
  private readonly frames: FrameSample[] = [];
  private readonly events: PerformanceSpan[] = [];
  private readonly traces = new Map<string, PerformanceTrace>();
  private readonly incidentsBuffer: PerformanceIncident[] = [];
  private readonly gauges = new Map<string, number>();
  private readonly activeSpans = new Map<string, PerformanceSpan>();
  private currentFrame: CurrentFrame | null = null;
  private frameSequence = 0;
  private spanSequence = 0;
  private traceSequence = 0;
  private incidentSequence = 0;
  private droppedFrames = 0;
  private droppedEvents = 0;
  private readonly frameCapacity: number;
  private readonly eventCapacity: number;
  private readonly incidentThresholdMs: number;
  private readonly chunkLatencyIncidentMs: number;

  constructor(private readonly options: PerformanceTelemetryOptions) {
    this.frameCapacity = options.frameCapacity ?? 240;
    this.eventCapacity = options.eventCapacity ?? 1024;
    this.incidentThresholdMs = options.incidentThresholdMs ?? 10;
    this.chunkLatencyIncidentMs = options.chunkLatencyIncidentMs ?? 500;
  }

  beginFrame(): number {
    const frameId = ++this.frameSequence;
    this.currentFrame = { frameId, startMs: this.options.now(), spans: [] };
    return frameId;
  }

  reset() {
    this.frames.length = 0;
    this.events.length = 0;
    this.traces.clear();
    this.incidentsBuffer.length = 0;
    this.gauges.clear();
    this.activeSpans.clear();
    this.currentFrame = null;
    this.droppedFrames = 0;
    this.droppedEvents = 0;
  }

  endFrame(actualDurationMs?: number): FrameSample | null {
    if (!this.currentFrame) return null;
    const current = this.currentFrame;
    this.currentFrame = null;
    const durationMs = actualDurationMs ?? this.options.now() - current.startMs;
    return this.recordFrame({
      frameId: current.frameId,
      durationMs,
      topSpans: current.spans
        .filter((span) => span.durationMs !== undefined)
        .map((span) => ({ category: span.category, durationMs: span.durationMs! }))
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, 5),
    });
  }

  recordFrame(input: Omit<FrameSample, 'frameId'> & { frameId?: number }): FrameSample {
    const frame: FrameSample = { frameId: input.frameId ?? ++this.frameSequence, ...input };
    this.pushFrame(frame);
    if (frame.durationMs >= this.incidentThresholdMs) {
      this.captureIncident('long-frame', frame.durationMs, frame.frameId, frame.topSpans);
    }
    return frame;
  }

  beginSpan(category: SpanCategory | string, name: string, lane = 'main', traceId?: string): string {
    const spanId = `span-${++this.spanSequence}`;
    const parentSpanId = this.currentFrame?.spans.at(-1)?.spanId;
    const span: PerformanceSpan = {
      spanId,
      ...(parentSpanId ? { parentSpanId } : {}),
      ...(this.currentFrame ? { frameId: this.currentFrame.frameId } : {}),
      ...(traceId ? { traceId } : {}),
      category,
      name,
      lane,
      startMs: this.options.now(),
    };
    this.activeSpans.set(spanId, span);
    this.currentFrame?.spans.push(span);
    return spanId;
  }

  endSpan(spanId: string): PerformanceSpan | null {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;
    span.endMs = this.options.now();
    span.durationMs = span.endMs - span.startMs;
    this.activeSpans.delete(spanId);
    this.pushEvent(span);
    return span;
  }

  recordCompletedSpan(input: CompletedSpanInput): PerformanceSpan {
    const endMs = this.options.now();
    const span: PerformanceSpan = {
      spanId: `span-${++this.spanSequence}`,
      ...(input.traceId ? { traceId: input.traceId } : {}),
      category: input.category,
      name: input.name,
      lane: input.lane,
      startMs: endMs - input.durationMs,
      endMs,
      durationMs: input.durationMs,
    };
    this.pushEvent(span);
    return span;
  }

  withSpan<T>(category: SpanCategory | string, name: string, operation: () => T, lane = 'main', traceId?: string): T {
    const spanId = this.beginSpan(category, name, lane, traceId);
    try {
      return operation();
    } finally {
      this.endSpan(spanId);
    }
  }

  beginTrace(category: string, name: string, lane: string): string {
    const traceId = `trace-${++this.traceSequence}`;
    this.traces.set(traceId, {
      traceId,
      category,
      name,
      lane,
      startMs: this.options.now(),
      complete: false,
      marks: [{ name: 'requested', lane, timestampMs: this.options.now() }],
    });
    return traceId;
  }

  markTrace(traceId: string, name: string, lane: string) {
    const trace = this.traces.get(traceId);
    if (!trace) return;
    trace.marks.push({ name, lane, timestampMs: this.options.now() });
  }

  completeTrace(traceId: string, name: string, lane: string): PerformanceTrace | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;
    this.markTrace(traceId, name, lane);
    trace.endMs = this.options.now();
    trace.durationMs = trace.endMs - trace.startMs;
    trace.complete = true;
    if (trace.durationMs >= this.chunkLatencyIncidentMs)
      this.captureIncident('chunk-latency', trace.durationMs, undefined, [
        { category: trace.category, durationMs: trace.durationMs },
      ]);
    return trace;
  }

  trace(traceId: string): PerformanceTrace | null {
    return this.traces.get(traceId) ?? null;
  }

  traceSummary(category: string) {
    return this.traceSummaryFor(
      [...this.traces.values()].filter((trace) => trace.category === category).map((trace) => trace.traceId),
    );
  }

  traceSummaryFor(traceIds: Iterable<string>) {
    const selected = new Set(traceIds);
    const durations = [...this.traces.values()]
      .filter((trace) => selected.has(trace.traceId) && trace.complete && trace.durationMs !== undefined)
      .map((trace) => trace.durationMs!);
    return {
      count: durations.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      maxMs: durations.length ? Math.max(...durations) : 0,
    };
  }

  counter(name: string, value: number) {
    this.gauges.set(name, value);
    this.pushEvent({
      spanId: `metric-${name}-${this.spanSequence + 1}`,
      category: 'memory',
      name,
      lane: 'main',
      startMs: this.options.now(),
      endMs: this.options.now(),
      durationMs: 0,
    });
  }

  gauge(name: string, value: number) {
    this.gauges.set(name, value);
  }

  incidents(): readonly PerformanceIncident[] {
    return this.incidentsBuffer;
  }

  frameSummary() {
    const durations = this.frames.map((frame) => frame.durationMs);
    return {
      count: this.frames.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      maxMs: durations.length ? Math.max(...durations) : 0,
      longFrameCount: this.frames.filter((frame) => frame.durationMs >= this.incidentThresholdMs).length,
      lastLongFrameMs:
        [...this.frames].reverse().find((frame) => frame.durationMs >= this.incidentThresholdMs)?.durationMs ?? 0,
    };
  }

  snapshot() {
    return {
      ...this.frameSummary(),
      droppedFrames: this.droppedFrames,
      droppedEvents: this.droppedEvents,
      gauges: Object.fromEntries(this.gauges),
      completedTraces: [...this.traces.values()].filter((trace) => trace.complete).length,
      traceEventCount: [...this.traces.values()].reduce((count, trace) => count + trace.marks.length, 0),
    };
  }

  exportChromeTrace(): ChromeTrace {
    const spans = this.events
      .filter((span) => span.durationMs !== undefined)
      .map((span) => ({
        name: span.name,
        cat: span.category,
        ph: 'X' as const,
        ts: span.startMs * 1000,
        dur: span.durationMs! * 1000,
        pid: 'seedlands-client',
        tid: span.lane,
      }));
    const traces = [...this.traces.values()]
      .filter((trace) => trace.durationMs !== undefined)
      .map((trace) => ({
        name: trace.name,
        cat: trace.category,
        ph: 'X' as const,
        ts: trace.startMs * 1000,
        dur: trace.durationMs! * 1000,
        pid: 'seedlands-client',
        tid: trace.lane,
      }));
    return { traceEvents: [...spans, ...traces] };
  }

  private pushFrame(frame: FrameSample) {
    if (this.frames.length >= this.frameCapacity) {
      this.frames.shift();
      this.droppedFrames += 1;
    }
    this.frames.push(frame);
  }

  private pushEvent(span: PerformanceSpan) {
    if (this.events.length >= this.eventCapacity) {
      this.events.shift();
      this.droppedEvents += 1;
    }
    this.events.push(span);
  }

  private captureIncident(
    trigger: PerformanceIncident['trigger'],
    durationMs: number,
    frameId: number | undefined,
    topSpans: Array<{ category: string; durationMs: number }>,
  ) {
    const dominant = topSpans[0];
    this.incidentsBuffer.push({
      incidentId: `incident-${++this.incidentSequence}`,
      trigger,
      timestampMs: this.options.now(),
      ...(frameId === undefined ? {} : { frameId }),
      topSpans,
      likelyCategory: dominant ? dominant.category : durationMs >= this.incidentThresholdMs ? 'frame' : 'unknown',
    });
    if (this.incidentsBuffer.length > 32) this.incidentsBuffer.shift();
  }
}
