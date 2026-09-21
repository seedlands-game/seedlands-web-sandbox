import { expect, it } from 'vitest';
import { computeFluidCandidate, type FluidAuthoritySnapshot } from '../../src/server/fluid/fluid-transaction';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../../src/world/voxel';

const snapshot = (): FluidAuthoritySnapshot => {
  const voxels = new Uint16Array(CHUNK_SIZE ** 3);
  const fluid = new Uint8Array(CHUNK_SIZE ** 3);
  const at = (x: number, y: number, z: number) => voxelIndex(x, y, z);
  voxels[at(5, 5, 5)] = Voxel.Lava;
  fluid[at(5, 5, 5)] = 0x88;
  voxels[at(5, 4, 5)] = Voxel.Stone;
  return {
    protocolVersion: 1,
    epoch: 1,
    workId: 'lava',
    frontier: [[5, 5, 5]],
    chunks: [{ key: '0,0,0', cx: 0, cy: 0, cz: 0, revision: 0, voxels, fluid }],
  };
};

it('熔岩水平按2级衰减并在接触水时固化', () => {
  expect(computeFluidCandidate(snapshot()).writes).toContainEqual(
    expect.objectContaining({ position: [6, 5, 5], voxel: Voxel.Lava, fluid: 6 }),
  );
  const mixed = snapshot();
  mixed.chunks[0].voxels[voxelIndex(6, 5, 5)] = Voxel.Water;
  mixed.chunks[0].fluid[voxelIndex(6, 5, 5)] = 0x88;
  expect(computeFluidCandidate(mixed).writes).toContainEqual(
    expect.objectContaining({ position: [5, 5, 5], voxel: Voxel.Obsidian, fluid: 0 }),
  );
});
