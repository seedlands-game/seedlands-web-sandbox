import { describe, expect, it } from 'vitest';
import { AuthorityCollisionRevisionGuard } from '../../apps/web/src/client/authority/authority-collision-mirror';
import { createNetworkBaselineConsumer } from '../../apps/web/src/client/authority/network-baseline-consumer';
import {
  BASELINE_BYTES_PER_CHUNK,
  makeBaselineOwner,
  makeReassembledBaseline,
  nativeCanonical,
} from './support/network-baseline-consumer-fixture';

const limits = {
  ownersMax: 16,
  sharedCollisionBytesMax: 32 * 1024 * 1024,
  sharedPreparationBytesMax: 32 * 1024 * 1024,
  workerTransferBytesMax: 32 * 1024 * 1024,
};

describe('网络基线consumer', () => {
  it('以完整27项版本接纳mesh并显式读取LE canonical', async () => {
    const chunks = new Map();
    const consumer = createNetworkBaselineConsumer({
      limits,
      collisionChunks: chunks,
      collisionGuard: new AuthorityCollisionRevisionGuard(),
    });
    const ownerRef = makeBaselineOwner();
    const owner = consumer.registerOwner(ownerRef);

    const accepted = consumer.accept(owner, makeReassembledBaseline(ownerRef));

    expect(accepted.status).toBe('accepted');
    expect(chunks).toHaveLength(27);
    expect(chunks.get(ownerRef.key)?.canonical[0]).toBe(0x1234);
    expect(consumer.diagnostics()).toMatchObject({
      activeOwners: 1,
      ownedKeys: 27,
      sharedCollisionBytes: 27 * BASELINE_BYTES_PER_CHUNK,
      sharedPreparationBytes: 27 * BASELINE_BYTES_PER_CHUNK,
      workerTransferBytes: 0,
    });

    const snapshot = consumer.snapshotForWorker(owner);
    expect(snapshot?.input.inputStrategy).toBe('authority-complete');
    expect(snapshot?.input.canonical[0]).toBe(0x1234);
    expect(snapshot?.input.overlays).toHaveLength(26);
    expect(
      consumer.acceptWorkerResult(owner, {
        key: ownerRef.key,
        chunkRevision: 2,
        generatorVersion: 3,
        haloRevision: snapshot!.input.haloRevision,
        canonical: nativeCanonical(),
      }),
    ).toBe(true);
    snapshot!.settle();
    consumer.releaseOwner(owner);
    await consumer.close();
    expect(consumer.diagnostics()).toMatchObject({
      activeOwners: 0,
      sharedCollisionBytes: 0,
      sharedPreparationBytes: 0,
      workerTransferBytes: 0,
    });
  });

  it('以单项collision-resync接纳并用已有较新镜像满足较旧请求', async () => {
    const chunks = new Map();
    const consumer = createNetworkBaselineConsumer({
      limits,
      collisionChunks: chunks,
      collisionGuard: new AuthorityCollisionRevisionGuard(),
    });
    const firstRef = makeBaselineOwner({ purpose: 'collision-resync' });
    const first = consumer.registerOwner(firstRef);
    expect(consumer.accept(first, makeReassembledBaseline(firstRef, { revision: 3 }))).toEqual({
      status: 'accepted',
      haloRevision: null,
    });
    const secondRef = makeBaselineOwner({
      purpose: 'collision-resync',
      ownerId: 2,
      ownerGeneration: 2,
      requestId: 12,
    });
    const second = consumer.registerOwner(secondRef);
    expect(consumer.accept(second, makeReassembledBaseline(secondRef, { revision: 2 }))).toEqual({
      status: 'satisfied-by-newer',
    });
    expect(chunks.get(firstRef.key)?.chunkRevision).toBe(3);
    expect(consumer.diagnostics()).toMatchObject({
      sharedPreparationBytes: 0,
      sharedCollisionBytes: BASELINE_BYTES_PER_CHUNK,
    });

    consumer.releaseOwner(first);
    expect(chunks.has(firstRef.key)).toBe(true);
    consumer.releaseOwner(second);
    expect(chunks.has(firstRef.key)).toBe(false);
    await consumer.close();
  });

  it('在安装前拒绝错误entry role与共享backing buffer', async () => {
    const chunks = new Map();
    const consumer = createNetworkBaselineConsumer({
      limits,
      collisionChunks: chunks,
      collisionGuard: new AuthorityCollisionRevisionGuard(),
    });
    const ownerRef = makeBaselineOwner();
    const owner = consumer.registerOwner(ownerRef);
    const wrongRole = structuredClone(makeReassembledBaseline(ownerRef));
    (wrongRole.descriptor.entries[1] as { role: string }).role = 'main';
    expect(() => consumer.accept(owner, wrongRole)).toThrow(/does not match its owner/);
    expect(chunks.size).toBe(0);

    const aliased = structuredClone(makeReassembledBaseline(ownerRef));
    const canonical = aliased.entries[0]!.canonicalLittleEndian;
    (aliased.entries[0] as { fluid: Uint8Array }).fluid = new Uint8Array(
      canonical.buffer,
      canonical.byteOffset,
      32 ** 3,
    );
    expect(() => consumer.accept(owner, aliased)).toThrow(/independent ArrayBuffers/);
    expect(chunks.size).toBe(0);
    consumer.releaseOwner(owner);
    await consumer.close();
  });
});
