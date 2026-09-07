import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  DedicatedComputeExecutor,
  DedicatedComputeResult,
  DedicatedComputeTask,
} from '../../../packages/game-core/src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../packages/game-core/src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../packages/game-core/src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../../packages/game-core/src/server/persistence/memory-game-persistence';
import type { ReferenceBootstrapContext } from '../../../packages/game-core/src/server/protocol/network-reference-bootstrap-types';
import {
  captureBootstrapWelcomeReference,
  type CapturedBootstrapWelcomeReference,
} from './support/network-bootstrap-welcome-recorder';

const OUTPUT_DIRECTORY = '/tmp/seedlands-network-bootstrap-welcome-corpus-v2-source-bound';
const SOURCE_PATHS = [
  'src/server/protocol/network-reference-bootstrap-presentation.ts',
  'src/server/protocol/network-reference-bootstrap.ts',
  'src/server/protocol/network-reference-bootstrap-types.ts',
  'src/server/protocol/network-reference-integer.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-bootstrap-welcome-recorder.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-bootstrap-welcome-corpus.test.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/vitest.bootstrap-welcome-corpus.config.ts',
] as const;

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

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
    childPids: [],
    workerThreadIds: [],
    poolSize: 1,
    liveSlots: 0,
    terminatingSlots: 0,
    health: 'healthy' as const,
    restartCountLastMinute: 0,
    ipcBacklogBytes: 0,
    slotCompletedTasks: [0],
    taskIdHighWatermark: -1,
  }),
});

const hostConfig = {
  seedText: 'network-bootstrap-welcome-v2',
  initialWorldTime: 21,
  frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
} as const;

const bootstrapContext = (
  host: DedicatedServerHost,
  durableCommitSequence: number,
  sessionId: string,
): ReferenceBootstrapContext => {
  const frozen = host.runtime.server.freezeSaveSnapshot(host.runtime.snapshot().commitSequence);
  return {
    worldId: 'world:bootstrap-welcome-v2',
    serverEpoch: 'server:bootstrap-welcome-v2',
    sessionId,
    contentVersion: 'content:bootstrap-welcome-v2',
    physicsSchema: frozen.physicsSchema,
    fluidSchema: frozen.fluidSchema,
    publicCapabilities: [],
    limits: {
      metadataBytesMax: 64 * 1024,
      reliableMessageBytesMax: 1024 * 1024,
      baselineTransferBytesMax: 1024 * 1024,
      baselineInFlightBytesMax: 16 * 1024 * 1024,
      inboundMessagesPerSecond: 120,
      inboundBurst: 240,
      actionMessagesPerSecond: 20,
      interestKeysMax: 256,
      canonicalResidencyMax: 2048,
      sendQueueBytesMax: 4 * 1024 * 1024,
    },
    durableCommitSequence,
  };
};

type DiskRecord = Readonly<{
  frameId: string;
  category: 'welcome-presentation';
  label: CapturedBootstrapWelcomeReference['label'];
  provenance: CapturedBootstrapWelcomeReference['provenance'];
  input: CapturedBootstrapWelcomeReference['input'];
  inputSha256: string;
  metadata: CapturedBootstrapWelcomeReference['metadata'];
  metadataSha256: string;
  contentSha256: string;
}>;

