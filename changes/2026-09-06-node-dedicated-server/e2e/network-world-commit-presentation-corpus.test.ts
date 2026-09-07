import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { WorldCommitResult } from '../../../src/server/game-server-types';
import type { DedicatedComputeExecutor } from '../../../src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../src/server/dedicated/dedicated-server-host';
import { computeFluidCandidate } from '../../../src/server/fluid/fluid-transaction';
import { MemoryGamePersistence } from '../../../src/server/persistence/memory-game-persistence';
import {
  projectWorldCommitPresentationReference,
  type WorldCommitPresentationReference,
} from '../../../src/server/protocol/network-reference-world-commit-presentation';
import { Voxel } from '../../../src/world/voxel';
import {
  readWorldCommitPresentationCorpus,
  worldCommitPresentationCorpusOutputDirectory,
  writeWorldCommitPresentationCorpus,
  type WorldCommitPresentationCorpusRecord,
} from './support/network-world-commit-presentation-corpus-recorder';

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'src/server/protocol/network-reference-world-commit-presentation.ts',
  'src/server/protocol/network-reference-integer.ts',
  'src/server/world-transaction-commit.ts',
  'src/world/voxel.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-world-commit-presentation-corpus-recorder.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-world-commit-presentation-corpus.test.ts',
] as const;
const historicalCorpusPaths = [
  '/tmp/seedlands-network-real-corpus-v1/manifest.json',
  '/tmp/seedlands-network-real-corpus-v1/frames.jsonl',
  '/tmp/seedlands-network-entity-corpus-v1/manifest.json',
  '/tmp/seedlands-network-entity-corpus-v1/frames.jsonl',
  '/tmp/seedlands-network-gameplay-consumer-corpus-v2/manifest.json',
  '/tmp/seedlands-network-gameplay-consumer-corpus-v2/frames.jsonl',
  '/tmp/seedlands-network-gameplay-density-corpus-v1/actors-32/manifest.json',
  '/tmp/seedlands-network-gameplay-density-corpus-v1/actors-128/manifest.json',
] as const;

const executor = (): DedicatedComputeExecutor => ({
  execute: (task) => runDedicatedComputeTask(task),
  close: async () => {},
  diagnostics: () => ({
    mode: 'inline',
    generation: 0,
    queued: 0,
    queuedBytes: 0,
    running: 0,
    runningBytes: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    staleResults: 0,
    childPids: [],
    workerThreadIds: [],
    poolSize: 1,
    liveSlots: 0,
    terminatingSlots: 0,
    health: 'healthy',
    restartCountLastMinute: 0,
    ipcBacklogBytes: 0,
    slotCompletedTasks: [0],
    taskIdHighWatermark: -1,
  }),
});

