import type { FluidAuthoritySnapshot, FluidCandidate } from '../../server/fluid/fluid-transaction';
import type { ComputeLane, ComputeTask } from '../../runtime/compute-task-queue';
import { PROTOCOL_VERSION, type SessionEpoch } from '../../runtime/session-protocol';
import type { GeneratedCanonicalChunk, InitialWorldBootstrap } from '../../worker/world-compute-task';
import { CHUNK_SIZE } from '../../world/voxel';
import { ComputeWorkerPool, type ComputeWorkerPort } from './compute-worker-pool';
import { wasmExperimentWorkerName } from './wasm-experiment-selection';
import type { WasmWorkerSelection } from '../../compute/wasm-kernel-contract';

type MeshWorkerPort = {
  onerror?: ((failure: { taskId: number; error: Error }) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: Record<string, unknown>, transfer: Transferable[]): void;
  terminate(): void;
};

type Options = Readonly<{
  epoch: SessionEpoch;
  generalWorkerCount: 1 | 2;
  wasm?: WasmWorkerSelection;
  createWorker?: (lane: ComputeLane, index: number) => ComputeWorkerPort;
  onFluidCandidate: (candidate: FluidCandidate) => void;
  onFluidFailure?: (workId: string, error: Error) => void;
  onMeshFailure?: (originalTaskId: number, error: Error) => void;
  onPoolFailure?: (lane: ComputeLane, error: Error) => void;
}>;

const workerFactory = (lane: ComputeLane, selection: WasmWorkerSelection) => {
  if (lane === 'fluid')
    return new Worker(new URL('../../worker/fluid-compute-worker.ts', import.meta.url), {
      type: 'module',
      name: wasmExperimentWorkerName(selection),
    });
  return new Worker(new URL('../../worker/world-worker.ts', import.meta.url), {
    type: 'module',
    name: wasmExperimentWorkerName(selection),
  });
};

