import { describe, expect, it } from 'vitest';
import { AuthorityCollisionRevisionGuard } from '../../apps/web/src/client/authority/authority-collision-mirror';
import { createNetworkBaselineConsumer } from '../../apps/web/src/client/authority/network-baseline-consumer';
import {
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

const create = () =>
  createNetworkBaselineConsumer({
    limits,
    collisionChunks: new Map(),
    collisionGuard: new AuthorityCollisionRevisionGuard(),
  });

describe('网络基线owner与worker生命周期', () => {
  it('按overlay revision失效并忽略未拥有key的水位', async () => {
    const consumer = create();
    const ownerRef = makeBaselineOwner();
    const owner = consumer.registerOwner(ownerRef);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef)).status).toBe('accepted');
    const overlay = ownerRef.expectedEntries[1]!;

    expect(consumer.observeChunkRevisions([{ key: '99,0,99', revision: 20 }])).toEqual([]);
    expect(consumer.diagnostics().trackedRevisionKeys).toBe(27);
    expect(consumer.observeChunkRevisions([{ key: overlay.key, revision: 3 }])).toEqual([ownerRef.ownerId]);
    expect(consumer.snapshotForWorker(owner)).toBeNull();
    expect(consumer.diagnostics().sharedPreparationBytes).toBe(0);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef))).toEqual({
      status: 'rejected',
      reason: 'superseded',
    });
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef, { revision: 3 })).status).toBe('accepted');

    consumer.releaseOwner(owner);
    expect(consumer.diagnostics().trackedRevisionKeys).toBe(0);
    await consumer.close();
  });

  it('worker副本逐lease计账，close等待物理settle且结果不取得buffer所有权', async () => {
    const consumer = create();
    const ownerRef = makeBaselineOwner();
    const owner = consumer.registerOwner(ownerRef);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef)).status).toBe('accepted');
    const first = consumer.snapshotForWorker(owner)!;
    const second = consumer.snapshotForWorker(owner)!;
    expect(first.input.canonical.buffer).not.toBe(second.input.canonical.buffer);
    first.input.canonical[0] = 0;
    expect(second.input.canonical[0]).toBe(0x1234);
    const resultBuffer = nativeCanonical();
    expect(
      consumer.acceptWorkerResult(owner, {
        key: ownerRef.key,
        chunkRevision: 2,
        generatorVersion: 3,
        haloRevision: second.input.haloRevision,
        canonical: resultBuffer,
      }),
    ).toBe(true);
    expect(new Uint16Array(resultBuffer)[0]).toBe(0x1234);
    expect(
      consumer.acceptWorkerResult(owner, {
        key: ownerRef.key,
        chunkRevision: 2,
        generatorVersion: 3,
        haloRevision: `${second.input.haloRevision}-late`,
        canonical: resultBuffer,
      }),
    ).toBe(false);
    const differentCanonical = nativeCanonical();
    new Uint16Array(differentCanonical)[0] = 0xffff;
    expect(
      consumer.acceptWorkerResult(owner, {
        key: ownerRef.key,
        chunkRevision: 2,
        generatorVersion: 3,
        haloRevision: second.input.haloRevision,
        canonical: differentCanonical,
      }),
    ).toBe(false);

    let closed = false;
    const closing = consumer.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(consumer.diagnostics().activeWorkerSnapshots).toBe(2);
    first.settle();
    first.settle();
    await Promise.resolve();
    expect(closed).toBe(false);
    second.settle();
    await closing;
    expect(consumer.diagnostics()).toMatchObject({ workerTransferBytes: 0, activeWorkerSnapshots: 0, closed: true });
  });

  it('拒绝伪造handle、错误bundle身份与回收后迟到owner', async () => {
    const consumer = create();
    const ownerRef = makeBaselineOwner();
    const owner = consumer.registerOwner(ownerRef);
    const forged = { ...owner };
    expect(consumer.accept(forged, makeReassembledBaseline(ownerRef))).toEqual({
      status: 'rejected',
      reason: 'late-owner',
    });
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef, { requestId: 99 }))).toEqual({
      status: 'rejected',
      reason: 'identity-mismatch',
    });
    consumer.releaseOwner(owner);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef))).toEqual({
      status: 'rejected',
      reason: 'late-owner',
    });
    expect(() => consumer.registerOwner(makeBaselineOwner({ ownerId: 2, ownerGeneration: 1 }))).toThrow(
      /strictly increasing/,
    );
    await consumer.close();
  });

  it.each([
    ['world', { worldId: 'world-2' }],
    ['epoch', { epoch: 'epoch-2' }],
  ])('单consumer拒绝不同%s ref且不改变owner状态', async (_label, changed) => {
    const consumer = create();
    const firstRef = makeBaselineOwner();
    const first = consumer.registerOwner(firstRef);
    consumer.releaseOwner(first);
    const before = consumer.diagnostics();
    expect(() =>
      consumer.registerOwner(
        makeBaselineOwner({
          ownerId: 2,
          ownerGeneration: 2,
          requestId: 12,
          ref: { ...firstRef.ref, ...changed },
        }),
      ),
    ).toThrow(/bound to another session ref/);
    expect(consumer.diagnostics()).toEqual(before);
    await consumer.close();
  });

  it('新owner更高下界立即失效旧preparation且非最后释放不降低水位', async () => {
    const collisionGuard = new AuthorityCollisionRevisionGuard();
    const consumer = createNetworkBaselineConsumer({
      limits,
      collisionChunks: new Map(),
      collisionGuard,
    });
    const firstRef = makeBaselineOwner();
    const first = consumer.registerOwner(firstRef);
    expect(consumer.accept(first, makeReassembledBaseline(firstRef)).status).toBe('accepted');
    const inFlight = consumer.snapshotForWorker(first)!;
    const higherRef = makeBaselineOwner({
      ownerId: 2,
      ownerGeneration: 2,
      requestId: 12,
      minimumRevision: 3,
    });
    const higher = consumer.registerOwner(higherRef);
    expect(consumer.snapshotForWorker(first)).toBeNull();
    expect(
      consumer.acceptWorkerResult(first, {
        key: firstRef.key,
        chunkRevision: 2,
        generatorVersion: 3,
        haloRevision: inFlight.input.haloRevision,
        canonical: nativeCanonical(),
      }),
    ).toBe(false);
    expect(consumer.diagnostics()).toMatchObject({ sharedPreparationBytes: 0, activeWorkerSnapshots: 1 });

    const guardLease = collisionGuard.beginBaseline(firstRef.key);
    consumer.releaseOwner(higher);
    expect(collisionGuard.accepts(firstRef.key, 3, guardLease)).toBe(true);
    collisionGuard.finishBaseline(guardLease);
    expect(consumer.accept(first, makeReassembledBaseline(firstRef))).toEqual({
      status: 'rejected',
      reason: 'superseded',
    });
    inFlight.settle();
    consumer.releaseOwner(first);
    await consumer.close();
  });

  it('另一owner成功接纳较新revision后使旧向量与旧结果失效', async () => {
    const consumer = create();
    const firstRef = makeBaselineOwner();
    const first = consumer.registerOwner(firstRef);
    expect(consumer.accept(first, makeReassembledBaseline(firstRef)).status).toBe('accepted');
    const oldSnapshot = consumer.snapshotForWorker(first)!;
    const secondRef = makeBaselineOwner({ ownerId: 2, ownerGeneration: 2, requestId: 12 });
    const second = consumer.registerOwner(secondRef);
    expect(consumer.accept(second, makeReassembledBaseline(secondRef, { revision: 3 })).status).toBe('accepted');

    expect(consumer.snapshotForWorker(first)).toBeNull();
    expect(
      consumer.acceptWorkerResult(first, {
        key: firstRef.key,
        chunkRevision: 2,
        generatorVersion: 3,
        haloRevision: oldSnapshot.input.haloRevision,
        canonical: nativeCanonical(),
      }),
    ).toBe(false);
    const currentSnapshot = consumer.snapshotForWorker(second)!;
    expect(currentSnapshot.input.chunkRevision).toBe(3);

    oldSnapshot.settle();
    currentSnapshot.settle();
    consumer.releaseOwner(first);
    consumer.releaseOwner(second);
    await consumer.close();
  });
});
