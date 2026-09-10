import { describe, expect, it } from 'vitest';
import { createHaloStaged } from '../apps/web/src/compute/halo-kernel';
import { makeChunk } from '../packages/game-core/src/world/chunk-generation';
import { createProceduralMeshInput } from '../packages/game-core/src/world/mesh';
import { COAL_ORE_SALT, IRON_ORE_SALT, oreHash, oreVoxel } from '../packages/game-core/src/world/ore-generation';
import { macroAt } from '../packages/game-core/src/world/macro-world';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../packages/game-core/src/world/voxel';

describe('S4 deterministic V4 ore generation', () => {
  it('freezes the 32-bit integer hash including negative groups', () => {
    expect([
      oreHash(0, 0, 0, 0, COAL_ORE_SALT),
      oreHash(1837, 4, -9, 12, COAL_ORE_SALT),
      oreHash(0xffffffff, -1, -1, -1, IRON_ORE_SALT),
      oreHash(0x80000000, -1234567, 765432, -42, IRON_ORE_SALT),
    ]).toEqual([686038650, 2132735606, 2792393888, 3339286873]);
  });

  it('only replaces sufficiently deep base Stone and gives iron precedence', () => {
    const terrainHeight = 20;
    expect(oreVoxel(7, 0, 19, 0, terrainHeight, Voxel.Stone, 4)).toBe(Voxel.Stone);
    expect(oreVoxel(7, 0, 0, 0, terrainHeight, Voxel.Dirt, 4)).toBe(Voxel.Dirt);
    expect(oreVoxel(7, 0, 0, 0, terrainHeight, Voxel.Water, 4)).toBe(Voxel.Water);
    expect(oreVoxel(7, 0, 0, 0, terrainHeight, Voxel.Stone, 3)).toBe(Voxel.Stone);

    let coal: readonly [number, number, number] | undefined;
    let iron: readonly [number, number, number] | undefined;
    let overlap: readonly [number, number, number] | undefined;
    for (let z = -64; z <= 64 && (!coal || !iron); z += 2)
      for (let x = -64; x <= 64 && (!coal || !iron); x += 2) {
        const value = oreVoxel(1837, x, 0, z, terrainHeight, Voxel.Stone, 4);
        if (value === Voxel.CoalOre) coal = [x, 0, z];
        if (value === Voxel.IronOre) iron = [x, 0, z];
      }
    expect(coal).toBeDefined();
    expect(iron).toBeDefined();
    for (let groupZ = -128; groupZ <= 128 && !overlap; groupZ += 1)
      for (let groupX = -128; groupX <= 128 && !overlap; groupX += 1) {
        const groupY = 0;
        if (
          oreHash(1837, groupX, groupY, groupZ, IRON_ORE_SALT) % 97 < 6 &&
          oreHash(1837, groupX, groupY, groupZ, COAL_ORE_SALT) % 97 < 10
        )
          overlap = [groupX * 2, groupY * 2, groupZ * 2];
      }
    expect(overlap).toBeDefined();
    expect(oreVoxel(1837, overlap![0], overlap![1], overlap![2], terrainHeight, Voxel.Stone, 4)).toBe(Voxel.IronOre);
  });

  it('groups ores in world 2x2x2 cells across negative and chunk boundaries', () => {
    for (const [x, y, z] of [
      [-1, -1, -1],
      [31, -9, 31],
      [32, -9, 32],
    ] as const) {
      const expected = oreVoxel(0x12345678, x, y, z, 32, Voxel.Stone, 4);
      for (const dx of [0, 1])
        for (const dy of [0, 1])
          for (const dz of [0, 1]) {
            const gx = Math.floor(x / 2) * 2 + dx;
            const gy = Math.floor(y / 2) * 2 + dy;
            const gz = Math.floor(z / 2) * 2 + dz;
            expect(oreVoxel(0x12345678, gx, gy, gz, 32, Voxel.Stone, 4)).toBe(expected);
          }
    }
  });

  it('changes only deep Stone in actual V4 chunks and preserves surface features', () => {
    let oreCount = 0;
    for (const [seed, cx, cy, cz] of [
      [1837, 0, 0, 0],
      [1, 13, 0, -2],
      [0xffffffff, -2, -1, 3],
    ] as const) {
      const v3 = makeChunk(seed, cx, cy, cz, [], 3);
      const v4 = makeChunk(seed, cx, cy, cz, [], 4);
      for (let y = 0; y < CHUNK_SIZE; y += 1)
        for (let z = 0; z < CHUNK_SIZE; z += 1)
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            const index = voxelIndex(x, y, z);
            if (v3[index] === v4[index]) continue;
            const worldX = cx * CHUNK_SIZE + x;
            const worldY = cy * CHUNK_SIZE + y;
            const worldZ = cz * CHUNK_SIZE + z;
            const depth = macroAt(seed, worldX, worldZ, 4).terrainHeight - worldY;
            expect(v3[index]).toBe(Voxel.Stone);
            expect(v4[index] === Voxel.CoalOre || v4[index] === Voxel.IronOre).toBe(true);
            expect(depth).toBeGreaterThanOrEqual(v4[index] === Voxel.IronOre ? 8 : 4);
            oreCount += 1;
          }
    }
    expect(oreCount).toBeGreaterThan(0);
  });

  it('preserves explicit chunk edits, canonical data, overlays, and halo revision parity', () => {
    const seed = 1837;
    const canonical = makeChunk(seed, -1, -1, 0, [], 4);
    const edited = makeChunk(seed, -1, -1, 0, [[-32, -32, 0, Voxel.Workbench]], 4);
    expect(edited[voxelIndex(0, 0, 0)]).toBe(Voxel.Workbench);

    canonical[voxelIndex(0, 0, 0)] = Voxel.Chest;
    const overlayVoxels = makeChunk(seed, 0, -1, 0, [], 4);
    overlayVoxels[voxelIndex(0, 0, 0)] = Voxel.Furnace;
    const options = {
      seed,
      cx: -1,
      cy: -1,
      cz: 0,
      generatorVersion: 4,
      canonical,
      overlays: [{ cx: 0, cy: -1, cz: 0, voxels: overlayVoxels }],
    };
    const direct = createProceduralMeshInput(options);
    const staged = createHaloStaged(options);
    expect(direct.canonical).toBe(canonical);
    expect(direct.halo[1 + 34 * (1 + 34)]).toBe(Voxel.Chest);
    expect(direct.halo[33 + 34 * (1 + 34)]).toBe(overlayVoxels[voxelIndex(0, 0, 0)]);
    expect(staged.halo).toEqual(direct.halo);
    expect(staged.fluidHalo).toEqual(direct.fluidHalo);
    expect(staged.haloRevision).toBe(direct.haloRevision);
    expect(staged.proceduralVoxelSamples).toBeGreaterThan(0);
    expect(canonical).toHaveLength(CHUNK_SIZE ** 3);
  });
});
