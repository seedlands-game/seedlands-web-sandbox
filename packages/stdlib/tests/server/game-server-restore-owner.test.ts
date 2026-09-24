import { describe, expect, it } from 'vitest';
import { GameServer } from '../../src/server/game-server';
import { computeFluidCandidate } from '../../src/server/fluid/fluid-transaction';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { CHUNK_SIZE, Voxel, floorDiv, mod, voxelIndex } from '../../src/world/voxel';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenExecutableProvider } from '../support/worldgen';

const options = (persistence: MemoryGamePersistence) => ({
  platform: testCorePlatform,
  worldgenProvider: testWorldgenExecutableProvider,
  seedText: 'restore-owner',
  persistence,
});

const preparedEdit = (server: GameServer, x: number, value: number) => {
  return server.prepareVoxelEdit('restore-owner-test', [x, 20, 0], value);
};

const preparedBatch = (server: GameServer, x: number, value: number) => {
  const y = 20,
    z = 0;
  const chunk = server.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
  const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  return server.prepareVoxelEdits('restore-owner-test', [
    { x, y, z, value, expectedVoxel: chunk.voxels[index]!, expectedFluid: chunk.fluid[index]! },
  ]);
};

const fluidCandidate = (server: GameServer) => {
  server.setFluidActiveChunks(['0,1,0']);
  const work = server.requestFluidWork();
  if (!work) throw new Error('Expected fluid work.');
  return computeFluidCandidate(work);
};

describe('GameServer restore owner binding', () => {
  it('uses the replacement Kernel owner while rejecting world and fluid work prepared before restore', async () => {
    const persistence = new MemoryGamePersistence({ clone: structuredClone });
    const server = new GameServer(options(persistence));
    server.editBatch({
      actorId: 'setup',
      edits: [
        { x: 1, y: 20, z: 0, value: Voxel.Stone },
        { x: 2, y: 20, z: 0, value: Voxel.Stone },
        { x: 1, y: 49, z: 0, value: Voxel.Stone },
        { x: 1, y: 50, z: 0, value: Voxel.Water },
      ],
    });
    await server.save();
    const oldSingle = preparedEdit(server, 1, Voxel.Wood);
    const oldBatch = preparedBatch(server, 2, Voxel.Wood);
    const oldFluid = fluidCandidate(server);

    await server.restore();

    expect(() => oldSingle.validate()).toThrow(/disposed|stale/i);
    expect(() => oldBatch.validate()).toThrow(/disposed|stale/i);
    expect(server.commitFluidCandidate(oldFluid)).toEqual({ accepted: false, reason: 'work-id' });
    server.getChunk(0, 0, 0);
    const next = preparedEdit(server, 1, Voxel.Wood);
    next.validate();
    expect(next.apply()).toMatchObject({ committed: true });
    expect(server.getVoxel(1, 20, 0)).toBe(Voxel.Wood);
    server.editBatch({
      actorId: 'new-fluid',
      edits: [
        { x: 3, y: 49, z: 0, value: Voxel.Stone },
        { x: 3, y: 50, z: 0, value: Voxel.Water },
      ],
    });
    const nextFluid = fluidCandidate(server);
    expect(nextFluid.epoch).toBeGreaterThan(oldFluid.epoch);
    expect(server.commitFluidCandidate(nextFluid)).toMatchObject({ accepted: true });
  });

  it('keeps the current owner and prepared world/fluid work usable when restore fails', async () => {
    const worldPersistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: { version: 4 } });
    const world = new GameServer(options(worldPersistence));
    world.edit(1, 20, 0, Voxel.Stone, 'setup');
    const edit = preparedEdit(world, 1, Voxel.Wood);
    await expect(world.restore()).rejects.toThrow(/snapshot/i);
    edit.validate();
    expect(edit.apply()).toMatchObject({ committed: true });

    const batchPersistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: { version: 4 } });
    const batch = new GameServer(options(batchPersistence));
    batch.edit(2, 20, 0, Voxel.Stone, 'setup');
    const edits = preparedBatch(batch, 2, Voxel.Wood);
    await expect(batch.restore()).rejects.toThrow(/snapshot/i);
    edits.validate();
    expect(edits.apply()).toMatchObject({ committed: true });

    const fluidPersistence = new MemoryGamePersistence({ clone: structuredClone, rawGameplaySnapshot: { version: 4 } });
    const fluid = new GameServer(options(fluidPersistence));
    fluid.editBatch({
      actorId: 'setup',
      edits: [
        { x: 1, y: 49, z: 0, value: Voxel.Stone },
        { x: 1, y: 50, z: 0, value: Voxel.Water },
      ],
    });
    const candidate = fluidCandidate(fluid);
    await expect(fluid.restore()).rejects.toThrow(/snapshot/i);
    expect(fluid.commitFluidCandidate(candidate)).toMatchObject({ accepted: true });
  });
});
