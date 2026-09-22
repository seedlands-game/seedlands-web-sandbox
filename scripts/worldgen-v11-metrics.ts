import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makeChunk } from '../packages/stdlib/src/world/chunk-generation.ts';
import { countOpenSpawnDirections, findSafePlayerSpawn } from '../packages/stdlib/src/server/gameplay/safe-spawn.ts';
import { biome, CHUNK_SIZE, normalizeSeed, Voxel, voxelIndex } from '../packages/stdlib/src/world/voxel.ts';

const seeds = [
  'mosslight-68',
  'living-world-autonomy',
  'seedlands-shell-journey',
  'seedlands-regression',
  'seedlands-mvp-river',
  'seedlands-mvp-highland',
  'classic-visual-v3',
  'phase1-final-creative',
  'oak-camp',
  'riverbank-01',
  'forest-path-02',
  'plains-home-03',
  'wetland-04',
  'dry-start-05',
  'cold-start-06',
  'mountain-pass-07',
  'ember-11',
  'quartz-12',
  'cedar-13',
  'willow-14',
  'copper-15',
  'maple-16',
  'birch-17',
  'spruce-18',
] as const;

const vegetation = new Set<number>([Voxel.TallGrass, Voxel.Flower, Voxel.Mushroom, Voxel.SugarCane, Voxel.Cactus]);

function sampleWorld(seed: number, generatorVersion: number) {
  const chunks = new Map<string, Uint16Array>();
  return (x: number, y: number, z: number) => {
    const cx = Math.floor(x / CHUNK_SIZE),
      cy = Math.floor(y / CHUNK_SIZE),
      cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cy},${cz}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = makeChunk(seed, cx, cy, cz, [], generatorVersion);
      chunks.set(key, chunk);
    }
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk[voxelIndex(lx, ly, lz)];
  };
}

const ground = new Set<number>([Voxel.Grass, Voxel.Dirt, Voxel.Stone, Voxel.Sand, Voxel.Snow]);

const surfaceY = (read: ReturnType<typeof sampleWorld>, x: number, z: number) => {
  for (let y = 128; y >= 0; y--) {
    const value = read(x, y, z);
    if (ground.has(value)) return y;
  }
  return 0;
};

function chunkHash(seed: number, generatorVersion: number) {
  const hash = createHash('sha256');
  for (const [cx, cy, cz] of [
    [0, 0, 0],
    [-1, 0, -1],
    [1, 0, 1],
  ] as const) {
    const chunk = makeChunk(seed, cx, cy, cz, [], generatorVersion);
    hash.update(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return hash.digest('hex');
}

function measure(seedText: string, generatorVersion: number, spawnPolicyVersion: number, candidate: string) {
  const seed = normalizeSeed(seedText);
  const read = sampleWorld(seed, generatorVersion);
  const spawn = findSafePlayerSpawn(read, spawnPolicyVersion);
  if (!spawn) throw new Error(`No spawn for ${seedText} v${generatorVersion}`);
  const sx = Math.floor(spawn[0]),
    sz = Math.floor(spawn[2]);
  let treeTrunksR8 = 0,
    vegetationR8 = 0,
    leafSamples = 0,
    leafHits = 0,
    nearestTrunk = Infinity;
  for (let dz = -8; dz <= 8; dz++)
    for (let dx = -8; dx <= 8; dx++) {
      const x = sx + dx,
        z = sz + dz,
        y = surfaceY(read, x, z);
      let trunkColumn = false;
      for (let oy = 1; oy <= 8; oy++)
        if (read(x, y + oy, z) === Voxel.Wood) {
          trunkColumn = true;
          break;
        }
      if (trunkColumn) {
        treeTrunksR8++;
        nearestTrunk = Math.min(nearestTrunk, Math.hypot(dx, dz));
      }
      if (vegetation.has(read(x, y + 1, z))) vegetationR8++;
      for (let oy = 2; oy <= 6; oy++) {
        leafSamples++;
        if (read(x, Math.floor(spawn[1]) + oy, z) === Voxel.Leaves) leafHits++;
      }
    }
  const openDirections = countOpenSpawnDirections(read, sx, Math.floor(spawn[1]) - 1, sz);
  return {
    seedText,
    candidate,
    generatorVersion,
    spawnPolicyVersion,
    biome: biome(seed, sx, sz, generatorVersion),
    spawn,
    safe: read(sx, Math.floor(spawn[1]), sz) === Voxel.Air,
    treeTrunksR8,
    vegetationR8,
    leafCanopyR8: leafHits / leafSamples,
    nearestTrunk: Number.isFinite(nearestTrunk) ? nearestTrunk : null,
    openDirections,
    chunkHash: chunkHash(seed, generatorVersion),
  };
}

const firstControl = seeds.map((seed) => measure(seed, 10, 10, 'A'));
const secondControl = [...seeds].reverse().map((seed) => measure(seed, 10, 10, 'A'));
const repeatedControlBySeed = new Map(secondControl.map((row) => [row.seedText, row]));
for (const row of firstControl)
  if (JSON.stringify(row) !== JSON.stringify(repeatedControlBySeed.get(row.seedText)))
    throw new Error(`A/A mismatch for ${row.seedText}`);
const rows = [
  ...firstControl,
  ...seeds.map((seed) => measure(seed, 11, 10, 'B1+B2')),
  ...seeds.map((seed) => measure(seed, 11, 11, 'B3')),
];
const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summarize = (candidate: string) => {
  const selected = rows.filter((row) => row.candidate === candidate);
  return {
    safe: selected.filter((row) => row.safe).length,
    openRoute: selected.filter((row) => row.openDirections >= 1).length,
    treeTrunksR8Median: median(selected.map((row) => row.treeTrunksR8)),
    vegetationR8Median: median(selected.map((row) => row.vegetationR8)),
    leafCanopyR8Median: median(selected.map((row) => row.leafCanopyR8)),
    nearestTrunkMedian: median(selected.map((row) => row.nearestTrunk ?? 9)),
  };
};
const output = resolve(process.argv[2] ?? 'changes/2026-09-22-classic-worldgen-v11/metrics.json');
await writeFile(
  output,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      aaPassed: true,
      summary: { A: summarize('A'), 'B1+B2': summarize('B1+B2'), B3: summarize('B3') },
      rows,
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${rows.length} measurements to ${output}`);
