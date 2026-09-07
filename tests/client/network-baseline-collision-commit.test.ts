import { describe, expect, it, vi } from 'vitest';
import { AuthorityCollisionRevisionGuard } from '../../src/client/authority/authority-collision-mirror';
import { createNetworkBaselineConsumer } from '../../src/client/authority/network-baseline-consumer';
import {
  BASELINE_BYTES_PER_CHUNK,
  makeBaselineOwner,
  makeReassembledBaseline,
} from './support/network-baseline-consumer-fixture';

const limits = {
  ownersMax: 16,
  sharedCollisionBytesMax: 32 * 1024 * 1024,
  sharedPreparationBytesMax: 32 * 1024 * 1024,
  workerTransferBytesMax: 32 * 1024 * 1024,
};

describe('网络基线consumer碰撞commit bridge', () => {
  it('用现有碰撞逻辑处理overlay链断并在回调前清账和失效preparation', async () => {
    const collisionChunks = new Map();
    const collisionGuard = new AuthorityCollisionRevisionGuard();
    const consumer = createNetworkBaselineConsumer({ limits, collisionChunks, collisionGuard });
    const ownerRef = makeBaselineOwner();
    const owner = consumer.registerOwner(ownerRef);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef)).status).toBe('accepted');
    const overlay = ownerRef.expectedEntries[1]!;
    const onUnknownChunk = vi.fn(() => {
      expect(collisionChunks.has(overlay.key)).toBe(false);
      expect(consumer.diagnostics()).toMatchObject({
        sharedCollisionBytes: 26 * BASELINE_BYTES_PER_CHUNK,
        sharedPreparationBytes: 0,
      });
    });

    consumer.consumeCollisionCommits(
      [
        {
          committed: true,
          worldRevision: 7,
          structuralChange: { chunks: [overlay.key], chunkRevisions: [{ key: overlay.key, revision: 3 }] },
        },
      ],
      { onUnknownChunk },
    );

    expect(onUnknownChunk).toHaveBeenCalledOnce();
    expect(consumer.snapshotForWorker(owner)).toBeNull();
    expect(consumer.diagnostics()).toMatchObject({
      trackedRevisionKeys: 27,
      sharedCollisionBytes: 26 * BASELINE_BYTES_PER_CHUNK,
      sharedPreparationBytes: 0,
    });
    consumer.releaseOwner(owner);
    await consumer.close();
    expect(consumer.diagnostics().sharedCollisionBytes).toBe(0);
  });

  it('链断删除后重新接纳只按实际缓存重新收费', async () => {
    const collisionChunks = new Map();
    const consumer = createNetworkBaselineConsumer({
      limits,
      collisionChunks,
      collisionGuard: new AuthorityCollisionRevisionGuard(),
    });
    const ownerRef = makeBaselineOwner({ purpose: 'collision-resync' });
    const owner = consumer.registerOwner(ownerRef);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef)).status).toBe('accepted');
    expect(consumer.diagnostics().sharedCollisionBytes).toBe(BASELINE_BYTES_PER_CHUNK);

    consumer.consumeCollisionCommits([
      {
        committed: true,
        worldRevision: 1,
        structuralChange: { chunks: [ownerRef.key], chunkRevisions: [{ key: ownerRef.key, revision: 3 }] },
      },
    ]);
    expect(consumer.diagnostics().sharedCollisionBytes).toBe(0);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef, { revision: 3 })).status).toBe('accepted');
    expect(consumer.diagnostics().sharedCollisionBytes).toBe(BASELINE_BYTES_PER_CHUNK);

    consumer.releaseOwner(owner);
    await consumer.close();
    expect(consumer.diagnostics().sharedCollisionBytes).toBe(0);
  });

  it('只把owned revision交给碰撞reducer并在close后停止推进与回调', async () => {
    const collisionChunks = new Map();
    const collisionGuard = new AuthorityCollisionRevisionGuard();
    const requireSpy = vi.spyOn(collisionGuard, 'require');
    const consumer = createNetworkBaselineConsumer({ limits, collisionChunks, collisionGuard });
    const ownerRef = makeBaselineOwner({ purpose: 'collision-resync' });
    const owner = consumer.registerOwner(ownerRef);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef)).status).toBe('accepted');
    requireSpy.mockClear();
    const unowned = Array.from({ length: 64 }, (_, index) => ({ key: `${index + 10},0,0`, revision: 3 }));
    const original = {
      committed: true,
      worldRevision: 1,
      structuralChange: {
        chunks: [ownerRef.key, ...unowned.map(({ key }) => key)],
        chunkRevisions: [{ key: ownerRef.key, revision: 3 }, ...unowned],
      },
    } as const;
    const onCommit = vi.fn();
    const onUnknownChunk = vi.fn();

    consumer.consumeCollisionCommits([original], { onCommit, onUnknownChunk });

    expect(requireSpy).toHaveBeenCalledOnce();
    expect(requireSpy).toHaveBeenCalledWith(ownerRef.key, 3);
    expect(onUnknownChunk).toHaveBeenCalledOnce();
    expect(onUnknownChunk).toHaveBeenCalledWith(ownerRef.key);
    expect(onCommit).toHaveBeenCalledWith(original);
    expect(collisionGuard.isReadable(unowned[0]!.key, 0)).toBe(true);

    consumer.releaseOwner(owner);
    await consumer.close();
    requireSpy.mockClear();
    onCommit.mockClear();
    onUnknownChunk.mockClear();
    consumer.consumeCollisionCommits([original], { onCommit, onUnknownChunk });
    expect(requireSpy).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onUnknownChunk).not.toHaveBeenCalled();
    expect(collisionGuard.isReadable(ownerRef.key, 0)).toBe(true);
  });

  it('onCommit重入close后不处理同批下一commit', async () => {
    const collisionGuard = new AuthorityCollisionRevisionGuard();
    const requireSpy = vi.spyOn(collisionGuard, 'require');
    const consumer = createNetworkBaselineConsumer({ limits, collisionChunks: new Map(), collisionGuard });
    const ownerRef = makeBaselineOwner({ purpose: 'collision-resync' });
    consumer.registerOwner(ownerRef);
    requireSpy.mockClear();
    const onCommit = vi.fn(() => {
      void consumer.close();
    });
    const onUnknownChunk = vi.fn();

    consumer.consumeCollisionCommits(
      [
        { committed: true, worldRevision: 1, structuralChange: null },
        {
          committed: true,
          worldRevision: 2,
          structuralChange: { chunks: [ownerRef.key], chunkRevisions: [{ key: ownerRef.key, revision: 3 }] },
        },
      ],
      { onCommit, onUnknownChunk },
    );

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onUnknownChunk).not.toHaveBeenCalled();
    expect(requireSpy).not.toHaveBeenCalled();
    expect(collisionGuard.isReadable(ownerRef.key, 0)).toBe(true);
  });

  it('onUnknown重入close会抑制当前剩余callback与下一commit', () => {
    const collisionGuard = new AuthorityCollisionRevisionGuard();
    const consumer = createNetworkBaselineConsumer({ limits, collisionChunks: new Map(), collisionGuard });
    const ownerRef = makeBaselineOwner();
    const owner = consumer.registerOwner(ownerRef);
    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef)).status).toBe('accepted');
    const affected = ownerRef.expectedEntries.slice(0, 2).map(({ key }) => ({ key, revision: 3 }));
    const onUnknownChunk = vi.fn(() => {
      void consumer.close();
    });
    const onCommit = vi.fn();

    consumer.consumeCollisionCommits(
      [
        {
          committed: true,
          worldRevision: 1,
          structuralChange: { chunks: affected.map(({ key }) => key), chunkRevisions: affected },
        },
        { committed: true, worldRevision: 2, structuralChange: null },
      ],
      { onCommit, onUnknownChunk },
    );

    expect(onUnknownChunk).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(collisionGuard.isReadable(affected[0]!.key, 0)).toBe(true);
    expect(collisionGuard.isReadable(affected[1]!.key, 0)).toBe(true);
  });
});
