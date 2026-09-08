import { describe, expect, it } from 'vitest';
import { applyAcknowledgedWorldEdits } from '../../apps/web/src/client/authority/acknowledged-world-edit-cache';
import { CHUNK_SIZE, voxelIndex } from '../../packages/game-core/src/world/voxel';
import type { WorldCommitResult } from '../../packages/game-core/src/server/game-server-types';

const commit = (key: string, revision: number): WorldCommitResult => ({
  committed: true,
  worldRevision: revision,
  structuralChange: {
    type: 'voxel-region-changed',
    actorId: 'browser-test',
    worldRevision: revision,
    mutationCount: 1,
    chunks: [key],
    chunkRevisions: [{ key, revision }],
    meshChunks: [key],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  },
  semanticEvents: [],
  metrics: {
    timingStatus: 'measured',
    inputMutationCount: 1,
    canonicalWriteCount: 1,
    dirtyChunkCount: 1,
    meshInvalidationCount: 1,
    structuralEventCount: 1,
    semanticEventCount: 0,
    mutationPayloadBytes: 14,
    mutationCapacityBytes: 14,
    validationMs: 0,
    resolveMs: 0,
    applyMs: 0,
    commitMs: 0,
  },
});

describe('浏览器已确认世界编辑碰撞副本', () => {
  it('在权威成功回执时立即更新已缓存体素和对应 Chunk revision', () => {
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    const index = voxelIndex(CHUNK_SIZE - 1, 24, CHUNK_SIZE - 1);
    canonical[index] = 3;
    const cached = { canonical, chunkRevision: 4 };

    applyAcknowledgedWorldEdits({
      edits: [{ x: -1, y: 56, z: -1, value: 0 }],
      result: commit('-1,1,-1', 5),
      getCachedChunk: (key) => (key === '-1,1,-1' ? cached : undefined),
    });

    expect(canonical[index]).toBe(0);
    expect(cached.chunkRevision).toBe(5);
  });

  it('不改写回执未确认的 Chunk，也不让旧回执覆盖更高 revision 的缓存', () => {
    const unconfirmed = { canonical: new Uint16Array(CHUNK_SIZE ** 3).fill(3), chunkRevision: 4 };
    const newer = { canonical: new Uint16Array(CHUNK_SIZE ** 3).fill(3), chunkRevision: 6 };

    applyAcknowledgedWorldEdits({
      edits: [
        { x: 0, y: 56, z: 0, value: 0 },
        { x: -1, y: 56, z: -1, value: 0 },
      ],
      result: commit('0,1,0', 5),
      getCachedChunk: (key) => (key === '0,1,0' ? newer : unconfirmed),
    });

    expect(newer.canonical[voxelIndex(0, 24, 0)]).toBe(3);
    expect(newer.chunkRevision).toBe(6);
    expect(unconfirmed.canonical[voxelIndex(CHUNK_SIZE - 1, 24, CHUNK_SIZE - 1)]).toBe(3);
    expect(unconfirmed.chunkRevision).toBe(4);
  });
});
