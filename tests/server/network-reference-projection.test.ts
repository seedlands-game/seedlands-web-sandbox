import { testCorePlatform } from '../support/core-platform';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  DedicatedComputeExecutor,
  DedicatedComputeResult,
  DedicatedComputeTask,
} from '../../packages/game-core/src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../packages/game-core/src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../packages/game-core/src/server/dedicated/dedicated-server-host';
import {
  projectGameplayViewReference,
  projectPlayerCorrectionReference,
  projectWorldCommitReference,
} from '../../packages/game-core/src/server/protocol/network-reference-projection';
import {
  projectChunkBaselineReference,
  projectWelcomeReference,
} from '../../packages/game-core/src/server/protocol/network-reference-bootstrap';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { PROTOCOL_VERSION } from '../../packages/game-core/src/runtime/session-protocol';
import { CHUNK_SIZE, Voxel } from '../../packages/game-core/src/world/voxel';

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

const createHost = async () => {
  let now = 0;
  const compute = executor();
  const host = await DedicatedServerHost.create({
    platform: testCorePlatform,
    epoch: 'host:reference-corpus',
    seedText: 'network-reference-fixture',
    initialPlayerBodyPosition: [0.5, 33, 0.5],
    persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
    executors: { general: compute, fluid: compute, logic: compute },
    now: () => now,
  });
  await host.waitForIdle();
  return { host, tick: (next: number) => host.wake((now = next)) };
};

const referenceLimits = {
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
} as const;

const sha256 = {
  algorithm: 'sha-256' as const,
  digest: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
};

