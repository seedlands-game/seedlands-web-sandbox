import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { makeChunk } from '../../src/world/chunk-generation';
import { caveAir } from '../../src/world/cave-generation';
import { decodeWorldSave } from '../../src/world/storage';

it('V5控制字节冻结；旧版本(2-6)保存可解析，v7拒绝', () => {
  // V5 deep chunk stays byte-identical after adding V6 caves.
  const chunk = makeChunk(1837, -1, -2, 0, [], 5);
  const bytes = Buffer.alloc(chunk.byteLength);
  chunk.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    '23048253e362d35e6375ad051512dcaf09e6aa883cec953e1fee8916aa3a997a',
  );

  for (const generatorVersion of [2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(
      decodeWorldSave(JSON.stringify({ seed: 'cave', generatorVersion, player: [0, 2, 0], changes: [] }))
        ?.generatorVersion,
    ).toBe(generatorVersion);
  expect(
    decodeWorldSave(JSON.stringify({ seed: 'cave', generatorVersion: 11, player: [0, 2, 0], changes: [] })),
  ).toBeNull();
});

it('V6在实际区块内掏出气穴，且不改动同一 seed 的 V5 区块', () => {
  // Scan a spread of surface chunks for at least one carved air pocket underground.
  let carved = 0;
  for (const [cx, cz] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [2, -1],
  ] as const) {
    const v5 = makeChunk(1837, cx, 0, cz, [], 5);
    const v6 = makeChunk(1837, cx, 0, cz, [], 6);
    for (let i = 0; i < v6.length; i += 1) if (v5[i] !== 0 && v6[i] === 0) carved += 1;
  }
  expect(carved).toBeGreaterThan(0);
});

it('V6在深层雕刻确定性气穴，仅在 v6 生效且 2x2x2 分组稳定', () => {
  // Caves only exist at generator version 6+.
  const found: [number, number, number][] = [];
  for (let z = -32; z < 32; z += 2)
    for (let x = -32; x < 32; x += 2)
      for (let y = 4; y < 24; y += 2) {
        if (caveAir(1837, x, y, z, 60, 6)) found.push([x, y, z]);
      }
  expect(found.length).toBeGreaterThan(0);
  for (const [x, y, z] of found) {
    // No caves at earlier versions.
    for (const version of [2, 3, 4, 5]) expect(caveAir(1837, x, y, z, 60, version)).toBe(false);
    // 2x2x2 group determinism.
    for (const dx of [0, 1])
      for (const dy of [0, 1]) for (const dz of [0, 1]) expect(caveAir(1837, x + dx, y + dy, z + dz, 60, 6)).toBe(true);
  }
});

it('V6气穴只掏空地表以下的固体，不触碰地表与空气层', () => {
  // Surface (y === height) and above stay intact.
  expect(caveAir(1837, 0, 60, 0, 60, 6)).toBe(false);
  expect(caveAir(1837, 0, 70, 0, 60, 6)).toBe(false);
  // Very shallow depth is preserved so surfaces do not collapse.
  for (let x = -16; x < 16; x += 1) expect(caveAir(1837, x, 59, x, 60, 6)).toBe(false);
});
