import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../../../tests/support/core-platform';
import { AuthorityRuntime } from '../../../packages/game-core/src/server/authority/authority-runtime';
import { MemoryGamePersistence } from '../../../packages/game-core/src/server/persistence/memory-game-persistence';
import { runDedicatedComputeTask } from '../../../packages/game-core/src/server/compute/run-dedicated-compute-task';
import { projectChunkBaselineReference } from '../../../packages/game-core/src/server/protocol/network-reference-bootstrap';
import {
  projectPlayerCorrectionReference,
  projectWorldCommitReference,
} from '../../../packages/game-core/src/server/protocol/network-reference-projection';
import { CHUNK_SIZE, Voxel } from '../../../packages/game-core/src/world/voxel';
import { NetworkReferenceReceiver, type ReceiverBaseline } from './support/network-reference-receiver';

const digest = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const epoch = 'receiver:real-authority';
const worldId = 'receiver-world';
const key = '0,1,0';
const controls = {
  elapsedSeconds: 1 / 60,
  issuedAtMs: 51,
  forward: { x: 1, z: 0 },
  right: { x: 0, z: 1 },
  keys: { forward: true, back: false, left: false, right: false, jump: false, crouch: false },
};

async function fixture() {
  const runtime = await AuthorityRuntime.create({
    platform: testCorePlatform,
    epoch,
    seedText: 'network-real-corpus-fixture',
    persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
    initialPlayerBodyPosition: [8.5, 45, 8.5],
    startTimeMs: 0,
    initialWorldTime: 9,
  });
  const generated = await runDedicatedComputeTask({
    kind: 'generate-canonical',
    taskId: 0,
    epoch,
    generation: 0,
    estimatedBytes: CHUNK_SIZE ** 3 * 2,
    seed: runtime.server.seed,
    generatorVersion: runtime.server.generatorVersion,
    key,
    cx: 0,
    cy: 1,
    cz: 0,
  });
  if (generated.kind !== 'canonical-result') throw new Error('Expected actual generated Chunk');
  runtime.acceptGeneratedChunk({ ...generated, canonical: new Uint16Array(generated.voxels) });
  runtime.ready();
  const correction = projectPlayerCorrectionReference(runtime.wake(50));
  const baseline = async (): Promise<ReceiverBaseline> => {
    const result = runtime.readCollisionBaseline(key, 0);
    if (result.status !== 'available') throw new Error('Expected actual baseline');
    const source = await projectChunkBaselineReference(result, {
      epoch,
      worldId,
      generatorVersion: runtime.server.generatorVersion,
      digest: { algorithm: 'sha-256', digest },
    });
    const bytes = new ArrayBuffer(source.canonical.byteLength);
    const view = new DataView(bytes);
    new Uint16Array(source.canonical.bytes).forEach((value, index) => view.setUint16(index * 2, value, true));
    return {
      ...source,
      canonical: { ...source.canonical, elementType: 'uint16-le', bytes, sha256: await digest(new Uint8Array(bytes)) },
      fluid: { ...source.fluid, elementType: 'uint8' },
    };
  };
  const receiver = new NetworkReferenceReceiver({
    epoch,
    worldId,
    generatorVersion: runtime.server.generatorVersion,
    physicsHz: 60,
    digest,
  });
  const edit = (voxel: number) => {
    const commit = runtime.server.edit(8, 44, 8, voxel, runtime.playerId);
    expect(commit.committed).toBe(true);
    runtime.commitHostActivation();
    return projectWorldCommitReference(commit, {
      epoch,
      publicationCommitSequenceUpperBound: runtime.snapshot().commitSequence,
    });
  };
  return { runtime, receiver, correction, baseline, edit };
}