async function existingHashes(paths: readonly string[]) {
  const entries = await Promise.all(
    paths.map(async (path) => {
      try {
        return [path, sha256(await readFile(path))] as const;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

async function editThroughAuthority(
  host: DedicatedServerHost,
  edits: readonly Readonly<{ x: number; y: number; z: number; value: number }>[],
): Promise<WorldCommitResult> {
  const pending = host.runtime.editWorld(host.runtime.playerId, edits);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await host.waitForIdle();
  return pending;
}

function normalizeWorldCommit(commit: WorldCommitResult): object {
  return {
    committed: commit.committed,
    worldRevision: commit.worldRevision,
    structuralChange: commit.structuralChange
      ? {
          type: commit.structuralChange.type,
          actorId: commit.structuralChange.actorId,
          worldRevision: commit.structuralChange.worldRevision,
          mutationCount: commit.structuralChange.mutationCount,
          chunks: [...commit.structuralChange.chunks],
          meshChunks: [...commit.structuralChange.meshChunks],
          chunkRevisions: commit.structuralChange.chunkRevisions.map(({ key, revision }) => ({ key, revision })),
          bounds: commit.structuralChange.bounds
            ? { min: [...commit.structuralChange.bounds.min], max: [...commit.structuralChange.bounds.max] }
            : null,
        }
      : null,
    collisionDelta: (commit.collisionDelta ?? []).map((delta) => ({
      key: delta.key,
      previousRevision: delta.previousRevision,
      revision: delta.revision,
      cells: delta.cells.map((cell) => ({ ...cell })),
    })),
  };
}

function record(
  records: WorldCommitPresentationCorpusRecord[],
  scenario: WorldCommitPresentationCorpusRecord['captureProvenance']['scenario'],
  commit: WorldCommitResult,
  projected: WorldCommitPresentationReference,
) {
  records.push({
    frameId: `${String(records.length).padStart(3, '0')}-world-commit-presentation`,
    category: 'world-commit-presentation',
    direction: 'server-to-client',
    metadata: structuredClone(projected),
    binary: [],
    captureProvenance: {
      scenario,
      source: 'dedicated-host-authority-runtime',
      inputWorldCommitSha256: sha256(JSON.stringify(normalizeWorldCommit(commit))),
      projectedOutputSha256: sha256(JSON.stringify(projected)),
    },
  });
}

describe('真实 Host WorldCommit 呈现 v2 语料', () => {
  it('从生产边界普通编辑和已接纳 fluid candidate 捕获独立 v2 records', async () => {
    expect(process.version).toMatch(/^v22\./);
    const priorHashes = await existingHashes(historicalCorpusPaths);
    const now = 0;
    const host = await DedicatedServerHost.create({
      epoch: 'host:world-commit-presentation',
      seedText: 'network-world-commit-presentation-corpus',
      persistence: new MemoryGamePersistence(),
      executors: { general: executor(), fluid: executor(), logic: executor() },
      now: () => now,
    });
    try {
      const beforeOrdinary = host.runtime.snapshot();
      const ordinary = await editThroughAuthority(host, [{ x: 31, y: 33, z: 0, value: Voxel.Glowstone }]);
      expect(ordinary.committed).toBe(true);
      expect(ordinary.structuralChange?.meshChunks.length).toBeGreaterThan(
        ordinary.structuralChange?.chunks.length ?? 0,
      );
      const afterOrdinary = host.runtime.snapshot();
      expect(afterOrdinary.commitSequence).toBeGreaterThan(beforeOrdinary.commitSequence);

      const waterSetup = await editThroughAuthority(host, [{ x: 4, y: 50, z: 4, value: Voxel.Water }]);
      expect(waterSetup.committed).toBe(true);
      const afterWaterSetup = host.runtime.snapshot();
      expect(afterWaterSetup.commitSequence).toBeGreaterThan(afterOrdinary.commitSequence);
      host.runtime.setFluidActiveChunks(['0,1,0']);
      const lease = host.runtime.server.requestFluidWork();
      expect(lease).not.toBeNull();
      if (!lease) throw new Error('Expected a real fluid lease.');
      const accepted = host.runtime.commitFluidCandidate(computeFluidCandidate(lease));
      expect(accepted).toMatchObject({ accepted: true });
      expect(accepted.commit?.committed).toBe(true);
      const fluid = accepted.commit;
      if (!fluid) throw new Error('Expected accepted fluid candidate to expose its production commit.');
      expect(fluid.structuralChange?.actorId).toBe('fluid-v2');

      const snapshot = host.runtime.snapshot();
      expect(snapshot.commitSequence).toBeGreaterThan(afterWaterSetup.commitSequence);
      expect(snapshot.worldRevision).toBeGreaterThanOrEqual(ordinary.worldRevision);
      expect(snapshot.worldRevision).toBeGreaterThanOrEqual(fluid.worldRevision);
      const context = {
        epoch: snapshot.epoch,
        publicationCommitSequenceUpperBound: snapshot.commitSequence,
      };
      const ordinaryPresentation = projectWorldCommitPresentationReference(ordinary, context);
      const fluidPresentation = projectWorldCommitPresentationReference(fluid, context);
      expect(ordinaryPresentation.structuralChange?.presentationClass).toBe('default');
      expect(fluidPresentation.structuralChange?.presentationClass).toBe('fluid');
      expect(fluidPresentation.structuralChange?.bounds).not.toBeNull();
      expect(fluidPresentation.collisionDeltas).not.toHaveLength(0);

      const records: WorldCommitPresentationCorpusRecord[] = [];
      record(records, 'ordinary-boundary-edit', ordinary, ordinaryPresentation);
      record(records, 'accepted-fluid-candidate', fluid, fluidPresentation);
      const written = await writeWorldCommitPresentationCorpus({
        records,
        sourcePaths,
        config: {
          seedText: 'network-world-commit-presentation-corpus',
          ordinaryEdit: { position: [31, 33, 0], value: Voxel.Glowstone },
          fluidSetup: { position: [4, 50, 4], value: Voxel.Water, activeChunks: ['0,1,0'] },
          fluidCandidate: 'computeFluidCandidate(real-authority-lease)',
        },
      });
      const disk = await readWorldCommitPresentationCorpus();
      deepStrictEqual(disk.frames, written.frames);
      deepStrictEqual(disk.manifest, written.manifest);
      const lines = await readFile(`${worldCommitPresentationCorpusOutputDirectory}/frames.jsonl`, 'utf8');
      const { manifestPayloadSha256, corpusSha256, recordCount, ...payload } = disk.manifest;
      expect(manifestPayloadSha256).toBe(sha256(JSON.stringify(payload)));
      expect(corpusSha256).toBe(sha256(lines));
      expect(recordCount).toBe(2);
      expect(payload.records).toEqual(
        disk.frames.map(({ frameId, category, direction, contentSha256 }) => ({
          frameId,
          category,
          direction,
          contentSha256,
        })),
      );
      for (const frame of disk.frames) {
        const { contentSha256, provenance, ...body } = frame;
        const { kind, manifestPayloadSha256: frameManifestHash, ...captureProvenance } = provenance;
        expect(kind).toBe('real-host');
        expect(frameManifestHash).toBe(manifestPayloadSha256);
        expect(contentSha256).toBe(sha256(JSON.stringify({ ...body, captureProvenance })));
        expect(frame.metadata).not.toHaveProperty('actorId');
        expect(frame.provenance.inputWorldCommitSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(frame.provenance.projectedOutputSha256).toBe(sha256(JSON.stringify(frame.metadata)));
      }
      expect(written.manifest.source.explicitInputSha256).toEqual(
        Object.fromEntries(sourcePaths.map((path) => [path, expect.stringMatching(/^[a-f0-9]{64}$/)])),
      );
      expect(await existingHashes(historicalCorpusPaths)).toEqual(priorHashes);
      expect(worldCommitPresentationCorpusOutputDirectory).toBe(
        '/tmp/seedlands-network-world-commit-presentation-corpus-v2-r5',
      );
    } finally {
      await host.stop();
    }
  });
});
