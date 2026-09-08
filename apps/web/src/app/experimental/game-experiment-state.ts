import type { ComputePoolDiagnostics } from '../../client/compute/compute-worker-pool';
import { workerSelectionFor, type ResolvedExperimentalClientOptions } from '../../client/experimental-client-options';
import type { SceneApplicationResult } from '../scene/scene-bootstrap';

export class GameExperimentState {
  private renderer: Omit<SceneApplicationResult, 'application'> | null = null;

  constructor(readonly requested: ResolvedExperimentalClientOptions) {}

  get rendererRequest() {
    return this.requested.options.renderer;
  }

  get workerSelection() {
    return workerSelectionFor(this.requested);
  }

  acceptRenderer(scene: SceneApplicationResult) {
    this.renderer = {
      requestedRenderer: scene.requestedRenderer,
      effectiveRenderer: scene.effectiveRenderer,
      rendererStatus: scene.rendererStatus,
    };
  }

  clearRenderer() {
    this.renderer = null;
  }

  diagnostics(workers: ComputePoolDiagnostics['workerKernelStates']) {
    return {
      requested: this.requested.options,
      kernels: this.requested.kernels,
      renderer: this.renderer,
      workers,
    };
  }
}
