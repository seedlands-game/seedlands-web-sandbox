import { describe, expect, it } from 'vitest';
import type { WorldCommitResult } from '../../packages/game-core/src/server/game-server-types';
import { projectWorldCommitPresentationReference } from '../../packages/game-core/src/server/protocol/network-reference-world-commit-presentation';

const metrics = {
  timingStatus: 'not-collected-hot-path' as const,
  inputMutationCount: 1,
  canonicalWriteCount: 1,
  dirtyChunkCount: 1,
  meshInvalidationCount: 2,
  structuralEventCount: 1 as const,
  semanticEventCount: 0,
  mutationPayloadBytes: 18,
  mutationCapacityBytes: 18,
  validationMs: 0,
  resolveMs: 0,
  applyMs: 0,
  commitMs: 0,
};

function commit(overrides: Partial<WorldCommitResult> = {}): WorldCommitResult {
  return {
    committed: true,
    worldRevision: 7,
    structuralChange: {
      type: 'voxel-region-changed',
      actorId: 'player-edit',
      worldRevision: 7,
      mutationCount: 2,
      chunks: ['0,0,0'],
      chunkRevisions: [{ key: '0,0,0', revision: 4 }],
      meshChunks: ['1,0,0', '0,0,0'],
      bounds: { min: [31, 20, 0], max: [32, 21, 0] },
    },
    semanticEvents: [],
    collisionDelta: [
      {
        key: '0,0,0',
        previousRevision: 3,
        revision: 4,
        cells: [{ index: 31, voxel: 1, fluid: 0 }],
      },
    ],
    metrics,
    ...overrides,
  };
}

const context = { epoch: 'host:world-commit-v2', publicationCommitSequenceUpperBound: 9 } as const;

