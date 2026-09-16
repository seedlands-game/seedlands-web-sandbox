import { ItemIds } from '../../../../../../packages/stdlib/src/server/gameplay/item-registry';
import { GameServer } from '../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { describe, expect, it } from 'vitest';
import { prepareSingleWorldEdit } from '../../../../../../packages/stdlib/src/server/prepared-world-edit';
import { commitSingleWorldEdit } from '../../../../../../packages/stdlib/src/server/single-world-edit';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../../../../../../packages/stdlib/src/world/voxel';
import type { ServerChunk } from '../../../../../../packages/stdlib/src/server/game-server-types';

function setup() {
  let revision = 3,
    mutations = 0;
  const chunk: ServerChunk = {
    key: '0,0,0',
    cx: 0,
    cy: 0,
    cz: 0,
    voxels: new Uint16Array(CHUNK_SIZE ** 3),
    revision: 2,
    persistedRevision: 2,
    accessEpoch: 0,
    fluid: new Uint8Array(CHUNK_SIZE ** 3),
    dirty: false,
    materialized: true,
  };
  chunk.voxels[voxelIndex(1, 2, 3)] = Voxel.Stone;
  const ports = {
    getLoadedChunk: () => chunk,
    getRevision: () => revision,
    setWorldRevision: (value: number) => {
      revision = value;
    },
    addMutationCount: (value: number) => {
      mutations += value;
    },
  };
  return {
    chunk,
    ports,
    state: () => ({
      revision,
      mutations,
      voxels: [...chunk.voxels],
      chunkRevision: chunk.revision,
      dirty: chunk.dirty,
    }),
  };
}
const edit = { actorId: 'alice', x: 1, y: 2, z: 3, value: Voxel.Air };

