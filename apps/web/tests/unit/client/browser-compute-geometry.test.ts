import { describe, expect, it } from 'vitest';
import { FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';
import type { ComputeLane } from '../../../../../packages/stdlib/src/runtime/compute-task-queue';
import type { ComputeWorkerPort } from '../../../src/client/compute/compute-worker-pool';
import { BrowserComputeRuntime } from '../../../src/client/compute/browser-compute-runtime';
import { testWorldgenProvider } from './fixtures/worldgen-provider';
import type { VoxelSemanticsDefinition } from '../../../../../packages/stdlib/src/world/voxel-semantics';

class FakeWorker implements ComputeWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posts: unknown[] = [];
  postMessage(message: unknown) {
    this.posts.push(message);
  }
  terminate() {}
}

const geometry = [
  {
    version: 1 as const,
    voxel: 500,
    boxes: [{ min: [0.125, 0, 0] as const, max: [0.25, 1, 1] as const, material: FaceMaterial.WoodenDoor }],
    collision: [{ min: [0.125, 0, 0] as const, max: [0.25, 1, 1] as const }],
    occludesFullFace: false,
  },
];
const voxelSemantics: readonly VoxelSemanticsDefinition[] = [
  {
    id: 'sample:panel',
    storageId: 500,
    solid: true,
    targetable: true,
    renderable: true,
    meshKind: 'cube',
    emission: 0,
    lightCost: 16,
    faceMaterials: Array(6).fill(FaceMaterial.WoodenDoor) as VoxelSemanticsDefinition['faceMaterials'],
  },
];

const message = (voxelGeometry: unknown) => ({
  kind: 'mesh',
  taskId: 7,
  traceId: 'geometry',
  epoch: 0,
  chunkKey: '0,0,0',
  seed: 1,
  cx: 0,
  cy: 0,
  cz: 0,
  chunkRevision: 2,
  haloRevision: 'halo',
  generatorVersion: 3,
  provider: testWorldgenProvider,
  voxelSemantics,
  voxelGeometry,
});

describe('BrowserComputeRuntime geometry boundary', () => {
  it('validates and freezes geometry before a task is enqueued', () => {
    const workers: Array<{ lane: ComputeLane; worker: FakeWorker }> = [];
    const runtime = new BrowserComputeRuntime({
      epoch: 'world:1',
      generalWorkerCount: 1,
      createWorker: (lane) => {
        const worker = new FakeWorker();
        workers.push({ lane, worker });
        return worker;
      },
      onFluidCandidate: () => undefined,
    });
    runtime.meshPort.postMessage(message(geometry), []);
    const task = (
      workers.find(({ lane }) => lane === 'general')!.worker.posts[0] as {
        task: { revision: string; payload: { voxelGeometry: typeof geometry } };
      }
    ).task;

    expect(task.revision).toMatch(/geometry-1$/);
    expect(task.payload.voxelGeometry).toEqual(geometry);
    expect(task.payload.voxelGeometry).not.toBe(geometry);
    expect(Object.isFrozen(task.payload.voxelGeometry)).toBe(true);
    runtime.dispose();
  });

  it('rejects malformed geometry without partially enqueueing a task', () => {
    const workers: Array<{ lane: ComputeLane; worker: FakeWorker }> = [];
    const runtime = new BrowserComputeRuntime({
      epoch: 'world:1',
      generalWorkerCount: 1,
      createWorker: (lane) => {
        const worker = new FakeWorker();
        workers.push({ lane, worker });
        return worker;
      },
      onFluidCandidate: () => undefined,
    });
    const general = workers.find(({ lane }) => lane === 'general')!.worker;

    expect(() => runtime.meshPort.postMessage(message([{ ...geometry[0]!, voxel: Number.NaN }]), [])).toThrow(/voxel/i);
    expect(general.posts).toHaveLength(0);
    expect(runtime.diagnostics.submittedTasks).toBe(0);
    runtime.dispose();
  });
});
