import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeChunk } from '../../src/world/chunk-generation';
import { Voxel, normalizeSeed } from '../../src/world/voxel';

const chunkHash = (chunk: Uint16Array) =>
  createHash('sha256')
    .update(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
    .digest('hex');

const representativeChunks = [
  ['mosslight-68', 0, 0, 0],
  ['forest-path-02', 0, 0, 0],
  ['living-world-autonomy', -1, 0, 1],
  ['seedlands-regression', 1, 0, -1],
] as const;

describe('V11 tree and vegetation world generation', () => {
  it('freezes representative V10 forest and vegetation chunk bytes', () => {
    const hashes = representativeChunks.map(([rawSeed, cx, cy, cz]) =>
      chunkHash(makeChunk(normalizeSeed(rawSeed), cx, cy, cz, [], 10)),
    );

    expect(hashes).toEqual([
      'e40c404703fc31fab0eab00aac4ef6dd52487cdd90518d29aab19245d9e620e1',
      '0d7211868cb51c9ed35b0befe4dbd9e5edbd209cc39a0856e28d93209fa533de',
      '2fece314dc16a1c94250d8c3c36a7d2af398fb51fc4ef3799786c8ae2067ed99',
      '219cf603dd74800409e1bbcc1af0e85f51123d2a0659d22b7a16ca8d19947fdc',
    ]);
  });

  it('uses a deterministic V11-only tree and vegetation candidate', () => {
    const [rawSeed, cx, cy, cz] = representativeChunks[0];
    const seed = normalizeSeed(rawSeed);
    const v10 = makeChunk(seed, cx, cy, cz, [], 10);
    const firstV11 = makeChunk(seed, cx, cy, cz, [], 11);
    const secondV11 = makeChunk(seed, cx, cy, cz, [], 11);

    expect(firstV11).toEqual(secondV11);
    expect(chunkHash(firstV11)).toBe('943fabb4a301f64cb589e74fd57dd6f210eaa66eb49307a9348a858cadb8be5c');
    expect(firstV11).not.toEqual(v10);
    expect(firstV11.includes(Voxel.Wood)).toBe(true);
    expect(firstV11.includes(Voxel.Leaves)).toBe(true);
  });
});