describe('prepared single voxel participant', () => {
  it('prepares without live writes and commits exactly the existing single-edit result', () => {
    const world = setup(),
      control = setup();
    const before = world.state();
    const prepared = prepareSingleWorldEdit(world.ports, edit);
    expect(prepared.committed).toBe(true);
    expect(world.state()).toEqual(before);
    prepared.validate();
    expect(world.state()).toEqual(before);
    const result = prepared.apply();
    const expected = commitSingleWorldEdit({
      ...edit,
      worldRevision: 3,
      getChunk: () => control.chunk,
      setWorldRevision: control.ports.setWorldRevision,
      addMutationCount: control.ports.addMutationCount,
    });
    expect(result).toEqual(expected);
    expect(world.state()).toEqual(control.state());
    expect(() => prepared.apply()).toThrow(/used/i);
  });
  it('exposes an immutable final receipt before any voxel writes for registered result clone', () => {
    const world = setup();
    const before = world.state();
    const prepared = prepareSingleWorldEdit(world.ports, edit);
    const receipt = structuredClone(prepared.result);
    expect(receipt).toMatchObject({ committed: true, worldRevision: 4, structuralChange: { actorId: 'alice' } });
    expect(() => {
      prepared.result.structuralChange!.bounds!.min[0] = 99;
    }).toThrow();
    expect(world.state()).toEqual(before);
    prepared.validate();
    expect(prepared.apply()).toEqual(receipt);
  });
  it('rejects stale observed world, chunk and voxel before applying', () => {
    for (const change of ['world', 'chunk', 'voxel'] as const) {
      const world = setup();
      const prepared = prepareSingleWorldEdit(world.ports, edit);
      if (change === 'world') world.ports.setWorldRevision(4);
      if (change === 'chunk') world.chunk.revision++;
      if (change === 'voxel') world.chunk.voxels[voxelIndex(1, 2, 3)] = Voxel.Dirt;
      const before = world.state();
      expect(() => prepared.validate()).toThrow(/stale/i);
      expect(world.state()).toEqual(before);
    }
  });
  it('rejects missing chunks, invalid inputs and exhausted revisions before edits', () => {
    const world = setup(),
      before = world.state();
    expect(() => prepareSingleWorldEdit({ ...world.ports, getLoadedChunk: () => undefined }, edit)).toThrow(
      /unavailable/i,
    );
    expect(() => prepareSingleWorldEdit(world.ports, { ...edit, value: -1 })).toThrow();
    expect(() => prepareSingleWorldEdit(world.ports, { ...edit, x: Number.NaN })).toThrow();
    expect(world.state()).toEqual(before);
    world.ports.setWorldRevision(Number.MAX_SAFE_INTEGER);
    expect(() => prepareSingleWorldEdit(world.ports, edit)).toThrow(/revision/i);
    expect(world.chunk.voxels[voxelIndex(1, 2, 3)]).toBe(Voxel.Stone);
  });
  it('does not consume a no-op revision and captures caller input before apply', () => {
    const world = setup();
    const noop = prepareSingleWorldEdit(world.ports, { ...edit, value: Voxel.Stone });
    expect(noop.committed).toBe(false);
    noop.validate();
    expect(noop.apply()).toMatchObject({ committed: false, worldRevision: 3 });
    expect(world.state().mutations).toBe(0);
    const input = { ...edit, value: Number(edit.value) };
    const prepared = prepareSingleWorldEdit(world.ports, input);
    input.value = Voxel.Dirt;
    prepared.validate();
    expect(prepared.apply().collisionDelta?.[0].cells[0].voxel).toBe(Voxel.Air);
  });
  it('includes actual GameServer fluid bytes and future frontier work for water placement and removal', () => {
    const world = new GameServer({ platform: testCorePlatform, seedText: 'prepared-world-fluid' });
    const control = new GameServer({ platform: testCorePlatform, seedText: 'prepared-world-fluid' });
    const position = [1, 60, 1] as const;
    for (const server of [world, control])
      server.editBatch({
        actorId: 'alice',
        edits: [{ x: position[0], y: position[1], z: position[2], value: Voxel.Stone }],
      });
    for (const value of [Voxel.Water, Voxel.Air]) {
      const beforeRevision = world.worldRevision,
        beforeFluid = world.getFluidCell(...position);
      const prepared = world.prepareVoxelEdit('alice', position, value);
      expect(world.worldRevision).toBe(beforeRevision);
      expect(world.getFluidCell(...position)).toEqual(beforeFluid);
      expect(() => prepared.apply()).toThrow(/validation/i);
      prepared.validate();
      const result = prepared.apply();
      const expected = control.editBatch({
        actorId: 'alice',
        edits: [{ x: position[0], y: position[1], z: position[2], value }],
      });
      expect(result).toEqual(expected);
      expect(world.getVoxel(...position)).toBe(value);
      expect(world.getFluidCell(...position)).toEqual(control.getFluidCell(...position));
      expect(world.fluidDiagnostics).toEqual(control.fluidDiagnostics);
    }
    const work = world.requestFluidWork(),
      expectedWork = control.requestFluidWork();
    expect(work).toEqual(expectedWork);
    expect(work?.frontier.length).toBeGreaterThan(0);
    if (work) world.abortFluidWork(work.workId, 'test cleanup');
    if (expectedWork) control.abortFluidWork(expectedWork.workId, 'test cleanup');
  });
  it('commits actual player placement and mining through GameServer participants', () => {
    const world = new GameServer({ platform: testCorePlatform, seedText: 'prepared-player-world' });
    world.editBatch({ actorId: 'setup', edits: [{ x: 2, y: 60, z: 0, value: Voxel.Air }] });
    world.spawnPlayer({ id: 'alice', position: [0.5, 60, 0.5] });
    world.giveItem('alice', { itemId: ItemIds.WoodBlock, count: 2 });
    const revision = world.worldRevision;
    expect(world.placeVoxel('alice', [2, 60, 0])).toMatchObject({ success: true });
    expect(world.worldRevision).toBe(revision + 1);
    expect(world.getInventory('alice').slots[0]).toEqual({ itemId: ItemIds.WoodBlock, count: 1 });
    expect(world.beginBreak('alice', [2, 60, 0])).toMatchObject({ success: true });
    expect(world.advanceGameplayRules(1.2).commits).toHaveLength(1);
    expect(world.getVoxel(2, 60, 0)).toBe(Voxel.Air);
    expect(world.queryEntities({ type: 'world-item' })).toHaveLength(1);
  });
  it('does not apply stale prepared data after validation when the caller changes the world', () => {
    const world = setup();
    const prepared = prepareSingleWorldEdit(world.ports, edit);
    prepared.validate();
    world.ports.setWorldRevision(5);
    const before = world.state();
    expect(() => prepared.apply()).toThrow(/stale/i);
    expect(world.state()).toEqual(before);
  });
});
