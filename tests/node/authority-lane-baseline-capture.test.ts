import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { build as viteBuild } from 'vite';
import {
  createNodeAuthorityLane,
  type NodeAuthorityLane,
  type NodeAuthorityLaneOptions,
} from '../../src/node/runtime/node-authority-lane';
import { createNodePersistenceLane } from '../../src/node/persistence/node-persistence-lane';
import type {
  AuthorityBaselineCaptureCancellation,
  AuthorityBaselineCaptureRequest,
  AuthorityBaselineCaptureResult,
} from '../../src/server/authority/authority-baseline-capture-types';
import { GENERATOR_VERSION, CHUNK_SIZE, chunkKey } from '../../src/world/voxel';
import { measureNodeRpcBytes } from '../../src/node/runtime/node-rpc-bytes';

type BaselineLane = NodeAuthorityLane &
  Readonly<{
    captureBaseline(request: AuthorityBaselineCaptureRequest): Promise<AuthorityBaselineCaptureResult>;
    cancelBaselineCapture(captureId: number): Promise<AuthorityBaselineCaptureCancellation>;
  }>;

type Fixture = Readonly<{ lane: BaselineLane; close(): Promise<void> }>;

let buildDirectory = '';
let authorityEntry: URL;
let persistenceEntry: URL;
const directories: string[] = [];
const capture = (captureId: number, purpose: 'mesh' | 'collision-resync', key = '0,1,0', minimumRevision = 0) => ({
  captureId,
  purpose,
  key,
  minimumRevision,
});

function meshKeys(key: string): readonly string[] {
  const [cx, cy, cz] = key.split(',').map(Number) as [number, number, number];
  return [
    key,
    ...Array.from({ length: 3 }, (_, y) => cy + y - 1).flatMap((y) =>
      Array.from({ length: 3 }, (_, z) => cz + z - 1).flatMap((z) =>
        Array.from({ length: 3 }, (_, x) => cx + x - 1)
          .filter((x) => x !== cx || y !== cy || z !== cz)
          .map((x) => chunkKey(x, y, z)),
      ),
    ),
  ];
}