describe('projectWorldCommitPresentationReference', () => {
  it('显式空 collisionDelta 与省略字段同样表示没有碰撞写入', () => {
    const empty = commit({ committed: false, structuralChange: null, collisionDelta: [] });
    expect(projectWorldCommitPresentationReference(empty, context).collisionDeltas).toEqual([]);
  });
  it('完整保留边界编辑的独立 mesh 集合、bounds、mutationCount 与 collision delta', () => {
    const source = commit();
    const projected = projectWorldCommitPresentationReference(source, context);
    expect(projected).toMatchObject({
      kind: 'world-commit-presentation-reference',
      projectionVersion: 2,
      epoch: context.epoch,
      publicationCommitSequenceUpperBound: 9,
      causalCommitSequence: null,
      committed: true,
      worldRevision: 7,
      structuralChange: {
        presentationClass: 'default',
        mutationCount: 2,
        chunks: ['0,0,0'],
        meshChunks: ['0,0,0', '1,0,0'],
        chunkRevisions: [{ key: '0,0,0', revision: 4 }],
        bounds: { min: [31, 20, 0], max: [32, 21, 0] },
      },
    });
    expect(projected.structuralChange?.meshChunks).not.toEqual(projected.structuralChange?.chunks);
    source.structuralChange!.meshChunks[0] = '99,0,0';
    source.structuralChange!.bounds!.min[0] = -99;
    Object.assign(source.collisionDelta![0]!.cells[0]!, { voxel: 9 });
    expect(projected.structuralChange?.meshChunks).toEqual(['0,0,0', '1,0,0']);
    expect(projected.structuralChange?.bounds?.min).toEqual([31, 20, 0]);
    expect(projected.collisionDeltas[0]?.cells[0]?.voxel).toBe(1);
  });

  it('只把严格 fluid-v2 映射为 fluid，且不公开 actorId', () => {
    const fluid = commit({ structuralChange: { ...commit().structuralChange!, actorId: 'fluid-v2' } });
    const projected = projectWorldCommitPresentationReference(fluid, context);
    expect(projected.structuralChange?.presentationClass).toBe('fluid');
    expect(projected.structuralChange).not.toHaveProperty('actorId');
    expect(projectWorldCommitPresentationReference(commit(), context).structuralChange?.presentationClass).toBe(
      'default',
    );
  });

  it('按生产数值 Chunk 顺序分别排序，不把呈现集合裁剪成 canonical 集合', () => {
    const projected = projectWorldCommitPresentationReference(
      commit({
        structuralChange: {
          ...commit().structuralChange!,
          chunks: ['1,0,0', '0,0,0'],
          chunkRevisions: [
            { key: '1,0,0', revision: 3 },
            { key: '0,0,0', revision: 4 },
          ],
          meshChunks: ['2,0,0', '1,0,0', '0,0,0'],
        },
      }),
      context,
    );
    expect(projected.structuralChange?.chunks).toEqual(['0,0,0', '1,0,0']);
    expect(projected.structuralChange?.chunkRevisions).toEqual([
      { key: '0,0,0', revision: 4 },
      { key: '1,0,0', revision: 3 },
    ]);
    expect(projected.structuralChange?.meshChunks).toEqual(['0,0,0', '1,0,0', '2,0,0']);
  });

  it('保留生产 compareChunkKeys 的负坐标与数值顺序，不采用代码单元排序', () => {
    const projected = projectWorldCommitPresentationReference(
      commit({
        structuralChange: {
          ...commit().structuralChange!,
          chunks: ['10,0,0', '-1,0,0', '2,0,0'],
          chunkRevisions: [
            { key: '10,0,0', revision: 4 },
            { key: '-1,0,0', revision: 4 },
            { key: '2,0,0', revision: 4 },
          ],
          meshChunks: ['10,0,0', '-1,0,0', '2,0,0'],
        },
        collisionDelta: [
          { key: '10,0,0', previousRevision: 3, revision: 4, cells: [{ index: 1, voxel: 1, fluid: 0 }] },
          { key: '-1,0,0', previousRevision: 3, revision: 4, cells: [{ index: 2, voxel: 1, fluid: 0 }] },
          { key: '2,0,0', previousRevision: 3, revision: 4, cells: [{ index: 3, voxel: 1, fluid: 0 }] },
        ],
      }),
      context,
    );
    expect(projected.structuralChange?.chunks).toEqual(['-1,0,0', '2,0,0', '10,0,0']);
    expect(projected.structuralChange?.meshChunks).toEqual(['-1,0,0', '2,0,0', '10,0,0']);
    expect(projected.collisionDeltas.map((delta) => delta.key)).toEqual(['-1,0,0', '2,0,0', '10,0,0']);
  });

  it('排序并拒绝重复、不合法、超预算或语义不一致的结构集合', () => {
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ structuralChange: { ...commit().structuralChange!, chunks: ['0,0,0', '0,0,0'] } }),
        context,
      ),
    ).toThrow(/duplicate/i);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({
          structuralChange: {
            ...commit().structuralChange!,
            chunkRevisions: [{ key: '1,0,0', revision: 4 }],
          },
        }),
        context,
      ),
    ).toThrow(/set/i);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ structuralChange: { ...commit().structuralChange!, meshChunks: ['1,0,0'] } }),
        context,
      ),
    ).toThrow(/include every canonical/i);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ structuralChange: { ...commit().structuralChange!, meshChunks: Array(513).fill('0,0,0') } }),
        context,
      ),
    ).toThrow(/512/);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({
          structuralChange: {
            ...commit().structuralChange!,
            chunks: Array.from({ length: 513 }, (_, index) => `${index},0,0`),
          },
        }),
        context,
      ),
    ).toThrow(/512/);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({
          structuralChange: {
            ...commit().structuralChange!,
            chunkRevisions: Array.from({ length: 513 }, (_, index) => ({ key: `${index},0,0`, revision: 1 })),
          },
        }),
        context,
      ),
    ).toThrow(/512/);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ structuralChange: { ...commit().structuralChange!, mutationCount: Number.MAX_SAFE_INTEGER + 1 } }),
        context,
      ),
    ).toThrow(/mutationCount/);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ structuralChange: { ...commit().structuralChange!, bounds: { min: [2, 0, 0], max: [1, 0, 0] } } }),
        context,
      ),
    ).toThrow(/bounds/);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ structuralChange: { ...commit().structuralChange!, actorId: 'fluid-v2', bounds: null } }),
        context,
      ),
    ).toThrow(/fluid.*bounds/i);
  });

  it('拒绝 v1 缺失的 presentation 字段和不匹配的结构 revision', () => {
    const v1Shape = {
      committed: true,
      worldRevision: 7,
      structuralChange: { chunks: ['0,0,0'], chunkRevisions: [{ key: '0,0,0', revision: 4 }] },
      semanticEvents: [],
      metrics,
    } as unknown as WorldCommitResult;
    expect(() => projectWorldCommitPresentationReference(v1Shape, context)).toThrow();
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ structuralChange: { ...commit().structuralChange!, worldRevision: 8 } }),
        context,
      ),
    ).toThrow(/worldRevision/);
  });

  it('拒绝稀疏的结构、bounds 与 collision 数组，不能跳过缺失项', () => {
    const sparseMesh = ['0,0,0'];
    sparseMesh.length = 2;
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ structuralChange: { ...commit().structuralChange!, meshChunks: sparseMesh } }),
        context,
      ),
    ).toThrow(/dense/i);
    const sparseChunks = ['0,0,0'];
    sparseChunks.length = 2;
    const sparseRevisions = [{ key: '0,0,0', revision: 4 }];
    sparseRevisions.length = 2;
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({
          structuralChange: { ...commit().structuralChange!, chunks: sparseChunks, chunkRevisions: sparseRevisions },
        }),
        context,
      ),
    ).toThrow(/dense/i);
    const sparseMin = [0];
    sparseMin.length = 3;
    sparseMin[2] = 0;
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({
          structuralChange: {
            ...commit().structuralChange!,
            bounds: { min: sparseMin as [number, number, number], max: [0, 0, 0] },
          },
        }),
        context,
      ),
    ).toThrow(/dense/i);
    const sparseCells = [{ index: 1, voxel: 1, fluid: 0 }];
    sparseCells.length = 2;
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ collisionDelta: [{ ...commit().collisionDelta![0]!, cells: sparseCells }] }),
        context,
      ),
    ).toThrow(/dense/i);
  });

  it('拒绝超出 canonical Uint16 与 fluid Uint8 域的 collision cell', () => {
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({
          collisionDelta: [{ ...commit().collisionDelta![0]!, cells: [{ index: 1, voxel: 65536, fluid: 0 }] }],
        }),
        context,
      ),
    ).toThrow(/voxel/i);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ collisionDelta: [{ ...commit().collisionDelta![0]!, cells: [{ index: 1, voxel: 1, fluid: 256 }] }] }),
        context,
      ),
    ).toThrow(/fluid/i);
  });

  it('拒绝未提交或不关联本次结构 revision 的 collision delta', () => {
    expect(() =>
      projectWorldCommitPresentationReference(commit({ committed: false, structuralChange: null }), context),
    ).toThrow(/requires a committed structural/i);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ collisionDelta: [{ ...commit().collisionDelta![0]!, key: '1,0,0' }] }),
        context,
      ),
    ).toThrow(/match a structural/i);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ collisionDelta: [{ ...commit().collisionDelta![0]!, revision: 5 }] }),
        context,
      ),
    ).toThrow(/immediately follow|match a structural/i);
    expect(() =>
      projectWorldCommitPresentationReference(
        commit({ collisionDelta: [{ ...commit().collisionDelta![0]!, cells: [] }] }),
        context,
      ),
    ).toThrow(/cells must not be empty/i);
  });
});
