import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
import { projectActionReceiptReference } from '../../../packages/game-core/src/server/protocol/network-action-reference';
import { PROTOCOL_VERSION } from '../../../packages/game-core/src/runtime/session-protocol';
import { CHUNK_SIZE, Voxel } from '../../../packages/game-core/src/world/voxel';
import { captureNetworkRealCorpusReference } from './support/network-real-corpus-recorder';

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

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

const canonicalLittleEndian = (source: ArrayBuffer) => {
  const values = new Uint16Array(source);
  const output = new Uint8Array(values.length * Uint16Array.BYTES_PER_ELEMENT);
  const view = new DataView(output.buffer);
  values.forEach((value, index) => view.setUint16(index * Uint16Array.BYTES_PER_ELEMENT, value, true));
  return output;
};

type FixtureBinaryRecord = {
  name: 'canonical' | 'fluid';
  path: string;
  byteLength: number;
  sha256: string;
  elementType: 'uint16-le' | 'uint8';
  byteOrder?: 'little-endian' | 'not-applicable';
};
type FixtureRecord = {
  frameId: string;
  category: string;
  metadata: Record<string, unknown>;
  binary: FixtureBinaryRecord[];
};
type FixtureRecordWithHashes = FixtureRecord & { metadataSha256: string; contentSha256: string };