beforeAll(async () => {
  buildDirectory = await mkdtemp(join(tmpdir(), 'seedlands-authority-capture-build-'));
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

async function createLane(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-authority-capture-world-'));
  directories.push(directory);
  const persistence = await createNodePersistenceLane({
    entry: persistenceEntry,
    epoch: 'authority-baseline-capture',
    store: { directory, seedText: 'authority-baseline-capture', generatorVersion: GENERATOR_VERSION },
  });
  const lane = (await createNodeAuthorityLane({
    entry: authorityEntry,
    epoch: 'authority-baseline-capture',
    seedText: 'authority-baseline-capture',
    generatorVersion: GENERATOR_VERSION,
    persistencePort: persistence.authorityPort,
    persistenceProxy: persistence.proxy,
    computeMode: 'inline',
    computeEntries: {
      worker: new URL('file:///unused/node-compute-worker.js'),
      child: new URL('file:///unused/node-compute-child.js'),
    },
    hostLimits: { saveIntervalMs: 60_000 },
  })) as BaselineLane;
  return {
    lane,
    async close() {
      await lane.stop().catch(() => undefined);
      await lane.close().catch(() => undefined);
      await persistence.close();
    },
  };
}

async function createScriptedLane(name: string, payloadFactory: string): Promise<Fixture> {
  const entry = join(buildDirectory, `${name}-authority-worker.mjs`);
  await writeFile(
    entry,
    `
      import { parentPort } from 'node:worker_threads';
      const encoder = new TextEncoder();
      const measure = (value) => value === null || value === undefined || typeof value === 'boolean' ? 1
        : typeof value === 'number' ? 9
        : typeof value === 'string' ? 5 + encoder.encode(value).byteLength
        : value instanceof ArrayBuffer ? 5 + value.byteLength
        : Array.isArray(value) ? 5 + value.reduce((total, item) => total + measure(item), 0)
        : 5 + Object.keys(value).sort().reduce((total, key) => total + 4 + encoder.encode(key).byteLength + measure(value[key]), 0);
      parentPort.once('message', (bootstrap) => {
        parentPort.postMessage({ type: 'ready', diagnostics: {} });
        bootstrap.controlPort.on('message', (request) => {
          if (request?.type !== 'request' || !['authority-capture-mesh-baseline', 'authority-capture-collision-baseline', 'authority-cancel-baseline-capture'].includes(request.kind)) return;
          const payload = (${payloadFactory})(request, bootstrap);
          bootstrap.controlPort.postMessage({
            type: 'response', epoch: bootstrap.options.epoch, generation: request.generation,
            requestId: request.requestId, kind: request.kind, ok: true, payload, payloadBytes: measure(payload),
          });
        });
        parentPort.on('message', (request) => {
          if (request?.type !== 'fail') return;
          parentPort.postMessage({ type: 'fatal', error: request.error });
          parentPort.postMessage({ type: 'cleanup-complete' });
        });
        setInterval(() => {}, 1_000);
      });
    `,
  );
  const persistence = new MessageChannel();
  const limits = {
    maxRequests: 4,
    maxQueuedBytes: 4 * 1024 * 1024,
    maxInFlightBytes: 4 * 1024 * 1024,
    maxResponseBytes: 4 * 1024 * 1024,
    maxReservedResponseBytes: 4 * 1024 * 1024,
    maxConcurrentRequests: 1,
  };
  const options: NodeAuthorityLaneOptions = {
    entry: pathToFileURL(entry),
    epoch: `capture-${name}`,
    seedText: `capture-${name}`,
    generatorVersion: GENERATOR_VERSION,
    persistencePort: persistence.port1,
    persistenceProxy: {
      identity: { worldId: 'default', seedText: `capture-${name}`, generatorVersion: GENERATOR_VERSION },
      limits: { maxCachedChunks: 1, maxCachedBytes: 1, maxRetainedSaveBytes: 1 },
      rpcLimits: limits,
      generation: 1,
    },
    controlRpcLimits: limits,
    computeMode: 'inline',
    computeEntries: {
      worker: new URL('file:///unused/node-compute-worker.js'),
      child: new URL('file:///unused/node-compute-child.js'),
    },
  };
  const lane = (await createNodeAuthorityLane(options)) as BaselineLane;
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

function assertAvailable(
  result: AuthorityBaselineCaptureResult,
): asserts result is Extract<AuthorityBaselineCaptureResult, { status: 'available' }> {
  if (result.status !== 'available') throw new Error(`Expected available capture, received ${result.reason}.`);
}

describe('Node Authority lane baseline capture', () => {
  it('真实 Node 22 Worker 采集完整 mesh/collision owned baseline，并在 stop 中有序结算', async () => {
    const fixture = await createLane();
    try {
      const mesh = await fixture.lane.captureBaseline(capture(0, 'mesh'));
      assertAvailable(mesh);
      expect(mesh.entries).toHaveLength(27);
      expect(mesh.entries[0]).toMatchObject({ role: 'main', key: '0,1,0', generatorVersion: GENERATOR_VERSION });
      expect(mesh.entries.slice(1).every((entry) => entry.role === 'overlay')).toBe(true);
      expect(mesh.entries.map((entry) => entry.key)).toEqual(meshKeys('0,1,0'));
      expect(mesh.entries.flatMap((entry) => [entry.canonical, entry.fluid])).toHaveLength(54);
      expect(new Set(mesh.entries.flatMap((entry) => [entry.canonical, entry.fluid])).size).toBe(54);
      for (const entry of mesh.entries) {
        expect(entry.canonical.byteLength).toBe(CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT);
        expect(entry.fluid.byteLength).toBe(CHUNK_SIZE ** 3 * Uint8Array.BYTES_PER_ELEMENT);
      }
      expect(measureNodeRpcBytes(mesh)).toBeGreaterThan(27 * 96 * 1024);
      expect(measureNodeRpcBytes(mesh)).toBeLessThan(4 * 1024 * 1024);
      const original = new Uint16Array(mesh.entries[0]!.canonical)[0];
      new Uint16Array(mesh.entries[0]!.canonical)[0] = (original + 1) & 0xffff;
      const repeat = await fixture.lane.captureBaseline(capture(1, 'mesh'));
      assertAvailable(repeat);
      expect(new Uint16Array(repeat.entries[0]!.canonical)[0]).toBe(original);
      const collision = await fixture.lane.captureBaseline(capture(2, 'collision-resync'));
      assertAvailable(collision);
      expect(collision.entries).toHaveLength(1);
      expect(collision.entries[0]).toMatchObject({ role: 'collision-resync', key: '0,1,0' });
      await expect(
        fixture.lane.captureBaseline(capture(3, 'collision-resync', '0,1,0', 99_999)),
      ).resolves.toMatchObject({
        status: 'unavailable',
        reason: 'not-available',
      });
      await expect(fixture.lane.cancelBaselineCapture(99)).resolves.toEqual({
        captureId: 99,
        captureGeneration: null,
        status: 'unknown',
      });
      await expect(fixture.lane.cancelBaselineCapture(0)).resolves.toMatchObject({
        captureId: 0,
        status: 'already-settled',
      });
      const mutableRequest = capture(4, 'collision-resync');
      const copiedCapture = fixture.lane.captureBaseline(mutableRequest);
      mutableRequest.key = '99,99,99';
      mutableRequest.minimumRevision = 99_999;
      await expect(copiedCapture).resolves.toMatchObject({ captureId: 4, key: '0,1,0' });
      const stoppingCapture = fixture.lane.captureBaseline(capture(5, 'mesh', '20,1,0'));
      await expect(fixture.lane.stop()).resolves.toMatchObject({ status: 'stopped' });
      await expect(stoppingCapture).resolves.toMatchObject({ captureId: 5 });
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it.each([
    {
      name: 'captureId',
      request: capture(7, 'collision-resync'),
      payload: `(request) => ({ status: 'unavailable', captureId: request.payload.captureId + 1, captureGeneration: 0, purpose: request.payload.purpose, key: request.payload.key, reason: 'not-available' })`,
    },
    {
      name: 'key',
      request: capture(7, 'collision-resync'),
      payload: `(request) => ({ status: 'unavailable', captureId: request.payload.captureId, captureGeneration: 0, purpose: request.payload.purpose, key: '1,1,1', reason: 'not-available' })`,
    },
    {
      name: 'purpose',
      request: capture(7, 'collision-resync'),
      payload: `(request) => ({ status: 'unavailable', captureId: request.payload.captureId, captureGeneration: 0, purpose: 'mesh', key: request.payload.key, reason: 'not-available' })`,
    },
    {
      name: 'checkpoint epoch',
      request: capture(7, 'collision-resync', '0,1,0', 0),
      payload: `(request) => ({ status: 'available', captureId: request.payload.captureId, captureGeneration: 0, purpose: 'collision-resync', key: request.payload.key, checkpoint: { epoch: 'wrong', physicsTick: 0, commitSequence: 0, worldRevision: 0 }, entries: [{ role: 'collision-resync', key: request.payload.key, chunkRevision: 0, generatorVersion: 2, canonical: new ArrayBuffer(65536), fluid: new ArrayBuffer(32768) }] })`,
    },
    {
      name: 'revision',
      request: capture(7, 'collision-resync', '0,1,0', 2),
      payload: `(request) => ({ status: 'available', captureId: request.payload.captureId, captureGeneration: 0, purpose: 'collision-resync', key: request.payload.key, checkpoint: { epoch: bootstrap.options.epoch, physicsTick: 0, commitSequence: 0, worldRevision: 0 }, entries: [{ role: 'collision-resync', key: request.payload.key, chunkRevision: 1, generatorVersion: 2, canonical: new ArrayBuffer(65536), fluid: new ArrayBuffer(32768) }] })`,
    },
    {
      name: 'generatorVersion',
      request: capture(7, 'collision-resync'),
      payload: `(request) => ({ status: 'available', captureId: request.payload.captureId, captureGeneration: 0, purpose: 'collision-resync', key: request.payload.key, checkpoint: { epoch: bootstrap.options.epoch, physicsTick: 0, commitSequence: 0, worldRevision: 0 }, entries: [{ role: 'collision-resync', key: request.payload.key, chunkRevision: 0, generatorVersion: 99, canonical: new ArrayBuffer(65536), fluid: new ArrayBuffer(32768) }] })`,
    },
  ])('同 envelope 身份但错误 $name 的 capture 回复会使 lane 失败并清理', async ({ request, payload }) => {
    const fixture = await createScriptedLane(`bad-${request.captureId}-${request.minimumRevision}`, payload);
    try {
      await expect(fixture.lane.captureBaseline(request)).rejects.toThrow(
        /capture|baseline|response|key|purpose|revision|checkpoint/i,
      );
      await expect(fixture.lane.whenFailed()).resolves.toBeInstanceOf(Error);
      await expect(fixture.lane.stop()).rejects.toThrow();
      expect(fixture.lane.state()).toBe('failed');
      const exited = fixture.lane.whenExited();
      void exited.catch(() => undefined);
      await fixture.close();
      await expect(exited).rejects.toThrow();
    } finally {
      await fixture.close();
    }
  });

  it('同 envelope 身份但错误 cancel captureId 会使 lane 失败并在退出后结算', async () => {
    const fixture = await createScriptedLane(
      'bad-cancel',
      `(request) => ({ captureId: request.payload.captureId + 1, captureGeneration: null, status: 'unknown' })`,
    );
    try {
      await expect(fixture.lane.cancelBaselineCapture(9)).rejects.toThrow(/cancellation.*captureId/i);
      await expect(fixture.lane.whenFailed()).resolves.toBeInstanceOf(Error);
      const exited = fixture.lane.whenExited();
      void exited.catch(() => undefined);
      await fixture.close();
      await expect(exited).rejects.toThrow();
    } finally {
      await fixture.close();
    }
  });
});
