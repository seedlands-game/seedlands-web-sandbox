import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { build as viteBuild } from 'vite';
import { createNodeAuthorityLane, type NodeAuthorityLane } from '../../src/node/runtime/node-authority-lane';
import { createNodePersistenceLane } from '../../src/node/persistence/node-persistence-lane';
import { GENERATOR_VERSION, CHUNK_SIZE } from '../../src/world/voxel';
import type { AuthorityCollisionBaselineResult } from '../../src/server/game-server-types';

type CollisionBaselineLane = NodeAuthorityLane &
  Readonly<{
    readCollisionBaseline(key: string, minimumRevision: number): Promise<AuthorityCollisionBaselineResult>;
  }>;

let buildDirectory = '';
let authorityEntry: URL;
let persistenceEntry: URL;
const directories: string[] = [];

beforeAll(async () => {
  buildDirectory = await mkdtemp(join(tmpdir(), 'seedlands-authority-collision-build-'));
  await viteBuild({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: 'src/node/server/node-authority-worker.ts',
      outDir: join(buildDirectory, 'authority'),
      emptyOutDir: true,
      target: 'node22',
      rollupOptions: { output: { entryFileNames: 'node-authority-worker.mjs' } },
    },
  });
  await viteBuild({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: 'src/node/persistence/node-persistence-worker.ts',
      outDir: join(buildDirectory, 'persistence'),
      emptyOutDir: true,
      target: 'node22',
      rollupOptions: { output: { entryFileNames: 'node-persistence-worker.mjs' } },
    },
  });
  authorityEntry = pathToFileURL(join(buildDirectory, 'authority', 'node-authority-worker.mjs'));
  persistenceEntry = pathToFileURL(join(buildDirectory, 'persistence', 'node-persistence-worker.mjs'));
}, 30_000);

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

afterAll(async () => {
  if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true });
});

async function createLane(): Promise<Readonly<{ lane: CollisionBaselineLane; close(): Promise<void> }>> {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-authority-collision-world-'));
  directories.push(directory);
  const persistence = await createNodePersistenceLane({
    entry: persistenceEntry,
    epoch: 'authority-collision-baseline',
    store: { directory, seedText: 'authority-collision-baseline', generatorVersion: GENERATOR_VERSION },
  });
  const lane = (await createNodeAuthorityLane({
    entry: authorityEntry,
    epoch: 'authority-collision-baseline',
    seedText: 'authority-collision-baseline',
    generatorVersion: GENERATOR_VERSION,
    persistencePort: persistence.authorityPort,
    persistenceProxy: persistence.proxy,
    computeMode: 'inline',
    computeEntries: {
      worker: new URL('file:///unused/node-compute-worker.js'),
      child: new URL('file:///unused/node-compute-child.js'),
    },
    hostLimits: { saveIntervalMs: 60_000 },
  })) as CollisionBaselineLane;
  return {
    lane,
    async close() {
      await lane.stop();
      await lane.close();
      await persistence.close();
    },
  };
}

