import { describe, expect, it, vi } from 'vitest';
import {
  applyAuthorityCollisionCommit,
  installAuthorityCollisionBaseline,
  type AuthorityCollisionCachedChunk,
  type AuthorityCollisionCommit,
} from '../../src/client/authority-collision-mirror';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../../src/world/voxel';

const chunk = (revision: number): AuthorityCollisionCachedChunk => ({
  canonical: new Uint16Array(CHUNK_SIZE ** 3),
  fluid: new Uint8Array(CHUNK_SIZE ** 3),
  chunkRevision: revision,
});

const commit = (
  previousRevision: number,
  revision: number,
  cells = [{ index: voxelIndex(1, 2, 3), voxel: Voxel.Stone, fluid: 0x88 }],
): AuthorityCollisionCommit => ({
  committed: true,
  worldRevision: revision,
  structuralChange: {
    chunks: ['0,0,0'],
    chunkRevisions: [{ key: '0,0,0', revision }],
  },
  collisionDelta: [{ key: '0,0,0', previousRevision, revision, cells }],
});

describe('权威碰撞镜像', () => {
  it('按连续revision同时应用最终体素和流体，并让重复提交保持幂等', () => {
    const cached = chunk(4);
    const requestBaseline = vi.fn();
    const apply = () =>
      applyAuthorityCollisionCommit(commit(4, 5), {
        getChunk: () => cached,
        invalidateChunk: vi.fn(),
        requestBaseline,
      });

    apply();
    apply();

    const index = voxelIndex(1, 2, 3);
    expect(cached.canonical[index]).toBe(Voxel.Stone);
    expect(cached.fluid[index]).toBe(0x88);
    expect(cached.chunkRevision).toBe(5);
    expect(requestBaseline).not.toHaveBeenCalled();
  });

  it('revision有缺口或结构提交缺少增量时失效旧缓存并请求基线', () => {
    const chunks = new Map([['0,0,0', chunk(3)]]);
    const requestBaseline = vi.fn();
    const apply = (value: AuthorityCollisionCommit) =>
      applyAuthorityCollisionCommit(value, {
        getChunk: (key) => chunks.get(key),
        invalidateChunk: (key) => chunks.delete(key),
        requestBaseline,
      });

    apply(commit(4, 5));
    expect(chunks.has('0,0,0')).toBe(false);
    expect(requestBaseline).toHaveBeenLastCalledWith('0,0,0');

    chunks.set('0,0,0', chunk(5));
    apply({
      committed: true,
      worldRevision: 6,
      structuralChange: { chunks: ['0,0,0'], chunkRevisions: [{ key: '0,0,0', revision: 6 }] },
    });
    expect(chunks.has('0,0,0')).toBe(false);
    expect(requestBaseline).toHaveBeenCalledTimes(2);
  });

  it('不让迟到网格回滚更高revision碰撞事实，并接受更新基线', () => {
    const current = chunk(7);
    current.canonical[0] = Voxel.Stone;
    const stale = chunk(6);
    stale.canonical[0] = Voxel.Air;
    const newer = chunk(8);
    newer.canonical[0] = Voxel.Dirt;

    expect(installAuthorityCollisionBaseline(current, stale)).toBe(current);
    expect(installAuthorityCollisionBaseline(current, newer)).toBe(newer);
  });
});
