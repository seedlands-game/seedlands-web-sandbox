import { describe, expect, it } from 'vitest';
import { AuthorityCollisionRevisionGuard } from '../../apps/web/src/client/authority/authority-collision-mirror';
import { createNetworkBaselineConsumer } from '../../apps/web/src/client/authority/network-baseline-consumer';
import {
  BASELINE_BYTES_PER_CHUNK,
  makeBaselineOwner,
  makeReassembledBaseline,
} from './support/network-baseline-consumer-fixture';

const meshBytes = 27 * BASELINE_BYTES_PER_CHUNK;
const generous = {
  ownersMax: 16,
  sharedCollisionBytesMax: 32 * 1024 * 1024,
  sharedPreparationBytesMax: 32 * 1024 * 1024,
  workerTransferBytesMax: 32 * 1024 * 1024,
};

const create = (limits = generous) => {
  const collisionChunks = new Map();
  return {
    collisionChunks,
    consumer: createNetworkBaselineConsumer({
      limits,
      collisionChunks,
      collisionGuard: new AuthorityCollisionRevisionGuard(),
    }),
  };
};

describe('网络基线consumer预算与共享块', () => {
  it.each([
    ['preparation', { ...generous, sharedPreparationBytesMax: meshBytes - 1 }],
    ['collision', { ...generous, sharedCollisionBytesMax: meshBytes - 1 }],
  ])('%s预算不足时不做部分安装', (_label, limits) => {
    const { collisionChunks, consumer } = create(limits);
    const ownerRef = makeBaselineOwner();
    const owner = consumer.registerOwner(ownerRef);

    expect(consumer.accept(owner, makeReassembledBaseline(ownerRef))).toEqual({
      status: 'rejected',
      reason: 'resource-limit',
    });
    expect(collisionChunks.size).toBe(0);
    expect(consumer.diagnostics()).toMatchObject({ sharedCollisionBytes: 0, sharedPreparationBytes: 0 });
  });

  it('重叠owner共享相同版本block并拒绝同identity不同内容', async () => {
    const { consumer } = create();
    const firstRef = makeBaselineOwner();
    const first = consumer.registerOwner(firstRef);
    expect(consumer.accept(first, makeReassembledBaseline(firstRef)).status).toBe('accepted');

    const secondRef = makeBaselineOwner({ ownerId: 2, ownerGeneration: 2, requestId: 12 });
    const second = consumer.registerOwner(secondRef);
    expect(consumer.accept(second, makeReassembledBaseline(secondRef)).status).toBe('accepted');
    expect(consumer.diagnostics()).toMatchObject({
      activeOwners: 2,
      sharedPreparationEntries: 27,
      sharedPreparationBytes: meshBytes,
      sharedCollisionBytes: meshBytes,
    });

    const conflictRef = makeBaselineOwner({ ownerId: 3, ownerGeneration: 3, requestId: 13 });
    const conflict = consumer.registerOwner(conflictRef);
    expect(consumer.accept(conflict, makeReassembledBaseline(conflictRef, { canonicalValue: 0x7777 }))).toEqual({
      status: 'rejected',
      reason: 'conflicting-content',
    });
    expect(consumer.diagnostics()).toMatchObject({
      sharedPreparationEntries: 27,
      sharedPreparationBytes: meshBytes,
      sharedCollisionBytes: meshBytes,
    });

    consumer.releaseOwner(first);
    expect(consumer.diagnostics().sharedPreparationBytes).toBe(meshBytes);
    consumer.releaseOwner(second);
    consumer.releaseOwner(conflict);
    await consumer.close();
    expect(consumer.diagnostics()).toMatchObject({
      sharedPreparationEntries: 0,
      sharedPreparationBytes: 0,
      sharedCollisionBytes: 0,
    });
  });

  it('拒绝非空的非专属collision map', () => {
    const collisionChunks = new Map([
      [
        '0,0,0',
        {
          canonical: new Uint16Array(32 ** 3),
          fluid: new Uint8Array(32 ** 3),
          chunkRevision: 1,
        },
      ],
    ]);
    expect(() =>
      createNetworkBaselineConsumer({
        limits: generous,
        collisionChunks,
        collisionGuard: new AuthorityCollisionRevisionGuard(),
      }),
    ).toThrow(/empty dedicated collision map/);
  });
});
