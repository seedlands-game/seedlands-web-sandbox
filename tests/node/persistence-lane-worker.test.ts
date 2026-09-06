import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NodeRpcPort } from '../../src/node/runtime/node-rpc-contract';
import { build as viteBuild } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileGamePersistence } from '../../src/node/persistence/file-game-persistence';
import { createNodePersistenceLane } from '../../src/node/persistence/node-persistence-lane';
import { createNodePersistenceLaneProxy } from '../../src/node/persistence/persistence-lane-proxy';
import { GameServer } from '../../src/server/game-server';
import { GENERATOR_VERSION, Voxel } from '../../src/world/voxel';

let outputDirectory = '';
let workerEntry: URL;
let crashingWorkerEntry: URL;
let delayedClosingWorkerEntry: URL;
const directories: string[] = [];

beforeAll(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'seedlands-persistence-worker-build-'));
  await viteBuild({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: 'src/node/persistence/node-persistence-worker.ts',
      outDir: outputDirectory,
      emptyOutDir: true,
      target: 'node22',
      rollupOptions: { output: { entryFileNames: 'node-persistence-worker.mjs' } },
    },
  });
  workerEntry = pathToFileURL(join(outputDirectory, 'node-persistence-worker.mjs'));
  const crashingPath = join(outputDirectory, 'crashing-persistence-worker.mjs');
  await writeFile(
    crashingPath,
    [
      "import { parentPort, threadId, workerData } from 'node:worker_threads';",
      "parentPort.postMessage({ type: 'persistence-worker-ready', epoch: workerData.epoch, generation: workerData.generation, threadId, identity: { worldId: workerData.store.worldId ?? 'default', seedText: workerData.store.seedText, generatorVersion: workerData.store.generatorVersion }, rpc: { accepted: 0, rejected: 0, pending: 0, queuedBytes: 0, inFlightBytes: 0, responseBytes: 0, staleMessages: 0, nextRequestId: 0, closed: false, activeHandlers: 0 } });",
      'setTimeout(() => process.exit(7), 20);',
    ].join('\n'),
  );
  crashingWorkerEntry = pathToFileURL(crashingPath);
  const delayedClosingPath = join(outputDirectory, 'delayed-closing-persistence-worker.mjs');
  await writeFile(
    delayedClosingPath,
    [
      "import { parentPort, threadId, workerData } from 'node:worker_threads';",
      'const rpc = { accepted: 0, rejected: 0, pending: 0, queuedBytes: 0, inFlightBytes: 0, responseBytes: 0, staleMessages: 0, nextRequestId: 0, closed: false, activeHandlers: 0 };',
      "parentPort.postMessage({ type: 'persistence-worker-ready', epoch: workerData.epoch, generation: workerData.generation, threadId, identity: { worldId: workerData.store.worldId ?? 'default', seedText: workerData.store.seedText, generatorVersion: workerData.store.generatorVersion }, rpc });",
      "parentPort.once('message', (message) => {",
      "  if (message.type !== 'persistence-worker-close') return;",
      "  setTimeout(() => parentPort.postMessage({ type: 'persistence-worker-store-closed', epoch: workerData.epoch, generation: workerData.generation, rpc: { ...rpc, closed: true } }), 200);",
      '});',
    ].join('\n'),
  );
  delayedClosingWorkerEntry = pathToFileURL(delayedClosingPath);
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