async function createScriptedBaselineLane(
  name: string,
  payloadSource: string,
): Promise<Readonly<{ lane: NodeAuthorityLane; close(): Promise<void> }>> {
  const path = join(buildDirectory, `${name}-authority-worker.mjs`);
  await writeFile(
    path,
    `
      import { parentPort } from 'node:worker_threads';
      const bytes = new TextEncoder();
      const measure = (value) => {
        if (value === null || value === undefined || typeof value === 'boolean') return 1;
        if (typeof value === 'number') return 9;
        if (typeof value === 'string') return 5 + bytes.encode(value).byteLength;
        if (value instanceof ArrayBuffer) return 5 + value.byteLength;
        if (Array.isArray(value)) return 5 + value.reduce((total, item) => total + measure(item), 0);
        return 5 + Object.keys(value).sort().reduce((total, key) => total + 4 + bytes.encode(key).byteLength + measure(value[key]), 0);
      };
      parentPort.once('message', (bootstrap) => {
        parentPort.postMessage({ type: 'ready', diagnostics: {} });
        bootstrap.controlPort.on('message', (request) => {
          if (request?.type !== 'request' || request.kind !== 'authority-read-collision-baseline') return;
          const payload = ${payloadSource};
          bootstrap.controlPort.postMessage({
            type: 'response', epoch: bootstrap.options.epoch, generation: request.generation,
            requestId: request.requestId, kind: request.kind, ok: true, payload, payloadBytes: measure(payload),
          });
        });
        let failed = false;
        parentPort.on('message', (request) => {
          if (failed || request?.type !== 'fail') return;
          failed = true;
          parentPort.postMessage({ type: 'fatal', error: request.error });
          parentPort.postMessage({ type: 'cleanup-complete' });
        });
        setInterval(() => {}, 1_000);
      });
    `,
  );
  const persistence = new MessageChannel();
  const rpcLimits = {
    maxRequests: 4,
    maxQueuedBytes: 1024 * 1024,
    maxInFlightBytes: 1024 * 1024,
    maxResponseBytes: 1024 * 1024,
    maxReservedResponseBytes: 1024 * 1024,
    maxConcurrentRequests: 1,
  };
  const lane = await createNodeAuthorityLane({
    entry: pathToFileURL(path),
    epoch: `collision-${name}`,
    seedText: `collision-${name}`,
    generatorVersion: GENERATOR_VERSION,
    persistencePort: persistence.port1,
    persistenceProxy: {
      identity: { worldId: 'default', seedText: `collision-${name}`, generatorVersion: GENERATOR_VERSION },
      limits: { maxCachedChunks: 1, maxCachedBytes: 1, maxRetainedSaveBytes: 1 },
      rpcLimits,
      generation: 1,
    },
    controlRpcLimits: rpcLimits,
    computeMode: 'inline',
    computeEntries: {
      worker: new URL('file:///unused/node-compute-worker.js'),
      child: new URL('file:///unused/node-compute-child.js'),
    },
  });
  return {
    lane,
    async close() {
      const exited = lane.whenExited();
      void exited.catch(() => undefined);
      await lane.close().catch(() => undefined);
      await exited.catch(() => undefined);
      persistence.port2.close();
    },
  };
}

