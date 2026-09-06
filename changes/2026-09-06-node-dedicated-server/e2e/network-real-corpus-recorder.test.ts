import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  DedicatedComputeExecutor,
  DedicatedComputeResult,
  DedicatedComputeTask,
} from '../../../src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../../src/server/persistence/memory-game-persistence';
import { projectActionReceiptReference } from '../../../src/server/protocol/network-action-reference';
import { CHUNK_SIZE, Voxel } from '../../../src/world/voxel';
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
    expect(actionReceipt).toMatchObject({
      status: 'executed',
      action,
      outcome: { success: true },
      durableCommitSequence: null,
    });
    host.runtime.commitHostActivation();
    const snapshot = host.wake((now = 100));
    const frozen = host.runtime.server.freezeSaveSnapshot(ready.snapshot.commitSequence);
    const corpus = await captureNetworkRealCorpusReference({
      ready,
      bootstrapContext: {
        worldId: 'reference-world',
        serverEpoch: 'server:reference-process',
        sessionId: 'session:reference-client',
        contentVersion: 'content-reference-v1',
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
        durableCommitSequence: host.diagnostics().durableCommitSequence,
      },
      snapshot,
      gameplay: host.runtime.view(),
      commits: [commit],
      baselines: [baseline],
      actionReceipt,
      baselineDigest: {
        algorithm: 'sha-256',
        digest: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
      },
    });
    const captured = corpus.frames.filter((frame) => frame.status === 'CAPTURED');
    expect(captured.map((frame) => frame.category)).toEqual([
      'welcome',
      'player-correction',
      'gameplay-view',
      'world-commit',
      'chunk-baseline',
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
    await host.stop();
  });
});