afterAll(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

async function temporaryWorld(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-persistence-worker-'));
  directories.push(directory);
  return directory;
}

describe('Node Persistence Worker lane', () => {
  it('在真实独立 thread 持有锁，经有界 RPC 保存并在重启后恢复', async () => {
    const directory = await temporaryWorld();
    const lane = await createNodePersistenceLane({
      entry: workerEntry,
      epoch: 'persistence-worker-e2e',
      store: { directory, seedText: 'worker-world', generatorVersion: GENERATOR_VERSION },
    });
    expect(lane.state).toBe('ready');
    expect(lane.threadId).toBeGreaterThan(0);
    await expect(
      FileGamePersistence.open({ directory, seedText: 'worker-world', generatorVersion: GENERATOR_VERSION }),
    ).rejects.toThrow(/锁|lock|writer/i);

    const proxy = await createNodePersistenceLaneProxy({
      port: lane.authorityPort as unknown as NodeRpcPort,
      epoch: 'persistence-worker-e2e',
      bootstrap: lane.proxy,
    });
    const server = new GameServer({ seedText: 'worker-world', persistence: proxy });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    server.edit(0, 20, 0, Voxel.Wood);
    await server.save(1);
    const loadDiagnostics = await proxy.ensureNeighborhood(0, 0, 0);
    expect(loadDiagnostics.measurementStatus).toEqual({
      queueWaitMs: 'not-collected',
      databaseMs: 'unsupported',
      transactionReadMs: 'measured',
      decodeMs: 'measured',
      totalWorkerMs: 'measured',
      roundTripMs: 'measured',
    });
    expect(loadDiagnostics.transactionReadMs).toBeGreaterThan(0);
    expect(loadDiagnostics.roundTripMs).toBeGreaterThanOrEqual(0);
    expect(proxy.loadSnapshot('0,0,0')?.voxels).toContain(Voxel.Wood);
    await Promise.all([proxy.close(), proxy.close()]);
    await lane.close();
    await expect(lane.whenExited()).resolves.toBeUndefined();
    await expect(lane.close()).resolves.toBeUndefined();
    expect(lane.state).toBe('closed');

    const reopened = await FileGamePersistence.open({
      directory,
      seedText: 'worker-world',
      generatorVersion: GENERATOR_VERSION,
    });
    expect(reopened.loadGameCheckpoint()).toEqual({ commitSequence: 1, worldRevision: 1 });
    await reopened.ensureSnapshot(0, 0, 0);
    expect(reopened.loadSnapshot('0,0,0')?.voxels).toContain(Voxel.Wood);
    expect(reopened.loadGameplaySnapshot()).toMatchObject({ entities: [{ id: 'player' }] });
    await reopened.close();
  }, 30_000);

  it('bootstrap ready 前已持锁，同目录第二 lane 失败且第一 lane 可正常关闭', async () => {
    const directory = await temporaryWorld();
    const options = {
      entry: workerEntry,
      store: { directory, seedText: 'worker-lock', generatorVersion: GENERATOR_VERSION },
    };
    const first = await createNodePersistenceLane({ ...options, epoch: 'persistence-lock-first' });
    await expect(createNodePersistenceLane({ ...options, epoch: 'persistence-lock-second' })).rejects.toThrow(
      /锁|lock|writer/i,
    );
    await first.close();

    const replacement = await createNodePersistenceLane({ ...options, epoch: 'persistence-lock-replacement' });
    await replacement.close();
  }, 30_000);

  it('未发生业务 open 时也能由 main 关闭并确认锁已释放', async () => {
    const directory = await temporaryWorld();
    const lane = await createNodePersistenceLane({
      entry: workerEntry,
      epoch: 'persistence-no-handshake',
      store: { directory, seedText: 'no-handshake', generatorVersion: GENERATOR_VERSION },
    });
    await lane.close();
    const reopened = await FileGamePersistence.open({
      directory,
      seedText: 'no-handshake',
      generatorVersion: GENERATOR_VERSION,
    });
    await reopened.close();
  }, 30_000);

  it('ready 后 Worker 意外退出会进入 failed，whenExited 不会伪报正常结束', async () => {
    const directory = await temporaryWorld();
    const lane = await createNodePersistenceLane({
      entry: crashingWorkerEntry,
      epoch: 'persistence-crash',
      store: { directory, seedText: 'crash-world', generatorVersion: GENERATOR_VERSION },
    });
    await expect(lane.whenExited()).rejects.toThrow(/意外退出.*code=7/);
    expect(lane.state).toBe('failed');
    expect(lane.diagnostics()).toMatchObject({ state: 'failed', error: expect.stringContaining('code=7') });
  }, 30_000);

  it('调用方超时不让 lane.close 提前放弃仍在收尾的物理 Worker', async () => {
    const directory = await temporaryWorld();
    const lane = await createNodePersistenceLane({
      entry: delayedClosingWorkerEntry,
      epoch: 'persistence-delayed-close',
      store: { directory, seedText: 'delayed-close', generatorVersion: GENERATOR_VERSION },
    });

    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    try {
      const closing = lane.close();
      await vi.advanceTimersByTimeAsync(30_001);
      await expect(closing).resolves.toBeUndefined();
      await expect(lane.whenExited()).resolves.toBeUndefined();
      expect(lane.state).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);

  it('存储关闭失败时保留失败证据，但先收回RPC与物理Worker再结算close', async () => {
    const directory = await temporaryWorld();
    const lane = await createNodePersistenceLane({
      entry: workerEntry,
      epoch: 'persistence-close-failure',
      store: { directory, seedText: 'close-failure', generatorVersion: GENERATOR_VERSION },
    });
    const lockPath = join(directory, 'LOCK');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as Record<string, unknown>;
    await writeFile(lockPath, JSON.stringify({ ...lock, token: 'tampered-lock-token' }));

    const closing = lane.close().then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );
    const physicalExit = lane.whenExited().then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );
    expect(
      await Promise.race([
        physicalExit,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500)),
      ]),
    ).toBe('rejected');
    await expect(closing).resolves.toBe('rejected');
    expect(lane.state).toBe('failed');
    await expect(readFile(lockPath, 'utf8')).resolves.toContain('tampered-lock-token');
  }, 30_000);
});
