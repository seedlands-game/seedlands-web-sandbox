import { describe, expect, it } from 'vitest';
import { buildBlockLightVolume, sampleBlockLight, voxelEmission } from '../../src/world/voxel-light';
import { Voxel } from '../../src/world/voxel';
import { sampleLight } from '../../src/server/gameplay/light-sampler';

describe('Classic block light', () => {
  it.each([
    Voxel.Torch,
    Voxel.Glowstone,
    Voxel.Lava,
    Voxel.Fire,
    Voxel.JackOLantern,
    Voxel.LitFurnace,
    Voxel.LitRedstoneOre,
    Voxel.Lantern,
  ])('lights the adjacent cell from source %i in both consumers', (source) => {
    const get = (x: number, y: number, z: number) => (x === 0 && y === 0 && z === 0 ? source : Voxel.Air);
    const volume = buildBlockLightVolume(31, [-15, -15, -15], get);
    expect(sampleBlockLight(volume, 1, 0, 0)).toBe(voxelEmission(source) - 1);
    expect(sampleLight([1, 0, 0], 0, ([x, y, z]) => get(x, y, z))?.block).toBe(voxelEmission(source) - 1);
  });
  it('blocks a sealed wall but propagates around an opening', () => {
    const source = (x: number, y: number, z: number) => (x === -2 && y === 0 && z === 0 ? Voxel.Torch : Voxel.Air);
    const sealed = (x: number, y: number, z: number) => (x === 0 ? Voxel.Stone : source(x, y, z));
    expect(sampleBlockLight(buildBlockLightVolume(31, [-15, -15, -15], sealed), 2, 0, 0)).toBe(0);
    expect(sampleLight([2, 0, 0], 0, ([x, y, z]) => sealed(x, y, z))?.block).toBe(0);
    const open = (x: number, y: number, z: number) => (x === 0 && y !== 2 ? Voxel.Stone : source(x, y, z));
    expect(sampleBlockLight(buildBlockLightVolume(31, [-15, -15, -15], open), 2, 0, 0)).toBe(6);
  });
  it('has no point-light count cap and clears removed sources across a chunk boundary', () => {
    const lit = buildBlockLightVolume(40, [20, -10, -10], (x, y, z) =>
      x === 32 && y === 0 && z >= 0 && z < 10 ? Voxel.Torch : Voxel.Air,
    );
    expect(sampleBlockLight(lit, 31, 0, 9)).toBe(13);
    const removed = buildBlockLightVolume(40, [20, -10, -10], () => Voxel.Air);
    expect(sampleBlockLight(removed, 31, 0, 9)).toBe(0);
  });
  it('treats an unavailable chunk as opaque, so a pending baseline cannot leak light', () => {
    const voxel = (x: number, y: number, z: number) => (x === -1 && y === 0 && z === 0 ? Voxel.Torch : Voxel.Air);
    const pending = (x: number, y: number, z: number) => (x === 0 ? undefined : voxel(x, y, z));
    expect(sampleBlockLight(buildBlockLightVolume(31, [-15, -15, -15], pending), 1, 0, 0)).toBe(0);
  });
});
