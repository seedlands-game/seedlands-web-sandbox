import { describe, expect, it } from 'vitest';
import { GameServer } from '../../src/server/game-server';
import type { ExpectedWorldVoxelEdit } from '../../src/server/world-transaction-commit';
import {
  MAX_WORLD_EDIT_BATCH_EDITS,
  prepareWorldEditBatchPlan,
  type WorldEditBatchPlanState,
} from '../../src/server/world-edit-batch-plan';
import { CHUNK_SIZE, Voxel, floorDiv, mod, voxelIndex } from '../../src/world/voxel';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenExecutableProvider } from '../support/worldgen';

const createServer = (seedText: string) =>
  new GameServer({ worldgenProvider: testWorldgenExecutableProvider, platform: testCorePlatform, seedText });

const expectedEdit = (
  server: GameServer,
  position: readonly [number, number, number],
  value: number,
): ExpectedWorldVoxelEdit => {
  const [x, y, z] = position;
  const chunk = server.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
  const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  return { x, y, z, expectedVoxel: chunk.voxels[index]!, expectedFluid: chunk.fluid[index]!, value };
};

describe('prepared world edit batch', () => {
  it('commits a cross-Chunk batch with one world revision and the same receipt as immediate editBatch', () => {
    const preparedServer = createServer('prepared-batch-equivalence');
    const immediateServer = createServer('prepared-batch-equivalence');
    const preparedEdits = [
      expectedEdit(preparedServer, [1, 31, 0], Voxel.Water),
      expectedEdit(preparedServer, [1, 32, 0], Voxel.Lava),
    ];
    const immediateEdits = preparedEdits.map(({ x, y, z, value }) => ({ x, y, z, value }));
    immediateServer.getChunk(0, 0, 0);
    immediateServer.getChunk(0, 1, 0);

    const prepared = preparedServer.prepareVoxelEdits('structure', preparedEdits);
    const fluidRuntime = (preparedServer as unknown as { fluidRuntime: { activate(): boolean } }).fluidRuntime;
    fluidRuntime.activate = () => {
      throw new Error('legacy post-commit fluid notification');
    };
    expect(preparedServer.worldRevision).toBe(0);
    prepared.validate();
    const preparedResult = prepared.apply();
    const immediateResult = immediateServer.editBatch({ actorId: 'structure', edits: immediateEdits });

    expect(preparedResult).toMatchObject({
      committed: true,
      worldRevision: 1,
      structuralChange: { mutationCount: 2, chunks: ['0,0,0', '0,1,0'] },
      collisionDelta: [
        { key: '0,0,0', previousRevision: 0, revision: 1, cells: [expect.objectContaining({ fluid: 0x88 })] },
        { key: '0,1,0', previousRevision: 0, revision: 1, cells: [expect.objectContaining({ fluid: 0x88 })] },
      ],
    });
    expect({ ...preparedResult, metrics: undefined }).toEqual({ ...immediateResult, metrics: undefined });
    expect(preparedServer.worldRevision).toBe(1);
    expect(preparedServer.mutationCount).toBe(2);
    expect(preparedServer.getChunk(0, 0, 0).revision).toBe(1);
    expect(preparedServer.getChunk(0, 1, 0).revision).toBe(1);
    expect(preparedServer.fluidDiagnostics.pendingCellCount).toBe(immediateServer.fluidDiagnostics.pendingCellCount);
    expect(preparedServer.fluidDiagnostics.pendingCellCount).toBeGreaterThan(0);
  });

  it('matches immediate source removal without retaining stale fluid bytes', () => {
    const preparedServer = createServer('prepared-batch-source-removal');
    const immediateServer = createServer('prepared-batch-source-removal');
    for (const server of [preparedServer, immediateServer]) {
      server.getChunk(0, 0, 0);
      server.getChunk(0, 1, 0);
      server.editBatch({
        actorId: 'fixture',
        edits: [
          { x: 1, y: 31, z: 0, value: Voxel.Water },
          { x: 1, y: 32, z: 0, value: Voxel.Lava },
        ],
      });
    }
    const preparedEdits = [
      expectedEdit(preparedServer, [1, 31, 0], Voxel.Air),
      expectedEdit(preparedServer, [1, 32, 0], Voxel.Air),
    ];
    const prepared = preparedServer.prepareVoxelEdits('structure', preparedEdits);
    prepared.validate();
    const preparedResult = prepared.apply();
    const immediateResult = immediateServer.editBatch({
      actorId: 'structure',
      edits: preparedEdits.map(({ x, y, z, value }) => ({ x, y, z, value })),
    });

    expect({ ...preparedResult, metrics: undefined }).toEqual({ ...immediateResult, metrics: undefined });
    for (const server of [preparedServer, immediateServer]) {
      expect(server.getFluidCell(1, 31, 0)).toBeNull();
      expect(server.getFluidCell(1, 32, 0)).toBeNull();
    }
    expect(preparedServer.fluidDiagnostics.pendingCellCount).toBe(immediateServer.fluidDiagnostics.pendingCellCount);
  });

  it('rejects unavailable chunks and expected voxel or fluid mismatches before writing', () => {
    const unavailable = createServer('prepared-batch-unavailable');
    const unavailableFirst = expectedEdit(unavailable, [1, 31, 0], Voxel.Wood);
    expect(() =>
      unavailable.prepareVoxelEdits('structure', [
        unavailableFirst,
        { x: 1, y: 32, z: 0, expectedVoxel: Voxel.Air, expectedFluid: 0, value: Voxel.Wood },
      ]),
    ).toThrow(/unavailable/i);
    expect(unavailable.worldRevision).toBe(0);
    expect(unavailable.mutationCount).toBe(0);

    const mismatched = createServer('prepared-batch-mismatch');
    const first = expectedEdit(mismatched, [1, 31, 0], Voxel.Wood);
    const second = expectedEdit(mismatched, [1, 32, 0], Voxel.Wood);
    expect(() =>
      mismatched.prepareVoxelEdits('structure', [{ ...first, expectedVoxel: first.expectedVoxel + 1 }, second]),
    ).toThrow(/expected voxel/i);
    expect(() =>
      mismatched.prepareVoxelEdits('structure', [first, { ...second, expectedFluid: second.expectedFluid + 1 }]),
    ).toThrow(/expected fluid/i);
    expect(mismatched.worldRevision).toBe(0);
    expect(mismatched.mutationCount).toBe(0);
    expect(() => mismatched.prepareVoxelEdits('structure', [{ ...first, expectedVoxel: 65_536 }, second])).toThrow(
      /voxel/i,
    );
  });

  it('rejects sparse or extended prepared edit and expected arrays without changing immediate compatibility', () => {
    const server = createServer('prepared-batch-array-shape');
    const first = expectedEdit(server, [1, 31, 0], Voxel.Wood);
    const sparse = new Array<ExpectedWorldVoxelEdit>(3);
    sparse[0] = first;
    sparse[2] = first;
    const extended = [first] as ExpectedWorldVoxelEdit[] & { extra?: ExpectedWorldVoxelEdit };
    extended.extra = first;
    const state = {} as WorldEditBatchPlanState;
    const prepare = (edits: ExpectedWorldVoxelEdit[], expected: ExpectedWorldVoxelEdit[]) =>
      prepareWorldEditBatchPlan(state, { actorId: 'structure', edits, expected }, () => 0);

    expect(() => prepare(sparse, [first])).toThrow(/prepared world edits.*dense/i);
    expect(() => prepare([first], sparse)).toThrow(/expected world edits.*dense/i);
    expect(() => prepare(extended, [first])).toThrow(/prepared world edits.*extra enumerable/i);
    expect(() => prepare([first], extended)).toThrow(/expected world edits.*extra enumerable/i);
    expect(() => server.editBatch({ actorId: 'fixture', edits: new Array(1) })).not.toThrow();
    expect(server.worldRevision).toBe(0);
    expect(server.mutationCount).toBe(0);
  });

  it('rejects oversized prepared object batches before reading any Chunk', () => {
    let chunkReads = 0;
    const state = { getChunk: () => (chunkReads += 1) } as unknown as WorldEditBatchPlanState;
    const edits = Array.from({ length: MAX_WORLD_EDIT_BATCH_EDITS + 1 }, () => ({
      x: 0,
      y: 0,
      z: 0,
      value: Voxel.Wood,
      expectedVoxel: Voxel.Air,
      expectedFluid: 0,
    }));
    expect(() => prepareWorldEditBatchPlan(state, { actorId: 'structure', edits, expected: edits }, () => 0)).toThrow(
      /edit.*limit/i,
    );
    expect(chunkReads).toBe(0);
  });

  it.each(['revision', 'voxel-buffer', 'fluid-buffer'] as const)(
    'rejects a stale second Chunk %s before writing the first Chunk',
    (fault) => {
      const server = createServer(`prepared-batch-${fault}`);
      const first = expectedEdit(server, [1, 31, 0], Voxel.Wood);
      const second = expectedEdit(server, [1, 32, 0], Voxel.Wood);
      const firstChunk = server.getChunk(0, 0, 0);
      const secondChunk = server.getChunk(0, 1, 0);
      const before = firstChunk.voxels[voxelIndex(1, 31, 0)];
      const prepared = server.prepareVoxelEdits('structure', [first, second]);
      if (fault === 'revision') secondChunk.revision += 1;
      else if (fault === 'voxel-buffer') secondChunk.voxels = secondChunk.voxels.slice();
      else secondChunk.fluid = secondChunk.fluid.slice();

      expect(() => prepared.validate()).toThrow(/stale/i);
      expect(firstChunk.voxels[voxelIndex(1, 31, 0)]).toBe(before);
      expect(firstChunk.revision).toBe(0);
      expect(server.worldRevision).toBe(0);
      expect(server.mutationCount).toBe(0);
    },
  );

  it('rejects a cell change after validate without partially writing another Chunk', () => {
    const server = createServer('prepared-batch-cell-stale');
    const first = expectedEdit(server, [1, 31, 0], Voxel.Wood);
    const second = expectedEdit(server, [1, 32, 0], Voxel.Wood);
    const firstChunk = server.getChunk(0, 0, 0);
    const secondChunk = server.getChunk(0, 1, 0);
    const firstIndex = voxelIndex(1, 31, 0);
    const secondIndex = voxelIndex(1, 0, 0);
    const prepared = server.prepareVoxelEdits('structure', [first, second]);
    prepared.validate();
    secondChunk.fluid[secondIndex] = 1;

    expect(() => prepared.apply()).toThrow(/stale/i);
    expect(firstChunk.voxels[firstIndex]).toBe(first.expectedVoxel);
    expect(firstChunk.fluid[firstIndex]).toBe(first.expectedFluid);
    expect(firstChunk.revision).toBe(0);
    expect(server.worldRevision).toBe(0);
    expect(server.mutationCount).toBe(0);
  });

  it('rejects a world revision or adjacent-fluid change at the final validation barrier', () => {
    const revisionServer = createServer('prepared-batch-world-stale');
    const first = expectedEdit(revisionServer, [1, 31, 0], Voxel.Wood);
    const second = expectedEdit(revisionServer, [1, 32, 0], Voxel.Wood);
    const revisionPlan = revisionServer.prepareVoxelEdits('structure', [first, second]);
    const previousExternal = revisionServer.getVoxel(4, 20, 4);
    const external = expectedEdit(
      revisionServer,
      [4, 20, 4],
      previousExternal === Voxel.Stone ? Voxel.Wood : Voxel.Stone,
    );
    revisionServer.edit(external.x, external.y, external.z, external.value);
    expect(() => revisionPlan.validate()).toThrow(/stale/i);
    expect(revisionServer.getVoxel(first.x, first.y, first.z)).toBe(first.expectedVoxel);
    expect(revisionServer.getVoxel(second.x, second.y, second.z)).toBe(second.expectedVoxel);

    const neighborServer = createServer('prepared-batch-neighbor-stale');
    const lower = expectedEdit(neighborServer, [1, 31, 0], Voxel.Wood);
    const upper = expectedEdit(neighborServer, [1, 32, 0], Voxel.Wood);
    const neighborPlan = neighborServer.prepareVoxelEdits('structure', [lower, upper]);
    const neighborChunk = neighborServer.getChunk(0, 0, 0);
    neighborChunk.voxels[voxelIndex(2, 31, 0)] = Voxel.Water;
    expect(() => neighborPlan.validate()).toThrow(/adjacent fluid.*stale/i);
    expect(neighborServer.getVoxel(lower.x, lower.y, lower.z)).toBe(lower.expectedVoxel);
    expect(neighborServer.getVoxel(upper.x, upper.y, upper.z)).toBe(upper.expectedVoxel);
    expect(neighborServer.worldRevision).toBe(0);
  });
});