const writeCorpus = async (captures: readonly CapturedBootstrapWelcomeReference[]) => {
  const staging = `${OUTPUT_DIRECTORY}.staging-${process.pid}`;
  const publishClaim = `${OUTPUT_DIRECTORY}.publish-claim`;
  await mkdir(publishClaim);
  try {
    try {
      await lstat(OUTPUT_DIRECTORY);
      throw new Error(`Refusing to overwrite existing corpus: ${OUTPUT_DIRECTORY}`);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const sourceFiles = await Promise.all(
      SOURCE_PATHS.map(async (path) => ({ path, sha256: sha256(await readFile(path)) })),
    );
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const trackedSourceDiffSha256 = sha256(
      execFileSync('git', ['diff', '--binary', 'HEAD'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    );
    const records: DiskRecord[] = captures.map((capture, index) => {
      const inputSha256 = sha256(JSON.stringify(capture.input));
      const metadataSha256 = sha256(JSON.stringify(capture.metadata));
      const core = {
        frameId: `${String(index).padStart(3, '0')}-${capture.label}`,
        category: 'welcome-presentation' as const,
        label: capture.label,
        provenance: capture.provenance,
        input: capture.input,
        inputSha256,
        metadata: capture.metadata,
        metadataSha256,
      };
      return { ...core, contentSha256: sha256(JSON.stringify(core)) };
    });
    const manifestPayload = {
      format: 'seedlands-network-bootstrap-welcome-corpus/v2',
      generatedBy: 'changes/2026-09-06-node-dedicated-server/e2e/network-bootstrap-welcome-corpus.test.ts',
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      config: hostConfig,
      gitSha,
      trackedSourceDiffSha256,
      sourceFiles,
      records,
      notCollected: [
        'authenticated session adapter',
        'first-attach versus reconnect disposition',
        'one-time camp orientation application',
        'codec, wire, browser camera, and network transport',
      ],
    };
    const manifestPayloadSha256 = sha256(JSON.stringify(manifestPayload));
    const lines = records.map((record) => ({
      ...record,
      provenance: { ...record.provenance, manifest: 'manifest.json', manifestPayloadSha256 },
    }));
    const frames = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
    const manifest = {
      ...manifestPayload,
      manifestPayloadSha256,
      corpusSha256: sha256(frames),
    };
    await writeFile(join(staging, 'frames.jsonl'), frames);
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(staging, OUTPUT_DIRECTORY);
    return { manifest, records, lines };
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(publishClaim, { recursive: true, force: true });
  }
};

describe('bootstrap Welcome v2 真实语料', () => {
  it('采集新建、同 epoch 当前 body 和持久化恢复三条独立来源记录', async () => {
    expect(process.version).toMatch(/^v22\./);
    const persistence = new MemoryGamePersistence();
    let now = 0;
    const compute = executor();
    const first = await DedicatedServerHost.create({
      epoch: 'epoch:bootstrap-welcome:first',
      ...hostConfig,
      persistence,
      executors: { general: compute, fluid: compute, logic: compute },
      now: () => now,
    });
    try {
      const initialReady = first.runtime.ready();
      const initialSnapshot = first.runtime.snapshot();
      expect(initialReady.isNew).toBe(true);
      expect(initialReady.campPosition).toBeDefined();
      const initial = captureBootstrapWelcomeReference({
        label: 'new-world-authority-start',
        ready: initialReady,
        currentSnapshot: initialSnapshot,
        context: bootstrapContext(first, first.diagnostics().durableCommitSequence, 'session:first'),
      });

      const target: [number, number, number] = [
        initialReady.playerBodyPosition[0] + 2,
        initialReady.playerBodyPosition[1] + 1,
        initialReady.playerBodyPosition[2] + 3,
      ];
      first.runtime.setPlayerPosition(target);
      const movedSnapshot = first.runtime.snapshot();
      expect([
        movedSnapshot.player.body.position.x,
        movedSnapshot.player.body.position.y,
        movedSnapshot.player.body.position.z,
      ]).toEqual(target);
      expect(target).not.toEqual(initialReady.playerBodyPosition);
      const moved = captureBootstrapWelcomeReference({
        label: 'same-epoch-current-body',
        ready: initialReady,
        currentSnapshot: movedSnapshot,
        context: bootstrapContext(first, first.diagnostics().durableCommitSequence, 'session:first'),
      });
      expect(moved.metadata.playerBody.position).toEqual(movedSnapshot.player.body.position);
      expect(moved.metadata.playerBody.position).not.toEqual({
        x: initialReady.playerBodyPosition[0],
        y: initialReady.playerBodyPosition[1],
        z: initialReady.playerBodyPosition[2],
      });

      await first.stop();
      const restoredCompute = executor();
      now = 0;
      const restored = await DedicatedServerHost.create({
        epoch: 'epoch:bootstrap-welcome:restored',
        ...hostConfig,
        persistence,
        executors: { general: restoredCompute, fluid: restoredCompute, logic: restoredCompute },
        now: () => now,
      });
      try {
        const restoredReady = restored.runtime.ready();
        const restoredSnapshot = restored.runtime.snapshot();
        expect(restoredReady.isNew).toBe(false);
        expect(restoredSnapshot.player.body.position).toEqual({ x: target[0], y: target[1], z: target[2] });
        const restoredCapture = captureBootstrapWelcomeReference({
          label: 'restored-authority-start',
          ready: restoredReady,
          currentSnapshot: restoredSnapshot,
          context: bootstrapContext(restored, restored.diagnostics().durableCommitSequence, 'session:restored'),
        });
        expect(restoredCapture.metadata.authorityStartPresentation.authorityStartPlayerWasCreated).toBe(false);

        const captures = [initial, moved, restoredCapture];
        expect(captures.every((capture) => capture.provenance.attachDisposition === 'NOT_COLLECTED')).toBe(true);
        const written = await writeCorpus(captures);
        const diskLines = (await readFile(join(OUTPUT_DIRECTORY, 'frames.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as DiskRecord);
        expect(diskLines).toEqual(written.lines);
        expect(written.records).toHaveLength(3);
        for (const record of written.records) {
          expect(record.inputSha256).toBe(sha256(JSON.stringify(record.input)));
          expect(record.metadataSha256).toBe(sha256(JSON.stringify(record.metadata)));
          expect(record.metadata.initialCheckpoint).toMatchObject(record.input.currentSnapshot.checkpoint);
        }
        expect(written.manifest).toMatchObject({
          format: 'seedlands-network-bootstrap-welcome-corpus/v2',
          records: [
            { label: 'new-world-authority-start' },
            { label: 'same-epoch-current-body' },
            { label: 'restored-authority-start' },
          ],
        });
        await expect(writeCorpus(captures)).rejects.toThrow(/refusing to overwrite/i);
      } finally {
        await restored.stop();
      }
    } finally {
      if (first.state !== 'stopped') await first.stop();
    }
  });
});
