import { testWorldgenExecutableProvider } from '../support/worldgen';
import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { GameServer, type ServerChunk } from '../../src/server/game-server';
import { commitFluidCandidate } from '../../src/server/fluid/fluid-candidate-commit';
import { FLUID_TRANSACTION_PROTOCOL_VERSION, type FluidCandidate } from '../../src/server/fluid/fluid-transaction';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../../src/world/voxel';

describe('权威世界提交碰撞增量', () => {
  it('单格放水携带连续revision与最终voxel/fluid字节', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'collision-delta-single',
    });
    const index = voxelIndex(1, 20, 1);
    server.getChunk(0, 0, 0);

    const result = server.edit(1, 20, 1, Voxel.Water, 'player-edit');

    expect(result.collisionDelta).toEqual([
      {
        key: '0,0,0',
        previousRevision: 0,
        revision: 1,
        cells: [{ index, voxel: Voxel.Water, fluid: 0x88 }],
      },
    ]);
  });

  it('批量事务只发送真正改变的最终格并保持每Chunk revision边界', () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'collision-delta-batch',
    });
    server.getChunk(0, 3, 0);
    server.getChunk(1, 3, 0);
    const unchanged = server.getVoxel(2, 100, 2);

    const result = server.editBatch({
      actorId: 'fixture',
      edits: [
        { x: 1, y: 100, z: 1, value: Voxel.Stone },
        { x: 2, y: 100, z: 2, value: unchanged },
        { x: 33, y: 100, z: 1, value: Voxel.Dirt },
      ],
    });

    expect(result.collisionDelta).toEqual([
      {
        key: '0,3,0',
        previousRevision: 0,
        revision: 1,
        cells: [{ index: voxelIndex(1, 4, 1), voxel: Voxel.Stone, fluid: 0 }],
      },
      {
        key: '1,3,0',
        previousRevision: 0,
        revision: 1,
        cells: [{ index: voxelIndex(1, 4, 1), voxel: Voxel.Dirt, fluid: 0 }],
      },
    ]);
  });

  it('流体候选提交发送Worker已验证的最终体素和流体值', () => {
    const chunk: ServerChunk = {
      key: '0,0,0',
      cx: 0,
      cy: 0,
      cz: 0,
      voxels: new Uint16Array(CHUNK_SIZE ** 3),
      fluid: new Uint8Array(CHUNK_SIZE ** 3),
      revision: 4,
      persistedRevision: 4,
      dirty: false,
      materialized: true,
      accessEpoch: 1,
    };
    const candidate: FluidCandidate = {
      protocolVersion: FLUID_TRANSACTION_PROTOCOL_VERSION,
      epoch: 1,
      workId: 'fluid-delta',
      readSet: [{ key: chunk.key, revision: chunk.revision }],
      writes: [
        {
          position: [3, 20, 4],
          expectedVoxel: Voxel.Air,
          expectedFluid: 0,
          voxel: Voxel.Water,
          fluid: 0x07,
        },
      ],
      consumedFrontier: [],
      nextFrontier: [],
      needsRescan: false,
    };
    const chunks = new Map([[chunk.key, chunk]]);

    const result = commitFluidCandidate({
      candidate,
      chunks,
      worldRevision: 8,
      addMutationCount: () => undefined,
      setWorldRevision: () => undefined,
    });

    expect(result.collisionDelta).toEqual([
      {
        key: '0,0,0',
        previousRevision: 4,
        revision: 5,
        cells: [{ index: voxelIndex(3, 20, 4), voxel: Voxel.Water, fluid: 0x07 }],
      },
    ]);
  });
});
