import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as viteBuild } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createNodeComputeExecutor,
  type NodeComputeExecutorEntryPoints,
} from '../../apps/node-server/src/node/compute/node-compute-executor';
import type { DedicatedComputeTask } from '../../packages/game-core/src/server/compute/dedicated-compute-contract';
import { chunkKey, Voxel } from '../../packages/game-core/src/world/voxel';

let outputDirectory = '';
let entries: NodeComputeExecutorEntryPoints;

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for compute executor state.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const isLive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

const canonicalTask = (taskId: number): DedicatedComputeTask => ({
  kind: 'generate-canonical',
  taskId,
  epoch: 'node-compute-test',
  generation: 1,
  estimatedBytes: 64 * 1024,
  seed: 42,
  generatorVersion: 1,
  key: chunkKey(0, -1, 0),
  cx: 0,
  cy: -1,
  cz: 0,
});

const spawnTask = (taskId: number): DedicatedComputeTask => ({
  kind: 'find-safe-spawn',
  taskId,
  epoch: 'node-compute-test',
  generation: 1,
  estimatedBytes: 64 * 1024,
  seed: 42,
  generatorVersion: 1,
});

const fluidTask = (): DedicatedComputeTask => ({
  kind: 'fluid',
  taskId: 2,
  epoch: 'node-compute-test',
  generation: 1,
  estimatedBytes: 128 * 1024,
  snapshot: {
    protocolVersion: 1,
    epoch: 7,
    workId: 'fluid-1',
    frontier: [[0, 1, 0]],
    chunks: [
      {
        key: chunkKey(0, 0, 0),
        cx: 0,
        cy: 0,
        cz: 0,
        revision: 3,
        voxels: Uint16Array.from({ length: 32 ** 3 }, (_, index) => (index === 32 ? Voxel.Water : Voxel.Air)),
        fluid: Uint8Array.from({ length: 32 ** 3 }, (_, index) => (index === 32 ? 8 : 0)),
      },
    ],
  },
});

const logicTask = (): DedicatedComputeTask => ({
  kind: 'logic',
  taskId: 3,
  epoch: 'node-compute-test',
  generation: 1,
  estimatedBytes: 32 * 1024,
  physicsHz: 60,
  observation: {
    protocolVersion: 1,
    epoch: 'authority:1',
    observationSequence: 3,
    physicsTick: 20,
    activeTimeMs: 500,
    worldTime: 12,
    entities: [],
    decisionContext: { actors: [], pois: { version: 1, sequence: 0, pois: [] }, terrainWindows: [] },
  },
});

beforeAll(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'seedlands-node-compute-'));
  const buildEntry = async (source: string, output: string) => {
    await viteBuild({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: source,
        outDir: outputDirectory,
        emptyOutDir: false,
        target: 'node22',
        rollupOptions: { output: { entryFileNames: output } },
      },
    });
  };
  await buildEntry('apps/node-server/src/node/compute/node-compute-worker.ts', 'node-compute-worker.mjs');
  await buildEntry('apps/node-server/src/node/compute/node-compute-child.ts', 'node-compute-child.mjs');
  await writeFile(
    join(outputDirectory, 'malformed-compute-child.mjs'),
    "process.on('message', (message) => process.send?.({ kind: 'dedicated-compute-result', epoch: message.task.epoch, taskId: message.task.taskId, generation: message.task.generation, resourceGeneration: message.resourceGeneration, ok: true, result: { kind: 'canonical-result', key: 'missing-voxels' } }));\n",
  );
  await writeFile(
    join(outputDirectory, 'wrong-identity-compute-child.mjs'),
    "process.on('message', (message) => process.send?.({ kind: 'dedicated-compute-result', epoch: 'other-epoch', taskId: message.task.taskId, generation: message.task.generation, resourceGeneration: message.resourceGeneration, ok: true, result: { kind: 'canonical-result', key: '0,0,0', cx: 0, cy: 0, cz: 0, chunkRevision: 0, generatorVersion: 1, voxels: new ArrayBuffer(2) } }));\n",
  );
  await writeFile(
    join(outputDirectory, 'exit-zero-compute-child.mjs'),
    "process.on('message', () => process.exit(0));\n",
  );
  await writeFile(
    join(outputDirectory, 'exit-zero-compute-worker.mjs'),
    "import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => process.exit(0));\n",
  );
  await writeFile(
    join(outputDirectory, 'delayed-termination-compute-child.mjs'),
    "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100)); await import('./node-compute-child.mjs');\n",
  );
  await writeFile(
    join(outputDirectory, 'orphan-compute-parent.mjs'),
    "import { fork } from 'node:child_process'; const child = fork(process.argv[2], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' }); child.once('spawn', () => process.stdout.write(`${child.pid}\\n`)); setInterval(() => {}, 1_000);\n",
  );
  entries = {
    worker: pathToFileURL(join(outputDirectory, 'node-compute-worker.mjs')),
    child: pathToFileURL(join(outputDirectory, 'node-compute-child.mjs')),
  };
});

