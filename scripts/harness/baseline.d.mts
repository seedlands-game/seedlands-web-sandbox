type RunIdentity = {
  status: 'MEASURED';
  runId: string;
  owner: string;
  scenario: string;
  sourceSha: string;
  sourceDigest: string;
  lockDigest: string;
  windowId: string;
  evidencePath: string;
  sampleStartedAt: string;
  sampleCompletedAt: string;
};
export type LocalRun = RunIdentity & {
  bundleDigest: string;
  environment: { node: string; cpu: string };
  samples: { totalMs: number }[];
};
export type RuntimeRun = RunIdentity & {
  owner: 'web-runtime';
  artifactDigest: string;
  environment: {
    userAgent: string;
    webgl2: { renderer: string };
    viewport: { width: number; height: number };
    devicePixelRatio: number;
  };
  samples: {
    stage: string;
    frame: { count: number; p50Ms: number; p95Ms: number; p99Ms: number; longFrameCount: number };
  }[];
};
export type Candidate = { schemaVersion: 1; status: 'CANDIDATE'; run: LocalRun | RuntimeRun; comparison: string };
export type BaselineOptions = { rootDirectory?: string };
export function assertBaselineRunId(runId: string | undefined, record: unknown): void;
export function baselineCandidate(record: unknown, options?: BaselineOptions): Candidate;
export function acceptBaseline(
  candidate: Candidate,
  approvedDigest: string,
  reason: string,
  options?: BaselineOptions,
): Omit<Candidate, 'status'> & { status: 'ACCEPTED'; candidateDigest: string; reason: string; acceptedAt: string };
