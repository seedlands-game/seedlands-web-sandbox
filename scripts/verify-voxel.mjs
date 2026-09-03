import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/voxel.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'voxel.ts', { loader: 'ts', target: 'es2022', format: 'esm' });
const voxel = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const { CHUNK_SIZE, Voxel, baseVoxel, chunkKey, floorDiv, isSolid, mod, normalizeSeed, voxelIndex } = voxel;

assert.equal(CHUNK_SIZE, 32, 'world chunk size must remain stable');
assert.equal(isSolid(Voxel.Air), false, 'air must not collide');
assert.equal(isSolid(Voxel.Stone), true, 'solid voxel must collide');
assert.equal(normalizeSeed('seedlands'), normalizeSeed('seedlands'), 'seed normalization must be deterministic');
assert.notEqual(normalizeSeed('seedlands-a'), normalizeSeed('seedlands-b'), 'different seeds should not share this fixture hash');

for (const coordinate of [-65, -33, -32, -1, 0, 1, 31, 32, 65]) {
  const chunk = floorDiv(coordinate, CHUNK_SIZE);
  assert.ok(mod(coordinate, CHUNK_SIZE) >= 0 && mod(coordinate, CHUNK_SIZE) < CHUNK_SIZE, 'local coordinate must stay in chunk bounds');
  assert.equal(chunk * CHUNK_SIZE + mod(coordinate, CHUNK_SIZE), coordinate, 'world coordinate must round-trip through chunk coordinates');
}

assert.equal(voxelIndex(0, 0, 0), 0, 'first voxel index must be stable');
assert.equal(voxelIndex(31, 31, 31), CHUNK_SIZE ** 3 - 1, 'last voxel index must be stable');
assert.equal(chunkKey(-1, 0, 2), '-1,0,2', 'chunk key must preserve signed coordinates');

const seed = normalizeSeed('hardening-determinism');
const points = Array.from({ length: 49 }, (_, index) => [index - 24, (index * 11) % 40, 24 - index]);
const firstPass = new Map(points.map(([x, y, z]) => [`${x},${y},${z}`, baseVoxel(seed, x, y, z)]));
for (const [x, y, z] of [...points].reverse()) {
  assert.equal(baseVoxel(seed, x, y, z), firstPass.get(`${x},${y},${z}`), 'base world must not depend on sampling order');
}

console.log('Voxel deterministic checks passed.');