export class BrowserComputeRuntime {
  readonly meshPort: MeshWorkerPort;
  private readonly pool: ComputeWorkerPool;
  private readonly originalMeshTaskIds = new Map<number, number>();
  private readonly fluidWorkIds = new Map<number, string>();
  private readonly spawnRequests = new Map<
    number,
    { resolve: (bootstrap: InitialWorldBootstrap) => void; reject: (error: Error) => void }
  >();
  private readonly canonicalRequests = new Map<
    number,
    { key: string; resolve: (chunk: GeneratedCanonicalChunk) => void; reject: (error: Error) => void }
  >();
  private readonly canonicalByKey = new Map<string, Promise<GeneratedCanonicalChunk>>();
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
      createWorker:
        options.createWorker ?? ((lane) => workerFactory(lane, options.wasm ?? { artifact: 'off', kernels: [] })),
      requireReadyHandshake: options.createWorker === undefined,
      onResult: (task, result) => this.receive(task, result),
      onFailure: (task, error) => this.fail(task, error),
      onDrop: (taskId, reason) => {
        const error = new Error(`Compute task ended: ${reason}`);
        const meshId = this.originalMeshTaskIds.get(taskId);
        this.originalMeshTaskIds.delete(taskId);
        if (meshId !== undefined) this.meshFailure(meshId, error);
        const workId = this.fluidWorkIds.get(taskId);
        this.fluidWorkIds.delete(taskId);
        if (workId) this.options.onFluidFailure?.(workId, error);
        this.spawnRequests.get(taskId)?.reject(error);
        this.spawnRequests.delete(taskId);
        this.rejectCanonical(taskId, error);
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

  findSafeSpawn(seed: number, generatorVersion: number): Promise<InitialWorldBootstrap> {
    if (this.disposed) return Promise.reject(new Error('Compute runtime is disposed.'));
    const taskId = ++this.taskSequence;
    const promise = new Promise<InitialWorldBootstrap>((resolve, reject) =>
      this.spawnRequests.set(taskId, { resolve, reject }),
    );
    const result = this.pool.enqueue({
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.options.epoch,
      taskId,
      lane: 'general',
      category: 'chunk-generation',
      priority: 'interaction',
      key: 'initial-safe-spawn',
      revision: `${seed}:${generatorVersion}`,
      dependencies: [],
      estimatedBytes: 0,
      payload: { kind: 'find-safe-spawn', seed, generatorVersion },
    });
    if (result.status === 'queued' || result.status === 'merged') return promise;
    this.spawnRequests.delete(taskId);
    return Promise.reject(new Error(`Safe spawn compute enqueue failed: ${result.status}`));
  }

  generateCanonicalChunk(seed: number, generatorVersion: number, key: string): Promise<GeneratedCanonicalChunk> {
    if (this.disposed) return Promise.reject(new Error('Compute runtime is disposed.'));
    const existing = this.canonicalByKey.get(key);
    if (existing) return existing;
    const coordinates = key.split(',').map(Number);
    if (coordinates.length !== 3 || !coordinates.every(Number.isInteger))
      return Promise.reject(new TypeError(`Canonical generation Chunk key is invalid: ${key}.`));
    const [cx, cy, cz] = coordinates as [number, number, number];
    const taskId = ++this.taskSequence;
    const promise = new Promise<GeneratedCanonicalChunk>((resolve, reject) =>
      this.canonicalRequests.set(taskId, { key, resolve, reject }),
    );
    this.canonicalByKey.set(key, promise);
    const cleanup = () => {
      if (this.canonicalByKey.get(key) === promise) this.canonicalByKey.delete(key);
    };
    void promise.then(cleanup, cleanup);
    const result = this.pool.enqueue({
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.options.epoch,
      taskId,
      lane: 'general',
      category: 'chunk-generation',
      priority: 'interaction',
      key: `canonical:${key}`,
      revision: `${seed}:${generatorVersion}`,
      dependencies: [],
      estimatedBytes: 0,
      payload: { kind: 'generate-canonical', seed, generatorVersion, key, cx, cy, cz },
    });
    if (result.status === 'queued' || result.status === 'merged') return promise;
    this.canonicalRequests.delete(taskId);
    this.canonicalByKey.delete(key);
    return Promise.reject(new Error(`Canonical compute enqueue failed: ${result.status}`));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pool.dispose();
    this.meshPort.onmessage = null;
    this.meshPort.onerror = null;
    this.originalMeshTaskIds.clear();
    this.fluidWorkIds.clear();
    this.spawnRequests.forEach(({ reject }) => reject(new Error('Compute runtime was disposed.')));
    this.spawnRequests.clear();
    this.canonicalRequests.forEach(({ reject }) => reject(new Error('Compute runtime was disposed.')));
    this.canonicalRequests.clear();
    this.canonicalByKey.clear();
  }

  private enqueueMesh(message: Record<string, unknown>, transfer: Transferable[]): void {
    if (this.disposed) return;
    const originalTaskId = message.taskId;
    if (message.kind === 'cancel-mesh') {
      for (const [taskId, original] of this.originalMeshTaskIds)
        if (original === originalTaskId) this.pool.cancel(taskId);
      return;
    }
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
        priority:
          message.priority === 'interactive' || message.priority === 'interactive-fluid' ? 'interaction' : 'streaming',
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
    this.meshFailure(originalTaskId as number, new Error(`Mesh compute enqueue failed: ${result.status}`));
  }

  private receive(task: ComputeTask, result: unknown): void {
    const spawn = this.spawnRequests.get(task.taskId);
    if (spawn) {
      this.spawnRequests.delete(task.taskId);
      const value = result as Partial<InitialWorldBootstrap>;
      if (
        value.kind !== 'safe-spawn-result' ||
        !Array.isArray(value.playerBodyPosition) ||
        value.playerBodyPosition.length !== 3 ||
        !value.playerBodyPosition.every(Number.isFinite) ||
        !Array.isArray(value.starterChunks)
      )
        spawn.reject(new Error('Safe spawn compute result is invalid.'));
      else spawn.resolve(value as InitialWorldBootstrap);
      return;
    }
    const canonical = this.canonicalRequests.get(task.taskId);
    if (canonical) {
      this.canonicalRequests.delete(task.taskId);
      const value = result as Partial<GeneratedCanonicalChunk>;
      if (
        value.kind !== 'canonical-result' ||
        value.key !== canonical.key ||
        !Number.isInteger(value.cx) ||
        !Number.isInteger(value.cy) ||
        !Number.isInteger(value.cz) ||
        value.chunkRevision !== 0 ||
        !Number.isInteger(value.generatorVersion) ||
        !(value.voxels instanceof ArrayBuffer) ||
        value.voxels.byteLength !== CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT
      )
        canonical.reject(new Error('Canonical compute result is invalid.'));
      else canonical.resolve(value as GeneratedCanonicalChunk);
      return;
    }
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

  private meshFailure(taskId: number, error: Error) {
    this.meshPort.onerror?.({ taskId, error });
    this.options.onMeshFailure?.(taskId, error);
  }

  private fail(task: ComputeTask, error: Error): void {
    const spawn = this.spawnRequests.get(task.taskId);
    if (spawn) {
      this.spawnRequests.delete(task.taskId);
      spawn.reject(error);
      return;
    }
    if (this.canonicalRequests.has(task.taskId)) {
      this.rejectCanonical(task.taskId, error);
      return;
    }
    if (task.category === 'fluid') {
      const workId = this.fluidWorkIds.get(task.taskId);
      this.fluidWorkIds.delete(task.taskId);
      if (workId) this.options.onFluidFailure?.(workId, error);
      return;
    }
    const originalTaskId = this.originalMeshTaskIds.get(task.taskId);
    this.originalMeshTaskIds.delete(task.taskId);
    if (originalTaskId !== undefined) this.meshFailure(originalTaskId, error);
  }

  private rejectCanonical(taskId: number, error: Error): void {
    const canonical = this.canonicalRequests.get(taskId);
    if (!canonical) return;
    this.canonicalRequests.delete(taskId);
    canonical.reject(error);
  }
}
