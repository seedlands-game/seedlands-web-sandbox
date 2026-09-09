import { describe, expect, it } from 'vitest';
import { ComputeWorkerPool, type ComputeWorkerPort } from '../../apps/web/src/client/compute/compute-worker-pool';
import type { ComputeTask } from '../../packages/game-core/src/runtime/compute-task-queue';
const task = (taskId: number, lane: 'general'): ComputeTask => ({
  protocolVersion: 1,
  epoch: 'world:1',
  taskId,
  lane,
  category: 'mesh',
  priority: 'streaming',
  key: String(taskId),
  revision: 'r1',
  dependencies: [],
  estimatedBytes: 64,
  payload: {},
});

describe('Compute Worker telemetry provenance', () => {
  it('诊断只接纳当前任务回执，坏遥测不影响任务完成，重建清空旧实例累计值', () => {
    const workers: ComputeWorkerPort[] = [];
    const pool = new ComputeWorkerPool({
      epoch: 'world:1',
      generalWorkerCount: 1,
      maxTasks: 4,
      maxBytes: 512,
      createWorker: () => {
        const worker: ComputeWorkerPort = { onmessage: null, onerror: null, postMessage() {}, terminate() {} };
        workers.push(worker);
        return worker;
      },
    });
    pool.enqueue(task(1, 'general'));
    const worker = workers[1];
    const kernel = { calls: 12, failures: 0, durationMs: 4, memoryBytes: 16777216, failed: false };
    const reply = (epoch: string, taskId: number, kernelDiagnostics: unknown) =>
      worker.onmessage?.({
        data: { kind: 'compute-result', protocolVersion: 1, epoch, taskId, ok: true, result: {}, kernelDiagnostics },
      } as MessageEvent<unknown>);
    reply('old-world', 1, kernel);
    expect(pool.diagnostics().workerActivity![1].kernel).toBeNull();
    reply('world:1', 1, kernel);
    expect(pool.diagnostics().workerActivity![1].kernel).toEqual(kernel);
    kernel.calls = 99;
    expect(pool.diagnostics().workerActivity![1].kernel?.calls).toBe(12);
    pool.enqueue(task(2, 'general'));
    reply('world:1', 2, { ...kernel, durationMs: NaN });
    expect(pool.diagnostics().completedTasks).toBe(2);
    expect(pool.diagnostics().workerActivity![1].kernel).toBeNull();
    pool.switchEpoch('world:2');
    expect(pool.diagnostics().workerActivity![1]).toMatchObject({ completedTasks: 0, kernel: null });
    pool.dispose();
  });
});