afterAll(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

describe('Node compute executors', () => {
  it('uses the shared task runner for canonical, fluid, and logic candidates without a GameServer', async () => {
    const executor = createNodeComputeExecutor({ mode: 'inline', maxTasks: 4, maxBytes: 512 * 1024 });
    await expect(executor.execute(canonicalTask(1))).resolves.toMatchObject({
      kind: 'canonical-result',
      key: '0,-1,0',
    });
    await expect(executor.execute(fluidTask())).resolves.toMatchObject({
      kind: 'fluid-candidate',
      candidate: { workId: 'fluid-1' },
    });
    await expect(executor.execute(logicTask())).resolves.toEqual({
      kind: 'logic-intents',
      batch: expect.objectContaining({ observationSequence: 3, intents: [] }),
    });
    await executor.close();
  });

  it('exits a compute child when its parent is SIGKILLed and IPC disconnects', async () => {
    const parent = spawn(
      process.execPath,
      [join(outputDirectory, 'orphan-compute-parent.mjs'), join(outputDirectory, 'node-compute-child.mjs')],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const childPid = await new Promise<number>((resolve, reject) => {
      let output = '';
      parent.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        const pid = Number.parseInt(output, 10);
        if (Number.isSafeInteger(pid) && pid > 0) resolve(pid);
      });
      parent.once('error', reject);
      parent.once('exit', (code) => reject(new Error(`Orphan parent exited before child ready: ${code}.`)));
    });
    try {
      if (!parent.pid) throw new Error('Orphan parent PID is unavailable.');
      process.kill(parent.pid, 'SIGKILL');
      await waitFor(() => !isLive(childPid), 2_000);
    } finally {
      if (isLive(childPid)) process.kill(childPid, 'SIGKILL');
    }
  });

  it.each(['worker-thread', 'child-process'] as const)(
    'runs the same candidate contract in a persistent %s executor and reports a real resource identity',
    async (mode) => {
      const executor = createNodeComputeExecutor({
        mode,
        maxTasks: 4,
        maxBytes: 512 * 1024,
        entries,
      });
      await expect(executor.execute(canonicalTask(1))).resolves.toMatchObject({ kind: 'canonical-result' });
      const diagnostics = executor.diagnostics();
      expect(diagnostics.mode).toBe(mode);
      if (mode === 'child-process') expect(diagnostics.childPids).toHaveLength(1);
      else expect(diagnostics.workerThreadIds).toHaveLength(1);
      await executor.close();
    },
  );

  it.each(['worker-thread', 'child-process'] as const)(
    'runs two slots concurrently and reports two real %s identities',
    async (mode) => {
      const executor = createNodeComputeExecutor({
        mode,
        maxTasks: 2,
        maxBytes: 256 * 1024,
        maxResultBytes: 4 * 1024 * 1024,
        poolSize: 2,
        entries,
      });
      const first = executor.execute(spawnTask(1));
      const second = executor.execute(spawnTask(2));
      try {
        const diagnostics = executor.diagnostics();
        expect(diagnostics).toMatchObject({ poolSize: 2, running: 2, liveSlots: 2 });
        if (mode === 'child-process') expect(new Set(diagnostics.childPids).size).toBe(2);
        else expect(new Set(diagnostics.workerThreadIds).size).toBe(2);
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      } finally {
        await executor.close();
      }
    },
  );

  it('rejects a task whose declared bytes underreport its serialized payload', async () => {
    const executor = createNodeComputeExecutor({ mode: 'inline', maxTasks: 2, maxBytes: 256 * 1024 });
    await expect(executor.execute({ ...fluidTask(), estimatedBytes: 1 })).rejects.toThrow(/underreport|payload|byte/i);
    await executor.close();
  });

  it('binds accepted tasks to the configured outer epoch', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'inline',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      expectedEpoch: 'authority-epoch',
    });
    await expect(executor.execute(canonicalTask(1))).rejects.toThrow(/epoch/i);
    await executor.close();
  });

  it('retries a crashed read-only child task once and settles its original promise', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'child-process',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      entries,
    });
    const task = executor.execute(spawnTask(1));
    const [firstPid] = executor.diagnostics().childPids;
    process.kill(firstPid, 'SIGKILL');
    await waitFor(() => executor.diagnostics().childPids.some((pid) => pid !== firstPid));
    await expect(task).resolves.toMatchObject({ kind: 'safe-spawn-result' });
    expect(executor.diagnostics()).toMatchObject({ health: 'healthy', restartCountLastMinute: 1 });
    await executor.close();
  });

  it('degrades after the fourth restart in one minute and settles the accepted task', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'child-process',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      entries,
    });
    try {
      for (let taskId = 1; taskId <= 3; taskId += 1) {
        const task = executor.execute(spawnTask(taskId));
        const [pid] = executor.diagnostics().childPids;
        process.kill(pid, 'SIGKILL');
        await expect(task).resolves.toMatchObject({ kind: 'safe-spawn-result' });
      }
      const task = executor.execute(spawnTask(4));
      const [pid] = executor.diagnostics().childPids;
      process.kill(pid, 'SIGKILL');
      await expect(task).rejects.toThrow(/degraded|restart/i);
      expect(executor.diagnostics()).toMatchObject({ health: 'degraded', restartCountLastMinute: 3 });
    } finally {
      await executor.close();
    }
  });

  it('rejects a malformed IPC response instead of resolving it as a candidate', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'child-process',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      entries: { ...entries, child: pathToFileURL(join(outputDirectory, 'malformed-compute-child.mjs')) },
    });
    await expect(executor.execute(canonicalTask(1))).rejects.toThrow(/response|schema|invalid/i);
    await executor.close();
  });

  it('rejects a response with an otherwise valid but wrong epoch identity', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'child-process',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      entries: { ...entries, child: pathToFileURL(join(outputDirectory, 'wrong-identity-compute-child.mjs')) },
    });
    await expect(executor.execute(canonicalTask(1))).rejects.toThrow(/identity/i);
    await executor.close();
  });

  it('enforces the actual result byte budget before a child result is accepted', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'child-process',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      maxResultBytes: 1,
      entries,
    });
    await expect(executor.execute(canonicalTask(1))).rejects.toThrow(/result exceeds byte budget/i);
    await executor.close();
  });

  it.each(['worker-thread', 'child-process'] as const)(
    'settles an accepted task when a %s exits with code zero before responding',
    async (mode) => {
      const executor = createNodeComputeExecutor({
        mode,
        maxTasks: 1,
        maxBytes: 128 * 1024,
        maxResultBytes: 128 * 1024,
        entries:
          mode === 'worker-thread'
            ? { ...entries, worker: pathToFileURL(join(outputDirectory, 'exit-zero-compute-worker.mjs')) }
            : { ...entries, child: pathToFileURL(join(outputDirectory, 'exit-zero-compute-child.mjs')) },
      });
      await expect(executor.execute(canonicalTask(1))).rejects.toThrow(/exited/i);
      expect(executor.diagnostics()).toMatchObject({ queued: 0, running: 0, runningBytes: 0 });
      await executor.close();
    },
  );

  it('waits for a cancelled child resource to exit before close resolves', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'child-process',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      entries,
    });
    const controller = new AbortController();
    const task = executor.execute(spawnTask(1), { signal: controller.signal });
    const [pid] = executor.diagnostics().childPids;
    controller.abort();
    await expect(task).rejects.toThrow(/cancelled/i);
    await executor.close();
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('does not reuse a cancelling child slot until its old resource has terminated', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'child-process',
      maxTasks: 2,
      maxBytes: 256 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      entries: { ...entries, child: pathToFileURL(join(outputDirectory, 'delayed-termination-compute-child.mjs')) },
    });
    const controller = new AbortController();
    const cancelled = executor.execute(spawnTask(1), { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();
    const replacement = executor.execute({ ...canonicalTask(2), generation: 2 });
    await expect(cancelled).rejects.toThrow(/cancelled/i);
    expect(executor.diagnostics()).toMatchObject({ poolSize: 1, liveSlots: 1, terminatingSlots: 1, queued: 1 });
    await expect(replacement).resolves.toMatchObject({ kind: 'canonical-result' });
    await executor.close();
  });

  it('keeps only a scalar task identity high-watermark after sequential task settlement', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'inline',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      maxResultBytes: 128 * 1024,
    });
    await expect(executor.execute(canonicalTask(1))).resolves.toMatchObject({ kind: 'canonical-result' });
    await expect(executor.execute(canonicalTask(2))).resolves.toMatchObject({ kind: 'canonical-result' });
    expect(executor.diagnostics()).toMatchObject({ taskIdHighWatermark: 2, queued: 0, running: 0 });
    await executor.close();
  });

  it('rejects queue overflow and ignores work aborted before it can start', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'inline',
      maxTasks: 1,
      maxBytes: 64 * 1024,
      maxResultBytes: 128 * 1024,
    });
    const first = executor.execute(canonicalTask(1));
    await expect(executor.execute(canonicalTask(2))).rejects.toThrow(/backpressure/i);
    const controller = new AbortController();
    controller.abort();
    await expect(executor.execute(canonicalTask(3), { signal: controller.signal })).rejects.toThrow(/cancelled/i);
    await expect(executor.execute({ ...canonicalTask(4), generation: 2 })).rejects.toThrow(/stale/i);
    await first;
    expect(executor.diagnostics().cancelledTasks).toBe(1);
    await executor.close();
  });

  it('cancels in-flight worker work by replacing the resource generation', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'worker-thread',
      maxTasks: 1,
      maxBytes: 128 * 1024,
      entries,
    });
    const controller = new AbortController();
    const task = executor.execute(spawnTask(1), { signal: controller.signal });
    controller.abort();
    await expect(task).rejects.toThrow(/cancelled/i);
    expect(executor.diagnostics()).toMatchObject({ generation: 2, cancelledTasks: 1, running: 0 });
    await expect(executor.execute({ ...canonicalTask(2), generation: 2 })).resolves.toMatchObject({
      kind: 'canonical-result',
    });
    await executor.close();
  });

  it('settles queued old-generation work when cancelling an in-flight task', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'worker-thread',
      maxTasks: 2,
      maxBytes: 128 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      entries,
    });
    const controller = new AbortController();
    const running = executor.execute(spawnTask(1), { signal: controller.signal });
    const queued = executor.execute(canonicalTask(2));
    controller.abort();
    await expect(running).rejects.toThrow(/cancelled/i);
    await expect(queued).rejects.toThrow(/generation|cancelled/i);
    expect(executor.diagnostics()).toMatchObject({ generation: 2, queued: 0, running: 0 });
    await executor.close();
  });

  it('retries crashed work once while settling other accepted child-process work', async () => {
    const executor = createNodeComputeExecutor({
      mode: 'child-process',
      maxTasks: 2,
      maxBytes: 128 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      entries,
    });
    const running = executor.execute(spawnTask(1));
    const queued = executor.execute(canonicalTask(2));
    const [pid] = executor.diagnostics().childPids;
    process.kill(pid, 'SIGKILL');
    await expect(running).resolves.toMatchObject({ kind: 'safe-spawn-result' });
    await expect(queued).resolves.toMatchObject({ kind: 'canonical-result' });
    expect(executor.diagnostics()).toMatchObject({
      health: 'healthy',
      restartCountLastMinute: 1,
      queued: 0,
      running: 0,
    });
    await executor.close();
  });
});
