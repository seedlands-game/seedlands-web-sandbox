import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

const compileModule = async (url, replacements = {}) => {
  let source = await readFile(url, 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { code } = await transformWithEsbuild(source, url.pathname, { loader: 'ts', target: 'es2022', format: 'esm' });
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};
const macroUrl = await compileModule(new URL('../src/macro-world.ts', import.meta.url));
const voxelUrl = await compileModule(new URL('../src/voxel.ts', import.meta.url), { "'./macro-world'": `'${macroUrl}'` });
const voxel = await import(voxelUrl);
const macro = await import(macroUrl);

const { CHUNK_SIZE, GENERATOR_VERSION, Voxel, baseVoxel, chunkKey, floorDiv, isRenderable, isSolid, mod, normalizeSeed, voxelIndex } = voxel;

assert.equal(CHUNK_SIZE, 32, 'world chunk size must remain stable');
assert.equal(isSolid(Voxel.Air), false, 'air must not collide');
assert.equal(isSolid(Voxel.Stone), true, 'solid voxel must collide');
assert.equal(isSolid(Voxel.Water), false, 'water must not collide');
assert.equal(isRenderable(Voxel.Water), true, 'water must remain renderable');
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
assert.equal(GENERATOR_VERSION, 2, 'macro worldgen must advance the save compatibility version');
const points = Array.from({ length: 49 }, (_, index) => [index - 24, (index * 11) % 40, 24 - index]);
const firstPass = new Map(points.map(([x, y, z]) => [`${x},${y},${z}`, baseVoxel(seed, x, y, z)]));
for (const [x, y, z] of [...points].reverse()) {
  assert.equal(baseVoxel(seed, x, y, z), firstPass.get(`${x},${y},${z}`), 'base world must not depend on sampling order');
}

const macroPoints = Array.from({ length: 81 }, (_, index) => [((index % 9) - 4) * 192, (Math.floor(index / 9) - 4) * 192]);
const signature = macro.macroSignature(seed, macroPoints);
assert.equal(macro.macroSignature(seed, [...macroPoints].reverse()), signature, 'macro signature must not depend on query order');
assert.notEqual(signature, macro.macroSignature(normalizeSeed('hardening-determinism-other'), macroPoints), 'different seeds must produce distinct macro layouts');
for (const [x, z] of [[31, 73], [255, -91], [-1, 255], [-257, -257]]) {
  const before = macro.macroAt(seed, x, z), afterX = macro.macroAt(seed, x + 1, z), afterZ = macro.macroAt(seed, x, z + 1);
  assert.ok(Math.abs(before.terrainHeight - afterX.terrainHeight) <= 5 && Math.abs(before.terrainHeight - afterZ.terrainHeight) <= 5, 'terrain must remain continuous across chunk and region boundaries');
  assert.ok(Math.abs(before.temperature - afterX.temperature) < .03 && Math.abs(before.humidity - afterZ.humidity) < .03, 'climate must remain continuous across chunk and region boundaries');
}
let riverBoundary = null;
outer: for (let x = -1536; x <= 1536; x += 384) for (let z = -1536; z <= 1536; z += 384) for (const river of macro.riverDescriptorsNear(seed, x, z)) {
  for (let index = 1; index < river.path.length; index += 1) {
    const [ax, az] = river.path[index - 1], [bx, bz] = river.path[index];
    const crossesX = floorDiv(ax, CHUNK_SIZE) !== floorDiv(bx, CHUNK_SIZE);
    const crossesZ = floorDiv(az, CHUNK_SIZE) !== floorDiv(bz, CHUNK_SIZE);
    if (!crossesX && !crossesZ) continue;
    const axis = crossesX ? 0 : 1;
    const start = axis === 0 ? ax : az, end = axis === 0 ? bx : bz;
    const boundary = (floorDiv(Math.min(start, end), CHUNK_SIZE) + 1) * CHUNK_SIZE;
    const t = (boundary - start) / (end - start);
    if (t <= 0 || t >= 1) continue;
    const crossX = ax + (bx - ax) * t, crossZ = az + (bz - az) * t;
    const first = axis === 0 ? macro.macroAt(seed, boundary - .25, crossZ) : macro.macroAt(seed, crossX, boundary - .25);
    const second = axis === 0 ? macro.macroAt(seed, boundary + .25, crossZ) : macro.macroAt(seed, crossX, boundary + .25);
    if (first.hydrology.id === river.id && second.hydrology.id === river.id) { riverBoundary = river.id; break outer; }
  }
}
assert.ok(riverBoundary, 'a canonical river must remain continuous across a chunk boundary');

const meshUrl = await compileModule(new URL('../src/world-mesh.ts', import.meta.url), { "'./voxel'": `'${voxelUrl}'`, "'./macro-world'": `'${macroUrl}'` });
const storageUrl = await compileModule(new URL('../src/world-storage.ts', import.meta.url), { "'./voxel'": `'${voxelUrl}'` });
const { makeChunk, meshChunk } = await import(meshUrl);
const { decodeWorldSave, encodeWorldSave } = await import(storageUrl);

const sumIndices = (meshes) => Object.values(meshes).reduce((sum, mesh) => sum + mesh.indices.length, 0);
const meshSynthetic = (voxels) => {
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  voxels.forEach(([x, y, z, value]) => { data[voxelIndex(x, y, z)] = value; });
  return meshChunk({ seed, cx: 0, cy: 3, cz: 0, data, changes: [], outside: () => Voxel.Air });
};

assert.equal(sumIndices(meshSynthetic([])), 0, 'an empty chunk must have no geometry');
assert.equal(sumIndices(meshSynthetic([[0, 0, 0, Voxel.Stone]])), 36, 'a single voxel must have six visible faces');
assert.equal(sumIndices(meshSynthetic([[0, 0, 0, Voxel.Stone], [1, 0, 0, Voxel.Stone]])), 36, 'adjacent matching voxels must cull the shared face and greedily merge');
assert.equal(sumIndices(meshSynthetic([[0, 0, 0, Voxel.Stone], [1, 0, 0, Voxel.Dirt]])), 60, 'adjacent materials must still cull their shared face without merging material groups');
assert.equal(sumIndices(meshSynthetic([[31, 31, 31, Voxel.Stone]])), 36, 'a chunk-edge voxel must retain its exterior faces');
const dense = new Uint16Array(CHUNK_SIZE ** 3).fill(Voxel.Stone);
assert.equal(sumIndices(meshChunk({ seed, cx: 0, cy: 3, cz: 0, data: dense, changes: [], outside: () => Voxel.Air })), 36, 'a solid chunk must greedily reduce to six quads');

for (const [cx, cy, cz] of [[-2, 0, 1], [0, 1, 0], [3, 0, -4]]) {
  const direct = makeChunk(seed, cx, cy, cz, []);
  const reordered = makeChunk(seed, cx, cy, cz, []).slice();
  assert.deepEqual(reordered, direct, 'chunk generation must be independent of invocation order');
}

const mutation = [[-33, 20, 32, Voxel.Air], [32, 21, -1, Voxel.Wood]];
const encoded = encodeWorldSave('roundtrip-seed', [1.5, 34, -2], mutation);
assert.deepEqual(decodeWorldSave(encoded), { seed: 'roundtrip-seed', generatorVersion: 2, player: [1.5, 34, -2], changes: mutation }, 'save codec must round-trip seed, version, player, and mutations');
assert.equal(decodeWorldSave(JSON.stringify({ seed: 'roundtrip-seed', generatorVersion: 1, player: [0, 0, 0], changes: [] })), null, 'a generator-version mismatch must not restore an incompatible world');

console.log('Voxel deterministic checks passed.');
