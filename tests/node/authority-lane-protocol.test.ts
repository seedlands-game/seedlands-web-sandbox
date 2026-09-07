import { describe, expect, it } from 'vitest';
import {
  measureAuthorityPublicationBytes,
  validateAuthorityPublicationMessage,
  validateAuthorityRequestPayload,
  validateAuthorityResponsePayload,
} from '../../src/node/runtime/node-authority-lane-protocol';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { CHUNK_SIZE } from '../../src/world/voxel';

describe('Authority lane 入出站合同', () => {
  it('逐 kind 拒绝不能由调用方安全消费的回复', () => {
    expect(() => validateAuthorityResponsePayload('authority-receive-input', 'made-up')).toThrow(/input/i);
    expect(() => validateAuthorityResponsePayload('authority-perform-action', {})).toThrow(/receipt|action/i);
    expect(() => validateAuthorityResponsePayload('authority-request-checkpoint', {})).toThrow(/checkpoint/i);
    expect(() => validateAuthorityResponsePayload('authority-stop', {})).toThrow(/stop/i);
    expect(() => validateAuthorityResponsePayload('authority-wait-for-idle', { extra: true })).toThrow(/空/i);
  });

  it('接纳每个公开操作的最小可消费回复', () => {
    expect(validateAuthorityResponsePayload('authority-receive-input', 'accepted').value).toBe('accepted');
    expect(
      validateAuthorityResponsePayload('authority-perform-action', {
        status: 'executed',
        commitSequence: 4,
        result: { changed: true },
      }).value,
    ).toMatchObject({ status: 'executed', commitSequence: 4 });
    expect(
      validateAuthorityResponsePayload('authority-request-checkpoint', {
        savedChunks: ['0,0,0'],
        gameplaySaved: true,
        commitSequence: 4,
        storageBytes: 128,
      }).value,
    ).toMatchObject({ commitSequence: 4 });
    expect(
      validateAuthorityResponsePayload('authority-stop', {
        status: 'stopped',
        durableCommitSequence: 4,
      }).value,
    ).toMatchObject({ status: 'stopped' });
  });

  it('只接纳严格的 collision baseline 读取参数和结果外形', () => {
    expect(
      validateAuthorityRequestPayload('authority-read-collision-baseline', {
        key: '0,0,0',
        minimumRevision: 0,
      }).value,
    ).toMatchObject({ key: '0,0,0', minimumRevision: 0 });
    expect(() =>
      validateAuthorityRequestPayload('authority-read-collision-baseline', {
        key: '0,0',
        minimumRevision: 0,
      }),
    ).toThrow(/baseline|Chunk/i);
    expect(() =>
      validateAuthorityRequestPayload('authority-read-collision-baseline', {
        key: '0,0,0',
        minimumRevision: -1,
      }),
    ).toThrow(/revision/i);
    const available = {
      status: 'available',
      key: '0,0,0',
      chunkRevision: 3,
      canonical: new ArrayBuffer(CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT),
      fluid: new ArrayBuffer(CHUNK_SIZE ** 3 * Uint8Array.BYTES_PER_ELEMENT),
    };
    expect(validateAuthorityResponsePayload('authority-read-collision-baseline', available).value).toBe(available);
    expect(() =>
      validateAuthorityResponsePayload('authority-read-collision-baseline', {
        ...available,
        canonical: new ArrayBuffer(1),
      }),
    ).toThrow(/baseline/i);
    expect(
      validateAuthorityResponsePayload('authority-read-collision-baseline', { status: 'unavailable', key: '0,0,0' }),
    ).toMatchObject({ value: { status: 'unavailable', key: '0,0,0' } });
  });

  it('publication 必须绑定 epoch、序号和可消费外层 shape', () => {
    expect(() =>
      validateAuthorityPublicationMessage(
        {
          type: 'publication',
          epoch: 'wrong',
          sequence: 0,
          publication: { snapshot: {}, commits: [] },
        },
        'epoch-a',
      ),
    ).toThrow(/epoch/i);
    expect(() =>
      validateAuthorityPublicationMessage(
        {
          type: 'publication',
          epoch: 'epoch-a',
          sequence: 0,
          publication: { commits: [] },
        },
        'epoch-a',
      ),
    ).toThrow(/publication/i);
    expect(
      validateAuthorityPublicationMessage(
        {
          type: 'publication',
          epoch: 'epoch-a',
          sequence: 0,
          publication: { snapshot: {}, commits: [], resyncRequired: true },
        },
        'epoch-a',
      ),
    ).toMatchObject({ sequence: 0 });
  });

  it('接受 AuthorityRuntime 的真实快照别名，并对别名只计固定引用成本', async () => {
    const runtime = await AuthorityRuntime.create({
      epoch: 'publication-runtime',
      seedText: 'publication-runtime',
      persistence: new MemoryGamePersistence(),
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
    });
    const snapshot = runtime.snapshot();
    expect(snapshot.player).toBe(snapshot.entities.find((entity) => entity.id === runtime.playerId));
    const publication = {
      type: 'publication' as const,
      epoch: 'publication-runtime',
      sequence: 0,
      publication: { snapshot, commits: [] },
    };
    expect(validateAuthorityPublicationMessage(publication, 'publication-runtime')).toMatchObject({ sequence: 0 });
    const expanded = {
      ...publication,
      publication: {
        ...publication.publication,
        snapshot: {
          ...snapshot,
          player: structuredClone(snapshot.player),
          entities: snapshot.entities.map((entity) => structuredClone(entity)),
        },
      },
    };
    expect(measureAuthorityPublicationBytes(publication)).toBeLessThan(measureAuthorityPublicationBytes(expanded));
  });
});
