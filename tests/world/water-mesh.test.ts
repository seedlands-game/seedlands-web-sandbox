import { describe, expect, it } from 'vitest';
import { makeChunk, meshChunk } from '../../packages/game-core/src/world/mesh';
import { CHUNK_SIZE, FaceMaterial, Voxel, voxelIndex } from '../../packages/game-core/src/world/voxel';

describe('water surface mesh', () => {
  it('lowers exposed water tops and avoids a full-height hanging wall', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    data[voxelIndex(1, 1, 1)] = Voxel.Water;
    const mesh = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [] })[FaceMaterial.Water];
    const ys = [...mesh.positions].filter((_value, index) => index % 3 === 1);
    expect(Math.max(...ys)).toBe(1.875);
    expect(Math.min(...ys)).toBe(1);
  });

  it('does not emit an internal face between adjacent water cells', () => {
    const data = makeChunk(1, 0, 4, 0, []);
    data.fill(Voxel.Air);
    data[voxelIndex(1, 1, 1)] = Voxel.Water;
    data[voxelIndex(2, 1, 1)] = Voxel.Water;
    const mesh = meshChunk({ seed: 1, cx: 0, cy: 4, cz: 0, data, changes: [] })[FaceMaterial.Water];
    expect(mesh.indices.length / 6).toBe(6);
  });

  it('uses the fluid level sidecar for flowing top and side height', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    const fluid = new Uint8Array(CHUNK_SIZE ** 3);
    data[voxelIndex(1, 1, 1)] = Voxel.Water;
    fluid[voxelIndex(1, 1, 1)] = 4;
    const mesh = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, fluid, changes: [] })[FaceMaterial.Water];
    const ys = [...mesh.positions].filter((_value, index) => index % 3 === 1);
    expect(Math.max(...ys)).toBe(1.5);
    expect(Math.min(...ys)).toBe(1);
  });

  it('fills a water cell to full height when another water cell is directly above it', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    const fluid = new Uint8Array(CHUNK_SIZE ** 3);
    data[voxelIndex(1, 1, 1)] = Voxel.Water;
    data[voxelIndex(1, 2, 1)] = Voxel.Water;
    fluid[voxelIndex(1, 1, 1)] = 8;
    fluid[voxelIndex(1, 2, 1)] = 8;
    const mesh = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, fluid, changes: [] })[FaceMaterial.Water];
    const ys = new Set([...mesh.positions].filter((_value, index) => index % 3 === 1));
    expect(ys).toEqual(new Set([1, 2, 2.875]));
  });

  it('emits only the exposed height difference between neighboring water levels', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    const fluid = new Uint8Array(CHUNK_SIZE ** 3);
    data[voxelIndex(1, 1, 1)] = Voxel.Water;
    data[voxelIndex(2, 1, 1)] = Voxel.Water;
    fluid[voxelIndex(1, 1, 1)] = 8;
    fluid[voxelIndex(2, 1, 1)] = 4;
    const mesh = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, fluid, changes: [] })[FaceMaterial.Water];
    const interfaceYs: number[] = [];
    for (let offset = 0; offset < mesh.positions.length; offset += 12) {
      const positions = [...mesh.positions.slice(offset, offset + 12)];
      const xs = positions.filter((_value, index) => index % 3 === 0);
      if (xs.every((x) => x === 2)) interfaceYs.push(...positions.filter((_value, index) => index % 3 === 1));
    }
    expect(interfaceYs.sort()).toEqual([1.5, 1.5, 1.875, 1.875]);
  });

  it('preserves the full side span when greedy meshing a tall water column', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    const fluid = new Uint8Array(CHUNK_SIZE ** 3);
    for (let y = 1; y <= 4; y += 1) {
      data[voxelIndex(1, y, 1)] = Voxel.Water;
      fluid[voxelIndex(1, y, 1)] = 8;
    }
    const mesh = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, fluid, changes: [] })[FaceMaterial.Water];
    const sideIntervals: Array<[number, number]> = [];
    for (let offset = 0; offset < mesh.positions.length; offset += 12) {
      const normal = mesh.normals.slice(offset, offset + 3);
      if (normal[1] !== 0) continue;
      const ys = [...mesh.positions.slice(offset, offset + 12)].filter((_value, index) => index % 3 === 1);
      sideIntervals.push([Math.min(...ys), Math.max(...ys)]);
    }
    expect(sideIntervals).toContainEqual([1, 4]);
    expect(sideIntervals).toContainEqual([4, 4.875]);
  });
});
