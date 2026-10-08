import { describe, expect, it } from 'vitest';
import { buildBlockLightVolume, sampleBlockLight, voxelEmission } from '../../src/world/voxel-light';
import { sampleLight } from '../../src/server/gameplay/light-sampler';
import { createVoxelSemanticsRegistry, type VoxelSemanticsDefinition } from '../../src/world/voxel-semantics';

const Voxel = { Air: 0, Wall: 1, BrightSource: 100, WarmSource: 101, DimSource: 102 } as const;
const definition = (id: string, storageId: number, emission: number, lightCost: number): VoxelSemanticsDefinition => ({
  id,
  storageId,
  solid: lightCost >= 16,
  targetable: storageId !== Voxel.Air,
  renderable: storageId !== Voxel.Air,
  meshKind: 'cube',
  emission,
  lightCost,
  faceMaterials: [1, 1, 1, 1, 1, 1],
});
const semantics = createVoxelSemanticsRegistry([
  definition('sample:air', Voxel.Air, 0, 1),
  definition('sample:wall', Voxel.Wall, 0, 16),
  definition('sample:bright-source', Voxel.BrightSource, 15, 1),
  definition('sample:warm-source', Voxel.WarmSource, 14, 1),
  definition('sample:dim-source', Voxel.DimSource, 9, 1),
]);

describe('composed block light', () => {
  it.each([Voxel.BrightSource, Voxel.WarmSource, Voxel.DimSource])(
    'lights the adjacent cell from synthetic source %i in both consumers',
    (source) => {
      const get = (x: number, y: number, z: number) => (x === 0 && y === 0 && z === 0 ? source : Voxel.Air);
      const volume = buildBlockLightVolume(31, [-15, -15, -15], get, semantics);
      expect(sampleBlockLight(volume, 1, 0, 0)).toBe(voxelEmission(source, semantics) - 1);
      expect(sampleLight([1, 0, 0], 0, ([x, y, z]) => get(x, y, z), semantics)?.block).toBe(
        voxelEmission(source, semantics) - 1,
      );
    },
  );
  it('blocks a sealed wall but propagates around an opening', () => {
    const source = (x: number, y: number, z: number) => (x === -2 && y === 0 && z === 0 ? Voxel.WarmSource : Voxel.Air);
    const sealed = (x: number, y: number, z: number) => (x === 0 ? Voxel.Wall : source(x, y, z));
    expect(sampleBlockLight(buildBlockLightVolume(31, [-15, -15, -15], sealed, semantics), 2, 0, 0)).toBe(0);
    expect(sampleLight([2, 0, 0], 0, ([x, y, z]) => sealed(x, y, z), semantics)?.block).toBe(0);
    const open = (x: number, y: number, z: number) => (x === 0 && y !== 2 ? Voxel.Wall : source(x, y, z));
    expect(sampleBlockLight(buildBlockLightVolume(31, [-15, -15, -15], open, semantics), 2, 0, 0)).toBe(6);
  });
  it('has no point-light count cap and clears removed sources across a chunk boundary', () => {
    const lit = buildBlockLightVolume(
      40,
      [20, -10, -10],
      (x, y, z) => (x === 32 && y === 0 && z >= 0 && z < 10 ? Voxel.WarmSource : Voxel.Air),
      semantics,
    );
    expect(sampleBlockLight(lit, 31, 0, 9)).toBe(13);
    const removed = buildBlockLightVolume(40, [20, -10, -10], () => Voxel.Air, semantics);
    expect(sampleBlockLight(removed, 31, 0, 9)).toBe(0);
  });
  it('treats an unavailable chunk as opaque, so a pending baseline cannot leak light', () => {
    const voxel = (x: number, y: number, z: number) => (x === -1 && y === 0 && z === 0 ? Voxel.WarmSource : Voxel.Air);
    const pending = (x: number, y: number, z: number) => (x === 0 ? undefined : voxel(x, y, z));
    expect(sampleBlockLight(buildBlockLightVolume(31, [-15, -15, -15], pending, semantics), 1, 0, 0)).toBe(0);
  });
});
