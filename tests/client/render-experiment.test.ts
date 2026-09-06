import { describe, expect, it } from 'vitest';
import {
  assessPairedExperiment,
  compareRenderWorkloads,
  createRenderWorkloadIdentity,
  parseRenderExperiment,
} from '../../changes/2026-09-05-voxel-rendering-pipeline-experiments/experiment-contract';

describe('render experiment contract', () => {
  it('selects exactly one candidate arm and preserves requested versus effective backend', () => {
    expect(
      parseRenderExperiment(new URLSearchParams('renderExperiment=p4&renderArm=candidate&renderer=webgpu'), 'webgl2'),
    ).toEqual({
      candidate: 'p4',
      arm: 'candidate',
      batchMode: 'category',
      vertexLayout: 'compact',
      shaderMode: 'standard',
      requestedBackend: 'webgpu',
      effectiveBackend: 'webgl2',
      backendStatus: 'fallback',
    });
  });

  it('rejects pairs whose complete workload identity differs', () => {
    const control = createRenderWorkloadIdentity({
      sourceSha: 'abc',
      seed: 'render-fixture',
      scenario: 'multi-material-shore',
      viewport: [1280, 720],
      quality: 'high',
      cameraPath: 'shore-loop-v1',
      operations: 'load-cross-edit-remesh-v1',
      visibleChunks: 18,
      triangles: 1200,
    });
    expect(compareRenderWorkloads(control, { ...control, triangles: 1206 })).toEqual({
      comparable: false,
      differences: ['triangles'],
    });
  });

  it('only accepts a timing improvement that exceeds the same-run A/A jitter', () => {
    expect(
      assessPairedExperiment({
        direction: 'lower',
        aa: [16, 16.2, 16.1, 16.3],
        control: [17, 17.2],
        candidate: [15, 15.1],
        vetoed: false,
      }).status,
    ).toBe('ACCEPTED');
    expect(
      assessPairedExperiment({
        direction: 'lower',
        aa: [16, 16.2, 16.1, 16.3],
        control: [17, 17.2],
        candidate: [17.1, 17],
        vetoed: false,
      }).status,
    ).toBe('RETRY_REQUIRED');
  });
});