describe('network reference projection', () => {
  it('从真实 DedicatedServerHost snapshot 保留 string epoch 与初始 -1 ack，并排除 diagnostics', async () => {
    const { host } = await createHost();
    const reference = projectPlayerCorrectionReference(host.snapshot);
    expect(reference.epoch).toBe('host:reference-corpus');
    expect(reference.acknowledgedInputSequence).toBe(-1);
    expect(reference.worldTime).toBe(host.snapshot.worldTime);
    expect(reference.player.grounded).toBeTypeOf('boolean');
    expect(reference.collisionRevisions).toEqual(
      [...reference.collisionRevisions].sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(reference).not.toHaveProperty('diagnostics');
    expect(reference).not.toHaveProperty('worldMutationCount');
    reference.player.position.x = 999;
    expect(host.snapshot.player.body.position.x).not.toBe(999);
    await host.stop();
  });

  it('拒绝从真实 snapshot 派生出的非有限 body，而不是返回部分 DTO', async () => {
    const { host } = await createHost();
    const invalid = {
      ...host.snapshot,
      player: {
        ...host.snapshot.player,
        body: { ...host.snapshot.player.body, position: { ...host.snapshot.player.body.position, x: Number.NaN } },
      },
    };
    expect(() => projectPlayerCorrectionReference(invalid)).toThrow('snapshot.player.body.position.x must be finite.');
    await host.stop();
  });

  it('从真实 Host input 推进至已确认 correction，保留 signed ack 而非无符号替代', async () => {
    const { host, tick } = await createHost();
    const targetPhysicsTick = host.snapshot.physicsTick + 1;
    expect(
      host.receiveInput({
        kind: 'input',
        protocolVersion: PROTOCOL_VERSION,
        epoch: 'host:reference-corpus',
        stream: 'player-input',
        sequence: 0,
        targetPhysicsTick,
        issuedAtMs: 1,
        state: { moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: false },
        edges: { jumpPressed: false },
      }),
    ).toBe('accepted');
    const reference = projectPlayerCorrectionReference(tick(100));
    expect(reference.acknowledgedInputSequence).toBe(0);
    await host.stop();
  });

  it('只投影真实 gameplay view 的 UI/player 与实体表现白名单，不泄漏 metrics、actors 或 player entity', async () => {
    const { host } = await createHost();
    const snapshot = host.snapshot;
    const reference = projectGameplayViewReference(host.runtime.view(), {
      epoch: snapshot.epoch,
      snapshotPhysicsTick: snapshot.physicsTick,
      snapshotCommitSequence: snapshot.commitSequence,
      snapshotWorldRevision: snapshot.worldRevision,
    });
    expect(reference.epoch).toBe(snapshot.epoch);
    expect(reference.snapshotCommitSequence).toBe(snapshot.commitSequence);
    expect(reference.player.inventory).toHaveLength(24);
    expect(reference.entities).not.toContainEqual(expect.objectContaining({ type: 'player' }));
    expect(reference).not.toHaveProperty('metrics');
    expect(reference).not.toHaveProperty('actors');
    await host.stop();
  });

  it('通过真实 World.edit 路径投影 commit，并显式保留 publication 上界不是精确因果序号', async () => {
    const { host, tick } = await createHost();
    const result = host.runtime.server.edit(0, 33, 0, Voxel.Dirt, host.runtime.playerId);
    expect(result.committed).toBe(true);
    host.runtime.commitHostActivation();
    const snapshot = tick(100);
    const reference = projectWorldCommitReference(result, {
      epoch: snapshot.epoch,
      publicationCommitSequenceUpperBound: snapshot.commitSequence,
    });
    expect(reference.publicationCommitSequenceUpperBound).toBe(snapshot.commitSequence);
    expect(reference.causalCommitSequence).toBeNull();
    expect(reference.worldRevision).toBe(result.worldRevision);
    expect(reference).not.toHaveProperty('metrics');
    expect(reference).not.toHaveProperty('semanticEvents');
    await host.stop();
  });

  it('从真实 ready 与显式配置 context 投影 welcome，并且 reference 不声称 wire 或能力已采用', async () => {
    const { host } = await createHost();
    const ready = host.runtime.ready();
    const frozen = host.runtime.server.freezeSaveSnapshot(ready.snapshot.commitSequence);
    const context = {
      worldId: 'reference-world',
      serverEpoch: 'server:reference-process',
      sessionId: 'session:reference-client',
      contentVersion: 'content-reference-v1',
      physicsSchema: frozen.physicsSchema,
      fluidSchema: frozen.fluidSchema,
      publicCapabilities: [],
      limits: referenceLimits,
      durableCommitSequence: host.diagnostics().durableCommitSequence,
    } as const;
    const welcome = projectWelcomeReference(ready, context);
    expect(welcome.seedText).toBe('network-reference-fixture');
    expect(welcome.generatorVersion).toBe(ready.generatorVersion);
    expect(welcome.frequencies).toEqual(ready.frequencies);
    expect(welcome.initialCheckpoint).toEqual({
      commitSequence: ready.snapshot.commitSequence,
      worldRevision: ready.snapshot.worldRevision,
      durableCommitSequence: host.diagnostics().durableCommitSequence,
    });
    expect(welcome.publicCapabilities).toEqual([]);
    expect(welcome.wireStatus).toBe('not-adopted');
    expect(welcome).not.toHaveProperty('diagnostics');
    expect(() => projectWelcomeReference({ ...ready, playerId: 'another-player' }, context)).toThrow(/playerId/);
    expect(() =>
      projectWelcomeReference(ready, {
        ...context,
        durableCommitSequence: welcome.initialCheckpoint.commitSequence + 1,
      }),
    ).toThrow(/durableCommitSequence/);
    expect(() =>
      projectWelcomeReference({ ...ready, frequencies: { ...ready.frequencies, physicsHz: 61 as never } }, context),
    ).toThrow(/physicsHz/);
    await host.stop();
  });

  it('从真实 Dedicated compute 生成的 Chunk baseline 投影完整 canonical/fluid、副本、长度、revision 与注入 SHA-256', async () => {
    const { host } = await createHost();
    const generated = await runDedicatedComputeTask({
      kind: 'generate-canonical',
      taskId: 17,
      epoch: host.snapshot.epoch,
      generation: 0,
      estimatedBytes: CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT,
      seed: host.runtime.server.seed,
      generatorVersion: host.runtime.server.generatorVersion,
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
    if (baseline.status !== 'available') throw new Error('Expected generated collision baseline.');
    const reference = await projectChunkBaselineReference(baseline, {
      epoch: host.snapshot.epoch,
      worldId: 'reference-world',
      generatorVersion: host.runtime.server.generatorVersion,
      digest: sha256,
    });
    expect(reference.canonical.byteLength).toBe(CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT);
    expect(reference.canonical.elementCount).toBe(CHUNK_SIZE ** 3);
    expect(reference.fluid.byteLength).toBe(CHUNK_SIZE ** 3);
    expect(reference.chunkRevision).toBe(baseline.chunkRevision);
    expect(reference.canonical.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reference.fluid.sha256).toMatch(/^[a-f0-9]{64}$/);
    const original = new Uint8Array(baseline.canonical)[0];
    new Uint8Array(reference.canonical.bytes)[0] ^= 0xff;
    expect(new Uint8Array(baseline.canonical)[0]).toBe(original);
    await host.stop();
  });
});
