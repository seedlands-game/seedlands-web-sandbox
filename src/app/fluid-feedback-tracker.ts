import type { PerformanceTrace } from '../client/performance-telemetry';

export type FluidSchedulingMetrics = { mergedRequests: number; supersededInFlight: number };

export type FluidFeedbackSample = {
  targetChunkKey: string;
  targetRevision: number;
  visibleRevision: number;
  traceId: string;
  editToCommitMs: number;
  commitToWorkerStartMs: number;
  workerMs: number;
  workerToAttachMs: number;
  attachToVisibleMs: number;
  totalMs: number;
  mergedRequests: number;
  supersededInFlight: number;
};

export type FluidFeedbackSummary = {
  count: number;
  pending: boolean;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  samples: FluidFeedbackSample[];
};

type PendingSample = {
  editAcceptedAt: number;
  firstCommitAt: number | null;
  targetRevisions: Map<string, number>;
  schedulingAtStart: FluidSchedulingMetrics;
};

export type VisibleFluidMesh = { chunkKey: string; chunkRevision: number; traceId: string };

const percentile = (values: number[], quantile: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
};

const latestMarkAtOrAfter = (trace: PerformanceTrace | null, name: string, earliest: number) =>
  trace?.marks.filter((mark) => mark.name === name && mark.timestampMs >= earliest).at(-1)?.timestampMs ?? earliest;

export class FluidFeedbackTracker {
  private pending: PendingSample | null = null;
  private readonly samples: FluidFeedbackSample[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  begin(metrics: FluidSchedulingMetrics) {
    this.pending = {
      editAcceptedAt: this.now(),
      firstCommitAt: null,
      targetRevisions: new Map(),
      schedulingAtStart: { ...metrics },
    };
  }

  markFirstCommit(targetChunks: Iterable<{ key: string; revision: number }>) {
    if (!this.pending || this.pending.firstCommitAt !== null) return;
    this.pending.firstCommitAt = this.now();
    this.pending.targetRevisions = new Map([...targetChunks].map(({ key, revision }) => [key, revision]));
  }

  completeVisible(visible: VisibleFluidMesh, trace: PerformanceTrace | null, metrics: FluidSchedulingMetrics) {
    const pending = this.pending;
    const targetRevision = pending?.targetRevisions.get(visible.chunkKey);
    if (
      !pending ||
      pending.firstCommitAt === null ||
      targetRevision === undefined ||
      visible.chunkRevision < targetRevision ||
      trace?.traceId !== visible.traceId ||
      !trace.complete ||
      !trace.marks.some((mark) => mark.name === 'visible-postrender')
    )
      return;
    const visibleAt = this.now();
    const workerStartAt = latestMarkAtOrAfter(trace, 'worker-start', pending.firstCommitAt);
    const workerCompleteAt = latestMarkAtOrAfter(trace, 'worker-complete', workerStartAt);
    const attachedAt = latestMarkAtOrAfter(trace, 'scene-attached', workerCompleteAt);
    this.samples.push({
      targetChunkKey: visible.chunkKey,
      targetRevision,
      visibleRevision: visible.chunkRevision,
      traceId: visible.traceId,
      editToCommitMs: pending.firstCommitAt - pending.editAcceptedAt,
      commitToWorkerStartMs: workerStartAt - pending.firstCommitAt,
      workerMs: workerCompleteAt - workerStartAt,
      workerToAttachMs: attachedAt - workerCompleteAt,
      attachToVisibleMs: visibleAt - attachedAt,
      totalMs: visibleAt - pending.editAcceptedAt,
      mergedRequests: metrics.mergedRequests - pending.schedulingAtStart.mergedRequests,
      supersededInFlight: metrics.supersededInFlight - pending.schedulingAtStart.supersededInFlight,
    });
    this.pending = null;
  }

  reset() {
    this.pending = null;
    this.samples.length = 0;
  }

  summary(): FluidFeedbackSummary {
    const totals = this.samples.map((sample) => sample.totalMs);
    return {
      count: totals.length,
      pending: this.pending !== null,
      p50Ms: percentile(totals, 0.5),
      p95Ms: percentile(totals, 0.95),
      p99Ms: percentile(totals, 0.99),
      maxMs: totals.length ? Math.max(...totals) : 0,
      samples: this.samples.map((sample) => ({ ...sample })),
    };
  }
}
