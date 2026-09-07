import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type {
  DedicatedComputeExecutor,
  DedicatedComputeResult,
  DedicatedComputeTask,
} from '../../../packages/game-core/src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../packages/game-core/src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../packages/game-core/src/server/dedicated/dedicated-server-host';
import type { AuthorityBaselineCaptureResult } from '../../../packages/game-core/src/server/authority/authority-baseline-capture-types';
import { MemoryGamePersistence } from '../../../packages/game-core/src/server/persistence/memory-game-persistence';
import { createProceduralMeshInput, meshHaloIndex } from '../../../packages/game-core/src/world/mesh';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../../../packages/game-core/src/world/voxel';
import {
  networkBaselineCorpusExists,
  networkBaselineCorpusOutputDirectory,
  readNetworkBaselineCorpus,
  writeNetworkBaselineCorpus,
  type NetworkBaselineCorpusCapture,
} from './support/network-baseline-corpus-recorder';

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'src/server/authority/authority-baseline-capture.ts',
  'src/server/canonical-chunk-observation.ts',
  'src/server/dedicated/dedicated-baseline-capture.ts',
  'src/server/dedicated/dedicated-canonical-admission.ts',
  'src/server/dedicated/dedicated-chunk-requests.ts',
  'src/server/dedicated/dedicated-server-host.ts',
  'src/server/server-mesh-snapshots.ts',
  'src/world/mesh.ts',
  'src/world/voxel.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-baseline-corpus-recorder.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-baseline-corpus.test.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/vitest.baseline-corpus.config.ts',
] as const;

const executor = (): DedicatedComputeExecutor => ({
  execute: (task: DedicatedComputeTask): Promise<DedicatedComputeResult> => runDedicatedComputeTask(task),
  close: async () => {},
  diagnostics: () => ({
    mode: 'inline' as const,
    generation: 0,
    queued: 0,
    queuedBytes: 0,
    running: 0,
    runningBytes: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    staleResults: 0,
    ipcBacklogBytes: 0,
    childPids: [],
    workerThreadIds: [],
    poolSize: 1,
    liveSlots: 0,
    terminatingSlots: 0,
    health: 'healthy' as const,
    restartCountLastMinute: 0,
    slotCompletedTasks: [0],
    taskIdHighWatermark: -1,
  }),
});

type AvailableCapture = Extract<AuthorityBaselineCaptureResult, { status: 'available' }>;
type OwnedBytes = Readonly<{ canonical: Uint8Array; fluid: Uint8Array }>;

function captureOwned(entries: AvailableCapture['entries']): OwnedBytes[] {
  return entries.map((entry) => ({
    canonical: new Uint8Array(entry.canonical.slice(0)),
    fluid: new Uint8Array(entry.fluid.slice(0)),
  }));
}

function assertEntriesUnchanged(entries: AvailableCapture['entries'], expected: readonly OwnedBytes[]): void {
  expect(entries).toHaveLength(expected.length);
  entries.forEach((entry, index) => {
    deepStrictEqual(new Uint8Array(entry.canonical), expected[index].canonical);
    deepStrictEqual(new Uint8Array(entry.fluid), expected[index].fluid);
  });
}

function requireAvailable(result: AuthorityBaselineCaptureResult): AvailableCapture {
  if (result.status !== 'available') throw new Error(`Expected available capture, got ${result.reason}.`);
  return result;
}

function assertMeshCapture(result: AvailableCapture, key: string): void {
  expect(result.entries).toHaveLength(27);
  expect(result.entries.filter((entry) => entry.role === 'main')).toHaveLength(1);
  expect(result.entries.filter((entry) => entry.role === 'overlay')).toHaveLength(26);
  expect(result.entries[0]).toMatchObject({ role: 'main', key });
  expect(new Set(result.entries.map((entry) => entry.key))).toHaveProperty('size', 27);
  for (const entry of result.entries) {
    expect(entry.canonical.byteLength).toBe(CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT);
    expect(entry.fluid.byteLength).toBe(CHUNK_SIZE ** 3);
  }
}

