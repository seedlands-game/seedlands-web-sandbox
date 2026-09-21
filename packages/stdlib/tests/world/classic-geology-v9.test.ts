import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { makeChunk } from '../../src/world/chunk-generation';
import { Voxel, normalizeSeed } from '../../src/world/voxel';
import { geologyVoxelFromColumn } from '../../src/world/geology';

const hashChunk = (chunk: Uint16Array) => {
  const bytes = Buffer.allocUnsafe(chunk.byteLength);
  chunk.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  return createHash('sha256').update(bytes).digest('hex');
};

it('冻结 V8 深层区块并让 V9 才启用新地质层', () => {
  expect(hashChunk(makeChunk(1837, -1, -2, 0, [], 8))).toBe(
    '23048253e362d35e6375ad051512dcaf09e6aa883cec953e1fee8916aa3a997a',
  );
  expect(makeChunk(1837, -1, -2, 0, [], 8).some((voxel) => voxel >= Voxel.Bedrock)).toBe(false);
  expect(makeChunk(1837, 0, 0, 0, [], 9).includes(Voxel.Bedrock)).toBe(true);
});

it('V9 生成基岩、砂砾、青金石、黏土、冰与雪块且遵守位置约束', () => {
  const seed = normalizeSeed('classic-geology-v9');
  const found = new Set<number>();
  for (let x = -96; x <= 96; x++)
    for (let z = -96; z <= 96; z++)
      for (const [y, biome, water, base] of [
        [0, 'plains', null, Voxel.Stone],
        [12, 'plains', null, Voxel.Stone],
        [20, 'wet', 22, Voxel.Dirt],
        [22, 'cold', 22, Voxel.Water],
        [19, 'cold', null, Voxel.Dirt],
      ] as const) {
        const voxel = geologyVoxelFromColumn(seed, x, y, z, 20, biome, water, base, 9);
        if (
          [Voxel.Bedrock, Voxel.Gravel, Voxel.LapisOre, Voxel.Clay, Voxel.Ice, Voxel.SnowBlock].includes(voxel as never)
        )
          found.add(voxel);
        if (voxel === Voxel.Bedrock) expect(y).toBeLessThan(5);
        if (voxel === Voxel.LapisOre) expect(y).toBeLessThan(32);
      }
  expect([...found].sort((a, b) => a - b)).toEqual(
    [Voxel.Bedrock, Voxel.Gravel, Voxel.LapisOre, Voxel.Clay, Voxel.Ice, Voxel.SnowBlock].sort((a, b) => a - b),
  );
});
