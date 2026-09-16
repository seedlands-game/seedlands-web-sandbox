export type RenderExperimentCandidate = 'p1' | 'p2' | 'p3' | 'p4';
export type RenderExperimentArm = 'control' | 'candidate';
export type RenderBatchMode = 'face-material' | 'category';
export type VertexLayoutMode = 'float32' | 'compact';
export type VoxelShaderMode = 'standard' | 'specialized';
export type RequestedBackend = 'webgl2' | 'webgpu';
export type EffectiveBackend = 'webgl2' | 'webgpu';

export type RenderExperimentSelection = {
  candidate: RenderExperimentCandidate;
  arm: RenderExperimentArm;
  batchMode: RenderBatchMode;
  vertexLayout: VertexLayoutMode;
  shaderMode: VoxelShaderMode;
  requestedBackend: RequestedBackend;
  effectiveBackend: EffectiveBackend;
  backendStatus: 'matched' | 'fallback';
};

export function parseRenderExperiment(
  params: URLSearchParams,
  effectiveBackend: EffectiveBackend,
): RenderExperimentSelection {
  const rawCandidate = params.get('renderExperiment');
  const candidate: RenderExperimentCandidate =
    rawCandidate === 'p1' || rawCandidate === 'p2' || rawCandidate === 'p3' || rawCandidate === 'p4'
      ? rawCandidate
      : 'p1';
  const arm: RenderExperimentArm = params.get('renderArm') === 'control' ? 'control' : 'candidate';
  const requestedBackend: RequestedBackend = params.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl2';
  const acceptedP1 = candidate !== 'p1' || arm === 'candidate';
  const acceptedP2 = candidate === 'p3' || candidate === 'p4' || (candidate === 'p2' && arm === 'candidate');
  return {
    candidate,
    arm,
    batchMode: acceptedP1 ? 'category' : 'face-material',
    vertexLayout: acceptedP2 ? 'compact' : 'float32',
    shaderMode: candidate === 'p3' && arm === 'candidate' ? 'specialized' : 'standard',
    requestedBackend,
    effectiveBackend,
    backendStatus: requestedBackend === effectiveBackend ? 'matched' : 'fallback',
  };
}

export type RenderWorkloadIdentity = {
  sourceSha: string;
  seed: string;
  scenario: string;
  viewport: readonly [number, number];
  quality: 'low' | 'medium' | 'high';
  cameraPath: string;
  operations: string;
  visibleChunks: number;
  triangles: number;
};

export const createRenderWorkloadIdentity = (identity: RenderWorkloadIdentity): RenderWorkloadIdentity => ({
  ...identity,
  viewport: [...identity.viewport],
});

export function compareRenderWorkloads(left: RenderWorkloadIdentity, right: RenderWorkloadIdentity) {
  const differences = (Object.keys(left) as Array<keyof RenderWorkloadIdentity>).filter(
    (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]),
  );
  return { comparable: differences.length === 0, differences };
}

type PairedExperimentInput = {
  direction: 'lower' | 'higher';
  aa: readonly number[];
  control: readonly number[];
  candidate: readonly number[];
  vetoed: boolean;
};

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function assessPairedExperiment(input: PairedExperimentInput) {
  const aaJitter = Math.max(...input.aa) - Math.min(...input.aa);
  const controlMean = mean(input.control);
  const candidateMean = mean(input.candidate);
  const signedImprovement = input.direction === 'lower' ? controlMean - candidateMean : candidateMean - controlMean;
  const status = !input.vetoed && signedImprovement > aaJitter ? 'ACCEPTED' : 'RETRY_REQUIRED';
  return { status, aaJitter, controlMean, candidateMean, signedImprovement } as const;
}