function consumeCompleteMesh(host: DedicatedServerHost, result: AvailableCapture): void {
  const main = result.entries.find((entry) => entry.role === 'main');
  if (!main) throw new Error('Mesh capture has no main entry.');
  const [cx, cy, cz] = main.key.split(',').map(Number);
  const ownedBeforeConsume = captureOwned(result.entries);
  const overlays = result.entries
    .filter((entry) => entry.role === 'overlay')
    .map((entry) => {
      const [overlayX, overlayY, overlayZ] = entry.key.split(',').map(Number);
      return {
        cx: overlayX,
        cy: overlayY,
        cz: overlayZ,
        voxels: new Uint16Array(entry.canonical.slice(0)),
        fluid: new Uint8Array(entry.fluid.slice(0)),
      };
    });
  const output = createProceduralMeshInput({
    seed: host.runtime.server.seed,
    generatorVersion: main.generatorVersion,
    cx,
    cy,
    cz,
    canonical: new Uint16Array(main.canonical.slice(0)),
    fluid: new Uint8Array(main.fluid.slice(0)),
    overlays,
  });
  expect(output.proceduralVoxelSamples).toBe(0);
  expect(output.macroContextCount).toBe(0);
  deepStrictEqual(output.canonical, new Uint16Array(main.canonical));
  deepStrictEqual(output.fluid, new Uint8Array(main.fluid));
  assertEntriesUnchanged(result.entries, ownedBeforeConsume);
  const left = overlays.find((overlay) => overlay.cx === cx - 1 && overlay.cy === cy && overlay.cz === cz);
  if (!left) throw new Error('Mesh capture did not include the left neighbor overlay.');
  const nonAir = (() => {
    for (let y = 0; y < CHUNK_SIZE; y += 1)
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        const index = voxelIndex(CHUNK_SIZE - 1, y, z);
        if (left.voxels[index] !== Voxel.Air) return { y, z, value: left.voxels[index] };
      }
    return null;
  })();
  expect(nonAir).not.toBeNull();
  if (!nonAir) throw new Error('Expected a non-Air left-neighbor boundary voxel.');
  expect(output.halo[meshHaloIndex(-1, nonAir.y, nonAir.z)]).toBe(nonAir.value);
}