describe('真实 reference 接收应用（非网络/浏览器证据）', () => {
  it('LE baseline 安装后实际预测重放，并拒绝旧 epoch、重复与倒退 correction', async () => {
    const { receiver, baseline, correction } = await fixture();
    const payload = await baseline();
    expect(await receiver.baseline(payload)).toBe(true);
    const first = receiver.chunks.get(key)!.canonical[0];
    new Uint8Array(payload.canonical.bytes).fill(255);
    expect(receiver.chunks.get(key)!.canonical[0]).toBe(first);
    expect(receiver.correction(correction).accepted).toBe(true);
    expect(receiver.advance(controls).commands).toHaveLength(1);
    const next = { ...correction, physicsTick: correction.physicsTick + 1 };
    expect(receiver.correction(next)).toMatchObject({
      accepted: true,
      reconciliation: { replayed: 1, resetReason: null },
    });
    const body = receiver.prediction.physicalBody;
    expect(receiver.correction({ ...next, epoch: 'old:epoch' })).toMatchObject({
      accepted: false,
      reason: 'wrong-epoch',
    });
    expect(receiver.correction(next)).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(receiver.correction(correction)).toMatchObject({ accepted: false, reason: 'physics-tick-regressed' });
    expect(receiver.prediction.physicalBody).toEqual(body);
  });

  it('真实连续 delta 同步体素/流体，缺 predecessor 时禁止旧碰撞重放并请求新 baseline', async () => {
    const { receiver, baseline, correction, edit, runtime } = await fixture();
    await receiver.baseline(await baseline());
    receiver.correction(correction);
    receiver.advance(controls);
    const first = edit(Voxel.Water);
    receiver.commit(first);
    const delta = first.collisionDeltas.find((value) => value.key === key)!;
    expect(receiver.chunks.get(key)!.chunkRevision).toBe(delta.revision);
    for (const cell of delta.cells) {
      expect(receiver.chunks.get(key)!.canonical[cell.index]).toBe(cell.voxel);
      expect(receiver.chunks.get(key)!.fluid[cell.index]).toBe(cell.fluid);
    }
    edit(Voxel.Dirt); // Deliberately lose this real predecessor on the reference delivery path.
    receiver.commit(edit(Voxel.Stone));
    expect(receiver.chunks.has(key)).toBe(false);
    expect(receiver.requestedBaselines.has(key)).toBe(true);
    const next = projectPlayerCorrectionReference(runtime.wake(100));
    expect(receiver.correction(next)).toMatchObject({
      accepted: true,
      reconciliation: { replayed: 0, resetReason: 'collision-history-missing' },
    });
    expect(await receiver.baseline(await baseline())).toBe(true);
    expect(receiver.chunks.has(key)).toBe(true);
    expect(receiver.requestedBaselines.has(key)).toBe(false);
  });

  it('损坏/长度错误/旧身份 baseline 均不部分安装，hash 在途时不得覆盖新 revision', async () => {
    const { receiver, baseline, edit } = await fixture();
    const valid = await baseline();
    const corrupt = structuredClone(valid);
    new Uint8Array(corrupt.fluid.bytes)[0] ^= 1;
    expect(await receiver.baseline(corrupt)).toBe(false);
    expect(await receiver.baseline({ ...valid, canonical: { ...valid.canonical, bytes: new ArrayBuffer(2) } })).toBe(
      false,
    );
    expect(await receiver.baseline({ ...valid, epoch: 'old:epoch' })).toBe(false);
    expect(receiver.chunks.size).toBe(0);
    // Hashing yields; a newer commit raises the guard before the old baseline installs.
    const pending = receiver.baseline(valid);
    receiver.commit(edit(Voxel.Water));
    expect(await pending).toBe(false);
    expect(receiver.chunks.size).toBe(0);
    expect(await receiver.baseline(await baseline())).toBe(true);
  });

  it('即使提交消息丢失，correction 的新 revision 也使旧缓存失效并请求补齐', async () => {
    const { receiver, baseline, correction, edit, runtime } = await fixture();
    await receiver.baseline(await baseline());
    receiver.correction(correction);
    edit(Voxel.Water); // The correction arrives, but the real commit publication is intentionally withheld.
    const next = projectPlayerCorrectionReference(runtime.wake(100));
    expect(next.collisionRevisions.find((value) => value.key === key)?.revision).toBeGreaterThan(
      receiver.chunks.get(key)!.chunkRevision,
    );
    expect(receiver.correction(next).accepted).toBe(true);
    expect(receiver.chunks.has(key)).toBe(false);
    expect(receiver.requestedBaselines.has(key)).toBe(true);
  });

  it('并发 baseline 的高 revision 先完成时，低 revision 的迟到 hash 不覆盖它', async () => {
    const { runtime, baseline, edit } = await fixture();
    const old = await baseline();
    edit(Voxel.Water);
    const current = await baseline();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const receiver = new NetworkReferenceReceiver({
      epoch,
      worldId,
      generatorVersion: runtime.server.generatorVersion,
      physicsHz: 60,
      digest: async (bytes) => {
        if (calls++ === 0) await barrier;
        return digest(bytes);
      },
    });
    const pendingOld = receiver.baseline(old);
    expect(await receiver.baseline(current)).toBe(true);
    const installed = receiver.chunks.get(key)!;
    expect(installed.chunkRevision).toBe(current.chunkRevision);
    release();
    await pendingOld;
    expect(receiver.chunks.get(key)).toBe(installed);
    expect(receiver.chunks.get(key)!.chunkRevision).toBe(current.chunkRevision);
  });
});
