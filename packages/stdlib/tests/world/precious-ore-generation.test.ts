import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { makeChunk } from '../../src/world/chunk-generation';
import { oreVoxel } from '../../src/world/ore-generation';
import { decodeWorldSave } from '../../src/world/storage';

it('V4控制字节冻结；支持版本保存仍可解析，未来 v12 拒绝', () => {
  const chunk = makeChunk(1837, -1, -2, 0, [], 4);
  const bytes = Buffer.alloc(chunk.byteLength);
  chunk.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    '23048253e362d35e6375ad051512dcaf09e6aa883cec953e1fee8916aa3a997a',
  );
  for (const generatorVersion of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    expect(
      decodeWorldSave(JSON.stringify({ seed: 'ore', generatorVersion, player: [0, 2, 0], changes: [] }))
        ?.generatorVersion,
    ).toBe(generatorVersion);
  }
  expect(
    decodeWorldSave(JSON.stringify({ seed: 'ore', generatorVersion: 12, player: [0, 2, 0], changes: [] })),
  ).toBeNull();
});

it('V5天然金钻矿只替换低处深石头，分组和旧生成版本稳定', () => {
  const v5 = makeChunk(1837, 0, 0, 0, [], 5);
  expect(v5.includes(19)).toBe(true);
  expect(v5.includes(20)).toBe(true);
  const found = new Map<number, [number, number, number]>();
  for (let z = -32; z < 32; z += 2)
    for (let x = -32; x < 32; x += 2) {
      const v = oreVoxel(1837, x, 8, z, 40, 3, 5);
      if (v === 19 || v === 20) found.set(v, [x, 8, z]);
    }
  expect([...found.keys()].sort()).toEqual([19, 20]);
  for (const [voxel, [x, y, z]] of found) {
    for (const version of [2, 3, 4]) expect([19, 20]).not.toContain(oreVoxel(1837, x, y, z, 40, 3, version));
    for (const dx of [0, 1])
      for (const dy of [0, 1])
        for (const dz of [0, 1]) expect(oreVoxel(1837, x + dx, y + dy, z + dz, 40, 3, 5)).toBe(voxel);
    expect(oreVoxel(1837, x, y, z, 40, 2, 5)).toBe(2);
    expect([19, 20]).not.toContain(oreVoxel(1837, x, -1, z, 40, 3, 5));
    expect([19, 20]).not.toContain(oreVoxel(1837, x, 32, z, 100, 3, 5));
    expect([19, 20]).not.toContain(oreVoxel(1837, x, y, z, y + 3, 3, 5));
  }
});
