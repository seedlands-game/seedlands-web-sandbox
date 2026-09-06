import { describe, expect, it } from 'vitest';
import {
  DedicatedComputeScheduler,
  type DedicatedComputeWork,
} from '../../src/server/compute/dedicated-compute-scheduler';
import { measureDedicatedComputeBytes } from '../../src/server/compute/dedicated-compute-bytes';
import type {
  DedicatedComputeDiagnostics,
  DedicatedComputeExecutor,
  DedicatedComputeResult,
  DedicatedComputeTask,
} from '../../src/server/compute/dedicated-compute-contract';

type CanonicalWork = Extract<DedicatedComputeWork, { kind: 'generate-canonical' }>;

const work = (overrides: Partial<CanonicalWork> = {}): CanonicalWork => ({
  kind: 'generate-canonical',
  epoch: 'scheduler:1',
  generation: 1,
  seed: 42,
  generatorVersion: 1,
  key: '0,0,0',
  cx: 0,
  cy: 0,
  cz: 0,
  ...overrides,
});

const resultFor = (task: DedicatedComputeTask): DedicatedComputeResult => {
  if (task.kind !== 'generate-canonical') throw new Error('Test only resolves canonical work.');
  return {
    kind: 'canonical-result',
    key: task.key,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    chunkRevision: 0,
    generatorVersion: task.generatorVersion,
    voxels: new ArrayBuffer(2),
  };
};

class ControlledExecutor implements DedicatedComputeExecutor {
  readonly calls: DedicatedComputeTask[] = [];
  private readonly pending = new Map<
    number,
    Readonly<{ resolve: (result: DedicatedComputeResult) => void; reject: (error: Error) => void }>
  >();
  private highWatermark = -1;

  execute(task: DedicatedComputeTask) {
    this.calls.push(task);
    this.highWatermark = task.taskId;
    return new Promise<DedicatedComputeResult>((resolve, reject) => {
      this.pending.set(task.taskId, { resolve, reject });
    });
  }

  resolve(taskId: number) {
    const pending = this.pending.get(taskId);
    const task = this.calls.find((candidate) => candidate.taskId === taskId);
    if (!pending || !task) throw new Error(`Unknown test task ${taskId}.`);
    this.pending.delete(taskId);
    pending.resolve(resultFor(task));
  }

  async close() {
    for (const pending of this.pending.values()) pending.reject(new Error('closed'));
    this.pending.clear();
  }

  diagnostics(): DedicatedComputeDiagnostics {
    return {
      mode: 'inline',
      generation: 1,
      queued: 0,
      queuedBytes: 0,
      running: this.pending.size,
      runningBytes: 0,
      completedTasks: 0,
      failedTasks: 0,
      cancelledTasks: 0,
      staleResults: 0,
      childPids: [],
      workerThreadIds: [],
      poolSize: 1,
      liveSlots: this.pending.size,
      terminatingSlots: 0,
      health: 'healthy',
      restartCountLastMinute: 0,
      ipcBacklogBytes: 0,
      slotCompletedTasks: [0],
      taskIdHighWatermark: this.highWatermark,
    };
  }
}

const schedulerFor = (executor = new ControlledExecutor(), maxBytes = 16 * 1024) => ({
  executor,
  scheduler: new DedicatedComputeScheduler({
    epoch: 'scheduler:1',
    executors: { general: executor, fluid: executor, logic: executor },
    maxTasks: 8,
    maxBytes,
    maxResultBytes: 1024,
  }),
});