describe('Node Authority lane collision baseline 只读门面', () => {
  it('真实 Node 22 Worker 只读取已加载 Chunk，回复隔离且不为不存在 Chunk 生成或写入', async () => {
    const fixture = await createLane();
    try {
      await fixture.lane.waitForIdle();
      // The live Host may independently advance its active window between any two RPCs.
      // Attribute the non-generation guarantee to this remote key, never to global job counters.
      const absentKey = '9999,0,9999';
      await expect(fixture.lane.readCollisionBaseline(absentKey, 0)).resolves.toEqual({
        status: 'unavailable',
        key: absentKey,
      });
      await fixture.lane.waitForIdle();
      await expect(fixture.lane.readCollisionBaseline(absentKey, 0)).resolves.toEqual({
        status: 'unavailable',
        key: absentKey,
      });

      expect(await fixture.lane.requestChunk('97,0,97')).toBe(true);
      const first = await fixture.lane.readCollisionBaseline('97,0,97', 0);
      expect(first).toMatchObject({ status: 'available', key: '97,0,97', chunkRevision: expect.any(Number) });
      if (first.status !== 'available') throw new Error('Expected loaded collision baseline.');
      expect(first.canonical.byteLength).toBe(CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT);
      expect(first.fluid.byteLength).toBe(CHUNK_SIZE ** 3 * Uint8Array.BYTES_PER_ELEMENT);
      expect(Object.keys(first).sort()).toEqual(['canonical', 'chunkRevision', 'fluid', 'key', 'status']);
      const original = new Uint16Array(first.canonical)[0];
      new Uint16Array(first.canonical)[0] = (original + 1) & 0xffff;
      const second = await fixture.lane.readCollisionBaseline('97,0,97', 0);
      expect(second.status).toBe('available');
      if (second.status !== 'available') throw new Error('Expected a repeat collision baseline.');
      expect(second.canonical).not.toBe(first.canonical);
      expect(new Uint16Array(second.canonical)[0]).toBe(original);
      await expect(fixture.lane.readCollisionBaseline('97,0,97', second.chunkRevision + 1)).resolves.toEqual({
        status: 'unavailable',
        key: '97,0,97',
      });
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it('错误 epoch 的 baseline 回复不能越过 Authority RPC 身份门', async () => {
    const path = join(buildDirectory, 'wrong-identity-authority-worker.mjs');
    await writeFile(
      path,
      `
        import { parentPort } from 'node:worker_threads';
        parentPort.once('message', (bootstrap) => {
          parentPort.postMessage({ type: 'ready', diagnostics: {} });
          bootstrap.controlPort.on('message', (request) => {
            if (request?.type !== 'request' || request.kind !== 'authority-read-collision-baseline') return;
            bootstrap.controlPort.postMessage({
              type: 'response', epoch: 'wrong-epoch', generation: request.generation,
              requestId: request.requestId, kind: request.kind, ok: true,
              payload: { status: 'unavailable', key: request.payload.key }, payloadBytes: 0,
            });
          });
          let failed = false;
          parentPort.on('message', (request) => {
            if (failed || request?.type !== 'fail') return;
            failed = true;
            parentPort.postMessage({ type: 'fatal', error: request.error });
            parentPort.postMessage({ type: 'cleanup-complete' });
          });
          setInterval(() => {}, 1_000);
        });
      `,
    );
    const persistence = new MessageChannel();
    const lane = await createNodeAuthorityLane({
      entry: pathToFileURL(path),
      epoch: 'collision-identity',
      seedText: 'collision-identity',
      generatorVersion: GENERATOR_VERSION,
      persistencePort: persistence.port1,
      persistenceProxy: {
        identity: { worldId: 'default', seedText: 'collision-identity', generatorVersion: GENERATOR_VERSION },
        limits: {
          maxCachedChunks: 1,
          maxCachedBytes: 1,
          maxRetainedSaveBytes: 1,
        },
        rpcLimits: {
          maxRequests: 4,
          maxQueuedBytes: 1024,
          maxInFlightBytes: 1024,
          maxResponseBytes: 1024,
          maxReservedResponseBytes: 1024,
          maxConcurrentRequests: 1,
        },
        generation: 1,
      },
      controlRpcLimits: {
        maxRequests: 4,
        maxQueuedBytes: 1024,
        maxInFlightBytes: 1024,
        maxResponseBytes: 1024,
        maxReservedResponseBytes: 1024,
        maxConcurrentRequests: 1,
      },
      computeMode: 'inline',
      computeEntries: {
        worker: new URL('file:///unused/node-compute-worker.js'),
        child: new URL('file:///unused/node-compute-child.js'),
      },
    });
    try {
      await expect(lane.readCollisionBaseline('0,0,0', 0)).rejects.toThrow(/violated|identity/i);
      await expect(lane.whenFailed()).resolves.toMatchObject({ message: expect.stringMatching(/violated|identity/i) });
      await expect(lane.stop()).rejects.toThrow(/violated|identity/i);
      const exited = lane.whenExited();
      void exited.catch(() => undefined);
      await expect(lane.close()).rejects.toThrow(/violated|identity|exited/i);
      await expect(exited).rejects.toThrow(/violated|identity|exited/i);
    } finally {
      persistence.port2.close();
    }
  });

  it.each([
    {
      name: '同身份但 key 不匹配',
      key: '0,0,0',
      minimumRevision: 0,
      payload: "({ status: 'unavailable', key: '1,0,0' })",
      error: /key/i,
    },
    {
      name: '同身份但 available revision 过旧',
      key: '0,0,0',
      minimumRevision: 2,
      payload: `({ status: 'available', key: '0,0,0', chunkRevision: 1, canonical: new ArrayBuffer(${CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT}), fluid: new ArrayBuffer(${CHUNK_SIZE ** 3}) })`,
      error: /revision/i,
    },
  ])('$name 的 baseline 回复触发协议失败与有序清理', async ({ name, key, minimumRevision, payload, error }) => {
    const fixture = await createScriptedBaselineLane(name.replaceAll(' ', '-'), payload);
    try {
      await expect(fixture.lane.readCollisionBaseline(key, minimumRevision)).rejects.toThrow(error);
      await expect(fixture.lane.whenFailed()).resolves.toMatchObject({ message: expect.stringMatching(error) });
      await expect(fixture.lane.stop()).rejects.toThrow(error);
      expect(fixture.lane.state()).toBe('failed');
    } finally {
      await fixture.close();
    }
  });
});
