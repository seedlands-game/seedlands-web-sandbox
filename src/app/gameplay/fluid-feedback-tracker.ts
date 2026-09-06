import type { PerformanceTrace } from '../../client/presentation/performance-telemetry';

export type FluidSchedulingMetrics = { mergedRequests: number; supersededInFlight: number };
export type FluidFeedbackTarget = Readonly<{
  x: number;
  y: number;
  z: number;
  radius: number;
  chunkRevisions: readonly { key: string; revision: number }[];
}>;
export type FluidCommitBounds = Readonly<{
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}>;

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
  pendingSample: {
    stage: 'awaiting-fluid-commit' | 'awaiting-visible-mesh';
    elapsedMs: number;
    target: Omit<FluidFeedbackTarget, 'chunkRevisions'> | null;
    targetRevisions: { key: string; revision: number }[];
  } | null;
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
  requestedTarget: FluidFeedbackTarget | null;
  schedulingAtStart: FluidSchedulingMetrics;
};

export type VisibleFluidMesh = { chunkKey: string; chunkRevision: number; traceId: string };
export type FluidVisibleTraceMark = 'visible-postrender' | 'water-transition-progress-visible';

const percentile = (values: number[], quantile: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
};

const latestMarkAtOrAfter = (trace: PerformanceTrace | null, name: string, earliest: number) =>
  trace?.marks.filter((mark) => mark.name === name && mark.timestampMs >= earliest).at(-1)?.timestampMs;

const overlapsTarget = (target: FluidFeedbackTarget, bounds: FluidCommitBounds) =>
  bounds.max[0] >= target.x - target.radius &&
  bounds.min[0] <= target.x + target.radius &&
  bounds.max[1] >= target.y - target.radius &&
  bounds.min[1] <= target.y + target.radius &&
  bounds.max[2] >= target.z - target.radius &&
  bounds.min[2] <= target.z + target.radius;

export class FluidFeedbackTracker {
  private pending: PendingSample | null = null;
  private readonly samples: FluidFeedbackSample[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  begin(metrics: FluidSchedulingMetrics, target: FluidFeedbackTarget | null = null) {
    if (
      target &&
      (![target.x, target.y, target.z, target.radius].every(Number.isFinite) ||
        target.radius < 0 ||
        target.chunkRevisions.some(({ key, revision }) => !key || !Number.isSafeInteger(revision) || revision < -1))
    )
      throw new TypeError('Fluid feedback target is invalid.');
    this.pending = {
      editAcceptedAt: this.now(),
      firstCommitAt: null,
      targetRevisions: new Map(),
      requestedTarget: target
        ? { ...target, chunkRevisions: target.chunkRevisions.map((entry) => ({ ...entry })) }
        : null,
      schedulingAtStart: { ...metrics },
    };
  }

  markFirstCommit(targetChunks: Iterable<{ key: string; revision: number }>, bounds?: FluidCommitBounds) {
    if (!this.pending || this.pending.firstCommitAt !== null) return;
    const requested = this.pending.requestedTarget;
    if (requested && (!bounds || !overlapsTarget(requested, bounds))) return;
    const baselines = requested ? new Map(requested.chunkRevisions.map(({ key, revision }) => [key, revision])) : null;
    const revisions = [...targetChunks].filter(
      ({ key, revision }) => !baselines || (baselines.has(key) && revision > baselines.get(key)!),
    );
    if (!revisions.length) return;
    this.pending.firstCommitAt = this.now();
    this.pending.targetRevisions = new Map(revisions.map(({ key, revision }) => [key, revision]));
  }

  completeVisible(
    visible: VisibleFluidMesh,
    trace: PerformanceTrace | null,
    metrics: FluidSchedulingMetrics,
    visibleTraceMark: FluidVisibleTraceMark = 'visible-postrender',
  ) {
    const pending = this.pending;
    const targetRevision = pending?.targetRevisions.get(visible.chunkKey);
    if (
      !pending ||
      pending.firstCommitAt === null ||
      targetRevision === undefined ||
      visible.chunkRevision < targetRevision ||
      trace?.traceId !== visible.traceId ||
      !trace.complete
    )
      return;
    const workerStartAt = latestMarkAtOrAfter(trace, 'worker-start', pending.firstCommitAt);
    if (workerStartAt === undefined) return;
    const workerCompleteAt = latestMarkAtOrAfter(trace, 'worker-complete', workerStartAt);
    if (workerCompleteAt === undefined) return;
    const attachedAt = latestMarkAtOrAfter(trace, 'scene-attached', workerCompleteAt);
    if (attachedAt === undefined) return;
    const visibleMarkAt = latestMarkAtOrAfter(trace, visibleTraceMark, attachedAt);
    if (visibleMarkAt === undefined) return;
    const visibleAt = Math.max(this.now(), visibleMarkAt);
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
    const requested = this.pending?.requestedTarget;
    return {
      count: totals.length,
      pending: this.pending !== null,
      pendingSample: this.pending
        ? {
            stage: this.pending.firstCommitAt === null ? 'awaiting-fluid-commit' : 'awaiting-visible-mesh',
            elapsedMs: Math.max(0, this.now() - this.pending.editAcceptedAt),
            target: requested ? { x: requested.x, y: requested.y, z: requested.z, radius: requested.radius } : null,
            targetRevisions: [...this.pending.targetRevisions].map(([key, revision]) => ({ key, revision })),
          }
        : null,
      p50Ms: percentile(totals, 0.5),
      p95Ms: percentile(totals, 0.95),
      p99Ms: percentile(totals, 0.99),
      maxMs: totals.length ? Math.max(...totals) : 0,
      samples: this.samples.map((sample) => ({ ...sample })),
    };
  }
}