async function writeFixture(
  frames: readonly {
    status: string;
    category: string;
    payloadUtf8?: Uint8Array;
    binaryBlocks?: readonly { name: 'canonical' | 'fluid'; sha256: string; bytes: ArrayBuffer }[];
  }[],
  config: Readonly<Record<string, unknown>>,
): Promise<{ outputDir: string; manifest: Record<string, unknown> }> {
  const outputDir = '/tmp/seedlands-network-real-corpus-v1';
  const staging = `${outputDir}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(join(staging, 'blocks'), { recursive: true });
  const records: FixtureRecord[] = [];
  for (const [index, frame] of frames.entries()) {
    if (frame.status !== 'CAPTURED' || !frame.payloadUtf8) continue;
    const frameId = `${String(index).padStart(3, '0')}-${frame.category}`;
    const metadata = JSON.parse(new TextDecoder().decode(frame.payloadUtf8)) as Record<string, unknown>;
    const binary: FixtureBinaryRecord[] = [];
    for (const block of frame.binaryBlocks ?? []) {
      const bytes =
        block.name === 'canonical' ? canonicalLittleEndian(block.bytes) : new Uint8Array(block.bytes.slice(0));
      const filename = `${frameId}-${block.name}.bin`;
      await writeFile(join(staging, 'blocks', filename), bytes);
      const sidecarSha256 = sha256(bytes);
      const descriptor = metadata[block.name] as Record<string, unknown> | undefined;
      if (!descriptor) throw new Error(`Missing ${block.name} metadata descriptor.`);
      metadata[block.name] = {
        ...descriptor,
        byteLength: bytes.byteLength,
        sha256: sidecarSha256,
        ...(block.name === 'canonical'
          ? { elementType: 'uint16-le', byteOrder: 'little-endian' }
          : { elementType: 'uint8', byteOrder: 'not-applicable' }),
      };
      binary.push({
        name: block.name,
        path: `blocks/${filename}`,
        byteLength: bytes.byteLength,
        sha256: sidecarSha256,
        ...(block.name === 'canonical'
          ? { elementType: 'uint16-le' as const, byteOrder: 'little-endian' as const }
          : { elementType: 'uint8' as const, byteOrder: 'not-applicable' as const }),
      });
    }
    records.push({ frameId, category: frame.category, metadata, binary });
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const trackedWorktreeDiff = execFileSync('git', ['diff', '--binary', 'HEAD'], { encoding: 'utf8' });
  const untrackedRelevantFiles = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', 'src', 'tests', 'changes/2026-09-06-node-dedicated-server'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  const untrackedRelevantSource = await Promise.all(
    untrackedRelevantFiles.map(async (path) => ({ path, sha256: sha256(await readFile(path)) })),
  );
  const sourceState = {
    commit: sourceCommit,
    commitAlgorithm: 'git-sha1' as const,
    trackedWorktreeDiffSha256: sha256(trackedWorktreeDiff),
    untrackedRelevantSource,
  };
  const provenance = {
    sourceState,
    configSha256: sha256(JSON.stringify(config)),
  };
  const manifestPayload = {
    format: 'seedlands-network-real-corpus-fixture/v1',
    generatedBy: 'changes/2026-09-06-node-dedicated-server/e2e/network-real-corpus-recorder.test.ts',
    provenance,
    records: [] as FixtureRecordWithHashes[],
  };
  const recordsWithHashes = records.map((record) => {
    const metadataSha256 = sha256(JSON.stringify(record.metadata));
    return {
      ...record,
      metadataSha256,
      contentSha256: sha256(JSON.stringify({ ...record, metadataSha256 })),
    };
  });
  manifestPayload.records = recordsWithHashes;
  const manifestPayloadSha256 = sha256(JSON.stringify(manifestPayload));
  const recordsWithProvenance = recordsWithHashes.map((record) => ({
    ...record,
    provenance: { manifest: 'manifest.json', manifestPayloadSha256 },
  }));
  const jsonl = `${recordsWithProvenance.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await writeFile(join(staging, 'frames.jsonl'), jsonl);
  const manifest = {
    ...manifestPayload,
    manifestPayloadSha256,
    corpusSha256: sha256(
      jsonl + recordsWithProvenance.flatMap((record) => record.binary.map((block) => block.sha256)).join('\n'),
    ),
    notCollected: [
      'entity-archetype coverage beyond fixture-visible entities',
      'typed action receipts other than select-hotbar success and invalid-slot failure',
      'baseline transfer paging/cancellation/compression and resync reason',
      'wire-level frame mutations for C0/C1/C2/MP',
    ],
  };
  await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(outputDir, { recursive: true, force: true });
  await rename(staging, outputDir);
  return { outputDir, manifest };
}

describe('network real corpus recorder', () => {
  it('从受控真实 Host ready、World.edit 和 Dedicated compute baseline 采集投影及完整二进制块', async () => {
    let now = 0;
    const compute = executor();
    const host = await DedicatedServerHost.create({
      epoch: 'host:real-corpus',
      seedText: 'network-real-corpus-fixture',
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      persistence: new MemoryGamePersistence(),
      executors: { general: compute, fluid: compute, logic: compute },
      now: () => now,
    });
    const ready = host.runtime.ready();
    const generated = await runDedicatedComputeTask({
      kind: 'generate-canonical',
      taskId: 21,
      epoch: ready.snapshot.epoch,
      generation: 0,
      estimatedBytes: CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT,
      seed: host.runtime.server.seed,
      generatorVersion: ready.generatorVersion,
      key: '0,1,0',
      cx: 0,
      cy: 1,
      cz: 0,
    });
    expect(generated.kind).toBe('canonical-result');
    if (generated.kind !== 'canonical-result') throw new Error('Expected generated canonical Chunk.');
    expect(host.runtime.acceptGeneratedChunk({ ...generated, canonical: new Uint16Array(generated.voxels) })).toBe(
      true,
    );
    const baseline = host.runtime.readCollisionBaseline('0,1,0', 0);
    expect(baseline.status).toBe('available');
    if (baseline.status !== 'available') throw new Error('Expected actual collision baseline.');

    const frozen = host.runtime.server.freezeSaveSnapshot(ready.snapshot.commitSequence);
    const bootstrapContext = {
      worldId: 'reference-world',
      serverEpoch: 'server:reference-process',
      sessionId: 'session:reference-client',
      contentVersion: 'content-reference-v1',
      physicsSchema: frozen.physicsSchema,
      fluidSchema: frozen.fluidSchema,
      publicCapabilities: [] as const,
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
      durableCommitSequence: host.diagnostics().durableCommitSequence,
    };
    const digest = {
      algorithm: 'sha-256' as const,
      digest: async (bytes: Uint8Array) => sha256(bytes),
    };
    const initialCorpus = await captureNetworkRealCorpusReference({
      ready,
      bootstrapContext,
      snapshot: ready.snapshot,
      gameplay: ready.gameplay,
      commits: [],
      baselines: [baseline],
      baselineDigest: digest,
    });

    const commit = host.runtime.server.edit(0, 33, 0, Voxel.Dirt, host.runtime.playerId);
    expect(commit.committed).toBe(true);
    const action = { type: 'select-hotbar', slot: 0 } as const;
    const receipt = await host.performAction(action, 41);
    const actionReceipt = projectActionReceiptReference(action, receipt, {
      epoch: ready.snapshot.epoch,
      issuer: host.runtime.playerId,
      stream: 'player-actions',
      sequence: 41,
    });
    const failedAction = { type: 'select-hotbar', slot: 99 } as const;
    const failedReceipt = await host.performAction(failedAction, 42);
    const failedActionReceipt = projectActionReceiptReference(failedAction, failedReceipt, {
      epoch: ready.snapshot.epoch,
      issuer: host.runtime.playerId,
      stream: 'player-actions',
      sequence: 42,
    });
    expect(actionReceipt).toMatchObject({
      status: 'executed',
      action,
      outcome: { success: true },
      durableCommitSequence: null,
    });
    expect(failedActionReceipt).toMatchObject({
      status: 'executed',
      outcome: { success: false, reason: 'invalid-slot' },
    });
    expect(
      host.receiveInput({
        kind: 'input',
        protocolVersion: PROTOCOL_VERSION,
        epoch: ready.snapshot.epoch,
        stream: 'player-input',
        sequence: 0,
        targetPhysicsTick: host.snapshot.physicsTick + 1,
        issuedAtMs: 1,
        state: { moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: false },
        edges: { jumpPressed: false },
      }),
    ).toBe('accepted');
    host.runtime.commitHostActivation();
    const snapshot = host.wake((now = 100));
    const corpus = await captureNetworkRealCorpusReference({
      ready,
      bootstrapContext,
      snapshot,
      gameplay: host.runtime.view(),
      commits: [commit],
      baselines: [baseline],
      actionReceipts: [actionReceipt, failedActionReceipt],
      baselineDigest: digest,
    });
    const captured = corpus.frames.filter((frame) => frame.status === 'CAPTURED');
    expect(captured.map((frame) => frame.category)).toEqual([
      'welcome',
      'player-correction',
      'gameplay-view',
      'world-commit',
      'chunk-baseline',
      'action-receipt',
      'action-receipt',
    ]);
    for (const frame of captured) {
      const metadata = JSON.parse(new TextDecoder().decode(frame.payloadUtf8)) as Record<string, unknown>;
      expect(metadata).not.toHaveProperty('metrics');
      expect(metadata).not.toHaveProperty('diagnostics');
      expect(metadata).not.toHaveProperty('actors');
      if (frame.category !== 'chunk-baseline') {
        expect(metadata).toEqual(frame.payload);
        expect(frame.binaryBlocks).toEqual([]);
        continue;
      }
      expect(frame.binaryBlocks.map((block) => block.name)).toEqual(['canonical', 'fluid']);
      for (const block of frame.binaryBlocks) {
        expect(createHash('sha256').update(new Uint8Array(block.bytes)).digest('hex')).toBe(block.sha256);
      }
      expect(metadata).toMatchObject({
        canonical: { byteLength: CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT },
        fluid: { byteLength: CHUNK_SIZE ** 3 },
      });
    }
    expect(corpus.frames.filter((frame) => frame.status === 'NOT_COLLECTED')).toEqual([]);
    const fixtureFrames = [
      ...initialCorpus.frames.filter((frame) => frame.status === 'CAPTURED'),
      ...corpus.frames.filter(
        (frame) => frame.status === 'CAPTURED' && frame.category !== 'welcome' && frame.category !== 'chunk-baseline',
      ),
    ];
    expect(fixtureFrames.map((frame) => frame.category)).toEqual([
      'welcome',
      'player-correction',
      'gameplay-view',
      'chunk-baseline',
      'player-correction',
      'gameplay-view',
      'world-commit',
      'action-receipt',
      'action-receipt',
    ]);
    const fixtureConfig = {
      seedText: 'network-real-corpus-fixture',
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      input: { sequence: 0, moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: false, jumpPressed: false },
      actions: [action, failedAction],
    };
    const fixture = await writeFixture(fixtureFrames, fixtureConfig);
    expect(fixture.manifest).toMatchObject({
      provenance: {
        sourceState: { commit: expect.stringMatching(/^[a-f0-9]{40}$/), commitAlgorithm: 'git-sha1' },
        configSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      manifestPayloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      records: expect.any(Array),
    });
    expect(fixture.outputDir).toBe('/tmp/seedlands-network-real-corpus-v1');
    const firstManifest = await readFile(join(fixture.outputDir, 'manifest.json'), 'utf8');
    const firstFrames = await readFile(join(fixture.outputDir, 'frames.jsonl'), 'utf8');
    const firstCanonical = await readFile(join(fixture.outputDir, 'blocks/003-chunk-baseline-canonical.bin'));
    const firstFluid = await readFile(join(fixture.outputDir, 'blocks/003-chunk-baseline-fluid.bin'));
    const parsedFrames = firstFrames
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsedFrames).toHaveLength(9);
    expect(parsedFrames.map((record) => record.category)).toEqual(fixtureFrames.map((frame) => frame.category));
    for (const record of parsedFrames as {
      frameId: string;
      category: string;
      metadata: Record<string, unknown>;
      binary: FixtureBinaryRecord[];
      metadataSha256: string;
      contentSha256: string;
    }[]) {
      expect(record.metadataSha256).toBe(sha256(JSON.stringify(record.metadata)));
      expect(record.contentSha256).toBe(
        sha256(
          JSON.stringify({
            frameId: record.frameId,
            category: record.category,
            metadata: record.metadata,
            binary: record.binary,
            metadataSha256: record.metadataSha256,
          }),
        ),
      );
    }
    const baselineRecord = parsedFrames[3] as {
      metadata: Record<string, unknown>;
      binary: { sha256: string }[];
      provenance: Record<string, unknown>;
    };
    expect(baselineRecord.metadata).toMatchObject({
      canonical: { elementType: 'uint16-le', byteOrder: 'little-endian', sha256: sha256(firstCanonical) },
      fluid: { elementType: 'uint8', byteOrder: 'not-applicable', sha256: sha256(firstFluid) },
    });
    expect(baselineRecord.binary.map((block) => block.sha256)).toEqual([sha256(firstCanonical), sha256(firstFluid)]);
    expect(baselineRecord.provenance).toEqual({
      manifest: 'manifest.json',
      manifestPayloadSha256: (fixture.manifest as { manifestPayloadSha256: string }).manifestPayloadSha256,
    });
    await writeFixture(fixtureFrames, fixtureConfig);
    expect(await readFile(join(fixture.outputDir, 'manifest.json'), 'utf8')).toBe(firstManifest);
    expect(await readFile(join(fixture.outputDir, 'frames.jsonl'), 'utf8')).toBe(firstFrames);
    expect(await readFile(join(fixture.outputDir, 'blocks/003-chunk-baseline-canonical.bin'))).toEqual(firstCanonical);
    expect(await readFile(join(fixture.outputDir, 'blocks/003-chunk-baseline-fluid.bin'))).toEqual(firstFluid);
    await host.stop();
  });
});