describe('DedicatedComputeScheduler', () => {
  it('keeps a dependency running until the host acknowledges its mailbox candidate', async () => {
    const { executor, scheduler } = schedulerFor();
    const first = scheduler.schedule(work(), { priority: 'streaming', key: 'first', revision: 'r1' });
    const dependent = scheduler.schedule(work({ key: '1,0,0' }), {
      priority: 'background',
      key: 'dependent',
      revision: 'r1',
      dependencies: [first.jobId],
    });

    expect(executor.calls).toHaveLength(1);
    executor.resolve(executor.calls[0].taskId);
    const candidate = await first.candidate;
    expect(executor.calls).toHaveLength(1);
    candidate.acknowledge();
    expect(executor.calls).toHaveLength(2);
    executor.resolve(executor.calls[1].taskId);
    const dependentCandidate = await dependent.candidate;
    dependentCandidate.acknowledge();
    await scheduler.drain();
  });

  it('settles a merged queued job explicitly and gives the replacement a new queue identity', async () => {
    const { executor, scheduler } = schedulerFor();
    const active = scheduler.schedule(work(), { priority: 'streaming', key: 'active', revision: 'r1' });
    const replaced = scheduler.schedule(work({ key: '1,0,0' }), {
      priority: 'background',
      key: 'replace',
      revision: 'r1',
    });
    const replacement = scheduler.schedule(work({ key: '2,0,0' }), {
      priority: 'interaction',
      key: 'replace',
      revision: 'r2',
    });

    await expect(replaced.candidate).rejects.toThrow(/superseded/i);
    executor.resolve(executor.calls[0].taskId);
    (await active.candidate).acknowledge();
    expect(executor.calls[1]).toMatchObject({ key: '2,0,0' });
    executor.resolve(executor.calls[1].taskId);
    (await replacement.candidate).acknowledge();
    await scheduler.drain();
  });

  it('uses monotonic execution ids when priority reorders queued job ids', async () => {
    const { executor, scheduler } = schedulerFor();
    const active = scheduler.schedule(work(), { priority: 'streaming', key: 'active', revision: 'r1' });
    const low = scheduler.schedule(work({ key: '1,0,0' }), {
      priority: 'background',
      key: 'low',
      revision: 'r1',
    });
    const high = scheduler.schedule(work({ key: '2,0,0' }), {
      priority: 'interaction',
      key: 'high',
      revision: 'r1',
    });

    executor.resolve(executor.calls[0].taskId);
    (await active.candidate).acknowledge();
    expect(executor.calls[1]).toMatchObject({ taskId: 1, key: '2,0,0' });
    executor.resolve(executor.calls[1].taskId);
    (await high.candidate).acknowledge();
    expect(executor.calls[2]).toMatchObject({ taskId: 2, key: '1,0,0' });
    executor.resolve(executor.calls[2].taskId);
    (await low.candidate).acknowledge();
    await scheduler.drain();
  });

  it('keeps an unacknowledged result charged after its dispatch reservation becomes actual bytes', async () => {
    const inputBytes = measureDedicatedComputeBytes({ ...work(), taskId: 0, estimatedBytes: 0 });
    const { executor, scheduler } = schedulerFor(undefined, inputBytes + 1024);
    const first = scheduler.schedule(work(), { priority: 'streaming', key: 'first', revision: 'r1' });

    executor.resolve(executor.calls[0].taskId);
    const candidate = await first.candidate;
    expect(executor.calls).toHaveLength(1);
    expect(scheduler.diagnostics().heldResultBytes).toBeGreaterThan(0);
    expect(scheduler.diagnostics().reservedBytes).toBeGreaterThanOrEqual(inputBytes);
    candidate.acknowledge();
    expect(scheduler.diagnostics().heldResultBytes).toBe(0);
    await scheduler.drain();
  });

  it('keeps the worst-case reservation through acknowledge so later jobs cannot strand the queue', async () => {
    const inputBytes = measureDedicatedComputeBytes({ ...work(), taskId: 0, estimatedBytes: 0 });
    const { executor, scheduler } = schedulerFor(undefined, inputBytes * 3 + 1024);
    const first = scheduler.schedule(work(), { priority: 'streaming', key: 'first', revision: 'r1' });
    executor.resolve(executor.calls[0].taskId);
    const firstCandidate = await first.candidate;
    const second = scheduler.schedule(work({ key: '1,0,0' }), {
      priority: 'streaming',
      key: 'second',
      revision: 'r1',
    });
    const third = scheduler.schedule(work({ key: '2,0,0' }), {
      priority: 'streaming',
      key: 'third',
      revision: 'r1',
    });

    expect(scheduler.diagnostics()).toMatchObject({ heldResultBytes: expect.any(Number), reservedResultBytes: 1024 });
    firstCandidate.acknowledge();
    expect(executor.calls[1]).toMatchObject({ key: '1,0,0' });
    executor.resolve(executor.calls[1].taskId);
    (await second.candidate).acknowledge();
    expect(executor.calls[2]).toMatchObject({ key: '2,0,0' });
    executor.resolve(executor.calls[2].taskId);
    (await third.candidate).acknowledge();
    await scheduler.drain();
  });

  it('rejects a job whose input plus required result reservation can never fit', async () => {
    const inputBytes = measureDedicatedComputeBytes({ ...work(), taskId: 0, estimatedBytes: 0 });
    const { executor, scheduler } = schedulerFor(undefined, inputBytes + 1023);
    const job = scheduler.schedule(work(), { priority: 'streaming', key: 'too-large', revision: 'r1' });
    await expect(job.candidate).rejects.toThrow(/reservation/i);
    expect(executor.calls).toHaveLength(0);
  });

  it('counts delivered mailbox candidates against the scheduler task limit', async () => {
    const executor = new ControlledExecutor();
    const scheduler = new DedicatedComputeScheduler({
      epoch: 'scheduler:1',
      executors: { general: executor, fluid: executor, logic: executor },
      maxTasks: 1,
      maxBytes: 16 * 1024,
      maxResultBytes: 1024,
    });
    const first = scheduler.schedule(work(), { priority: 'streaming', key: 'first', revision: 'r1' });
    executor.resolve(executor.calls[0].taskId);
    await first.candidate;

    const rejected = scheduler.schedule(work({ key: '1,0,0' }), {
      priority: 'streaming',
      key: 'second',
      revision: 'r1',
    });
    await expect(rejected.candidate).rejects.toThrow(/task backpressure/i);
    expect(scheduler.diagnostics()).toMatchObject({ pendingJobs: 1 });
  });

  it('allows a merge to replace a queued job even when running and queued jobs fill the total limit', async () => {
    const executor = new ControlledExecutor();
    const inputBytes = measureDedicatedComputeBytes({ ...work(), taskId: 0, estimatedBytes: 0 });
    const scheduler = new DedicatedComputeScheduler({
      epoch: 'scheduler:1',
      executors: { general: executor, fluid: executor, logic: executor },
      maxTasks: 2,
      maxBytes: inputBytes * 2 + 1024,
      maxResultBytes: 1024,
    });
    const active = scheduler.schedule(work(), { priority: 'streaming', key: 'active', revision: 'r1' });
    const replaced = scheduler.schedule(work({ key: '1,0,0' }), {
      priority: 'background',
      key: 'same',
      revision: 'r1',
    });
    const replacement = scheduler.schedule(work({ key: '2,0,0' }), {
      priority: 'interaction',
      key: 'same',
      revision: 'r2',
    });

    await expect(replaced.candidate).rejects.toThrow(/superseded/i);
    executor.resolve(executor.calls[0].taskId);
    (await active.candidate).acknowledge();
    expect(executor.calls[1]).toMatchObject({ key: '2,0,0' });
    executor.resolve(executor.calls[1].taskId);
    (await replacement.candidate).acknowledge();
    await scheduler.drain();
  });
});
