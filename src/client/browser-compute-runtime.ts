import type { FluidAuthoritySnapshot, FluidCandidate } from '../server/fluid/fluid-transaction';
import type { ComputeLane, ComputeTask } from '../runtime/compute-task-queue';
import { PROTOCOL_VERSION, type SessionEpoch } from '../runtime/session-protocol';
import { ComputeWorkerPool, type ComputeWorkerPort } from './compute-worker-pool';

type MeshWorkerPort = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: Record<string, unknown>, transfer: Transferable[]): void;
  terminate(): void;
};

type Options = Readonly<{
  epoch: SessionEpoch;
  generalWorkerCount: 1 | 2;
  createWorker?: (lane: ComputeLane, index: number) => ComputeWorkerPort;
  onFluidCandidate: (candidate: FluidCandidate) => void;
  onFluidFailure?: (workId: string, error: Error) => void;
  onMeshFailure?: (originalTaskId: number, error: Error) => void;
  onPoolFailure?: (lane: ComputeLane, error: Error) => void;
}>;

const workerFactory = (lane: ComputeLane) =>
  new Worker(
    lane === 'fluid'
      ? new URL('../worker/fluid-compute-worker.ts', import.meta.url)
      : new URL('../worker/world-worker.ts', import.meta.url),
    { type: 'module' },
  );

export class BrowserComputeRuntime {
  readonly meshPort: MeshWorkerPort;
  private readonly pool: ComputeWorkerPool;
  private readonly originalMeshTaskIds = new Map<number, number>();
  private readonly fluidWorkIds = new Map<number, string>();
  private taskSequence = 0;
  private disposed = false;

  constructor(private readonly options: Options) {
    this.meshPort = {
      onmessage: null,
      postMessage: (message, transfer) => this.enqueueMesh(message, transfer),
      terminate: () => this.dispose(),
    };
    this.pool = new ComputeWorkerPool({
      epoch: options.epoch,
      generalWorkerCount: options.generalWorkerCount,
      maxTasks: 96,
      maxBytes: 96 * 1024 * 1024,
      createWorker: options.createWorker ?? workerFactory,
      onResult: (task, result) => this.receive(task, result),
      onFailure: (task, error) => this.fail(task, error),
      onDrop: (taskId) => {
        this.originalMeshTaskIds.delete(taskId);
        this.fluidWorkIds.delete(taskId);
      },
      onPoolFailure: options.onPoolFailure,
    });
  }

  get diagnostics() {
    return this.pool.diagnostics();
  }

  enqueueFluid(snapshot: FluidAuthoritySnapshot): boolean {
    const taskId = ++this.taskSequence;
    this.fluidWorkIds.set(taskId, snapshot.workId);
    const result = this.pool.enqueue(
      {
        protocolVersion: PROTOCOL_VERSION,
        epoch: this.options.epoch,
        taskId,
        lane: 'fluid',
        category: 'fluid',
        priority: 'interaction',
        key: snapshot.workId,
        revision: `${snapshot.epoch}`,
        dependencies: [],
        estimatedBytes: snapshot.chunks.reduce(
          (bytes, chunk) => bytes + chunk.voxels.byteLength + chunk.fluid.byteLength,
          0,
        ),
        payload: snapshot,
      },
      snapshot.chunks.flatMap((chunk) => [chunk.voxels.buffer, chunk.fluid.buffer]),
    );
    if (result.status === 'queued' || result.status === 'merged') return true;
    this.fluidWorkIds.delete(taskId);
    this.options.onFluidFailure?.(snapshot.workId, new Error(`Fluid compute enqueue failed: ${result.status}`));
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pool.dispose();
    this.meshPort.onmessage = null;
    this.originalMeshTaskIds.clear();
    this.fluidWorkIds.clear();
  }

  private enqueueMesh(message: Record<string, unknown>, transfer: Transferable[]): void {
    if (this.disposed) return;
    const originalTaskId = message.taskId;
    const key = message.chunkKey;
    const revision = `${String(message.chunkRevision)}:${String(message.haloRevision)}`;
    if (!Number.isSafeInteger(originalTaskId) || typeof key !== 'string')
      throw new TypeError('Mesh compute message identity is invalid.');
    const taskId = ++this.taskSequence;
    this.originalMeshTaskIds.set(taskId, originalTaskId as number);
    const result = this.pool.enqueue(
      {
        protocolVersion: PROTOCOL_VERSION,
        epoch: this.options.epoch,
        taskId,
        lane: 'general',
        category: message.kind === 'generate-mesh' ? 'chunk-generation' : 'mesh',
        priority: 'streaming',
        key,
        revision,
        dependencies: [],
        estimatedBytes: transfer.reduce<number>(
          (bytes, value) => bytes + (value instanceof ArrayBuffer ? value.byteLength : 0),
          0,
        ),
        payload: message,
      },
      transfer,
    );
    if (result.status === 'queued' || result.status === 'merged') return;
    this.originalMeshTaskIds.delete(taskId);
    this.options.onMeshFailure?.(originalTaskId as number, new Error(`Mesh compute enqueue failed: ${result.status}`));
  }

  private receive(task: ComputeTask, result: unknown): void {
    if (task.category === 'fluid') {
      this.fluidWorkIds.delete(task.taskId);
      this.options.onFluidCandidate(result as FluidCandidate);
      return;
    }
    const originalTaskId = this.originalMeshTaskIds.get(task.taskId);
    this.originalMeshTaskIds.delete(task.taskId);
    if (originalTaskId === undefined) return;
    this.meshPort.onmessage?.({ data: { ...(result as object), taskId: originalTaskId } } as MessageEvent<unknown>);
  }

  private fail(task: ComputeTask, error: Error): void {
    if (task.category === 'fluid') {
      const workId = this.fluidWorkIds.get(task.taskId);
      this.fluidWorkIds.delete(task.taskId);
      if (workId) this.options.onFluidFailure?.(workId, error);
      return;
    }
    const originalTaskId = this.originalMeshTaskIds.get(task.taskId);
    this.originalMeshTaskIds.delete(task.taskId);
    if (originalTaskId !== undefined) this.options.onMeshFailure?.(originalTaskId, error);
  }
}