async function editMain(host: DedicatedServerHost, cx: number, cy: number, cz: number) {
  const result = host.runtime.editWorld(host.runtime.playerId, [
    { x: cx * CHUNK_SIZE + 3, y: cy * CHUNK_SIZE + 4, z: cz * CHUNK_SIZE + 5, value: Voxel.Glowstone },
  ]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await host.waitForIdle();
  return result;
}

async function assertPublishedCorpus() {
  const published = await readNetworkBaselineCorpus({ sourcePaths });
  expect(published.manifest.format).toBe('seedlands-network-baseline-corpus/v1');
  expect(published.manifest.gitSha).toMatch(/^[a-f0-9]{40}$/);
  expect(published.manifest.trackedSourceDiffSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(published.manifest.sourceFiles).toHaveLength(sourcePaths.length);
  expect(published.manifest.corpusSha256).toBe(
    sha256(await readFile(`${networkBaselineCorpusOutputDirectory}/frames.jsonl`, 'utf8')),
  );
  expect(published.frames.map((frame) => frame.entries.length)).toEqual([27, 27, 1]);
  expect(published.frames.map((frame) => frame.scenario)).toEqual([
    'unmodified-mesh',
    'edited-main-mesh',
    'collision-resync',
  ]);
  return published;
}

describe('Authority 完整基线真实语料', () => {
  it('以真实 Host capture 采集未编辑、编辑后 mesh 与 collision-resync owned blocks，并用完整块消费网格输入', async () => {
    expect(process.version).toMatch(/^v22\.23\.2$/);
    if (await networkBaselineCorpusExists()) {
      await assertPublishedCorpus();
      return;
    }
    const main = { key: '80,0,80', cx: 80, cy: 0, cz: 80 } as const;
    const host = await DedicatedServerHost.create({
      epoch: 'baseline-corpus:authority',
      seedText: 'baseline-corpus:fixed-seed',
      persistence: new MemoryGamePersistence(),
      executors: { general: executor(), fluid: executor(), logic: executor() },
      now: () => 0,
    });
    try {
      const localBefore = host.runtime.server.prepareWorkerMeshInput(main.cx, main.cy, main.cz);
      expect(localBefore.canonical).toBeUndefined();
      expect(localBefore.fluid).toBeUndefined();
      expect(localBefore.overlays).toEqual([]);

      const firstBefore = host.runtime.snapshot();
      const firstPending = host.captureBaseline({ captureId: 0, purpose: 'mesh', key: main.key, minimumRevision: 0 });
      await host.waitForIdle();
      const first = requireAvailable(await firstPending);
      assertMeshCapture(first, main.key);
      consumeCompleteMesh(host, first);
      const firstOwned = captureOwned(first.entries);
      const localAfterUnmodifiedCapture = host.runtime.server.prepareWorkerMeshInput(main.cx, main.cy, main.cz);
      expect(localAfterUnmodifiedCapture.canonical).toBeUndefined();
      expect(localAfterUnmodifiedCapture.fluid).toBeUndefined();
      expect(localAfterUnmodifiedCapture.overlays).toEqual([]);

      const edit = await editMain(host, main.cx, main.cy, main.cz);
      expect(edit.committed).toBe(true);
      const editedSnapshot = host.runtime.snapshot();
      expect(editedSnapshot.commitSequence).toBeGreaterThan(first.checkpoint.commitSequence);
      expect(editedSnapshot.worldRevision).toBeGreaterThan(first.checkpoint.worldRevision);
      assertEntriesUnchanged(first.entries, firstOwned);

      const firstMain = first.entries[0];
      const secondBefore = host.runtime.snapshot();
      const secondPending = host.captureBaseline({
        captureId: 1,
        purpose: 'mesh',
        key: main.key,
        minimumRevision: firstMain.chunkRevision + 1,
      });
      await host.waitForIdle();
      const second = requireAvailable(await secondPending);
      assertMeshCapture(second, main.key);
      expect(second.entries[0].chunkRevision).toBeGreaterThanOrEqual(firstMain.chunkRevision + 1);
      consumeCompleteMesh(host, second);

      const collisionBefore = host.runtime.snapshot();
      const collisionPending = host.captureBaseline({
        captureId: 2,
        purpose: 'collision-resync',
        key: main.key,
        minimumRevision: second.entries[0].chunkRevision,
      });
      await host.waitForIdle();
      const collision = requireAvailable(await collisionPending);
      expect(collision.entries).toHaveLength(1);
      expect(collision.entries[0]).toMatchObject({
        role: 'collision-resync',
        key: main.key,
        chunkRevision: second.entries[0].chunkRevision,
      });
      deepStrictEqual(new Uint8Array(collision.entries[0].canonical), new Uint8Array(second.entries[0].canonical));
      deepStrictEqual(new Uint8Array(collision.entries[0].fluid), new Uint8Array(second.entries[0].fluid));

      const captures: NetworkBaselineCorpusCapture[] = [
        {
          scenario: 'unmodified-mesh',
          request: { captureId: 0, purpose: 'mesh', key: main.key, minimumRevision: 0 },
          snapshotBeforeCapture: firstBefore,
          result: first,
        },
        {
          scenario: 'edited-main-mesh',
          request: { captureId: 1, purpose: 'mesh', key: main.key, minimumRevision: firstMain.chunkRevision + 1 },
          snapshotBeforeCapture: secondBefore,
          result: second,
        },
        {
          scenario: 'collision-resync',
          request: {
            captureId: 2,
            purpose: 'collision-resync',
            key: main.key,
            minimumRevision: second.entries[0].chunkRevision,
          },
          snapshotBeforeCapture: collisionBefore,
          result: collision,
        },
      ];
      const written = await writeNetworkBaselineCorpus({
        captures,
        sourcePaths,
        config: {
          seedText: 'baseline-corpus:fixed-seed',
          mainKey: main.key,
          edit: {
            x: main.cx * CHUNK_SIZE + 3,
            y: main.cy * CHUNK_SIZE + 4,
            z: main.cz * CHUNK_SIZE + 5,
            value: Voxel.Glowstone,
          },
          executor: 'runDedicatedComputeTask',
        },
      });
      const published = await assertPublishedCorpus();
      expect(published.manifest).toEqual(written.manifest);
      expect(published.frames).toEqual(written.frames);
      expect(networkBaselineCorpusOutputDirectory).toBe('/tmp/seedlands-network-baseline-corpus-v1-r2');
    } finally {
      await host.stop();
    }
  }, 30_000);
});
