import { describe, expect, it } from 'vitest';
import {
  createStoredChunkRecord,
  decodeStoredChunkRecord,
  storedChunkRecordBytes,
} from '../../src/world/chunk-snapshot-codec';

const VOXEL_COUNT = 32 ** 3;
const enabled = process.env.SEEDLANDS_PERFORMANCE_GATE === '1';

const percentile = (values: readonly number[], quantile: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
};

const buildRecord = (index: number) => {
  const procedural = Uint16Array.from({ length: VOXEL_COUNT }, (_, voxelIndex) =>
    Math.floor(voxelIndex / 1_024) < 16 ? (voxelIndex + index) % 4 : 0,
  );
  const current = procedural.slice();
  if (index < 512) {
    const count = 1 + (index % 64);
    for (let edit = 0; edit < count; edit += 1) current[(edit * 499 + index * 37) % VOXEL_COUNT] = 8;
  } else if (index < 896) {
    for (let voxelIndex = 0; voxelIndex < VOXEL_COUNT; voxelIndex += 1)
      current[voxelIndex] = (Math.floor(voxelIndex / 1_024) + index) % 8;
  } else {
    for (let voxelIndex = 0; voxelIndex < VOXEL_COUNT; voxelIndex += 1)
      current[voxelIndex] = (Math.imul(voxelIndex + 1, index + 17) >>> 3) % 9;
  }
  const identity = {
    worldId: 'codec-performance-world',
    seedText: 'codec-performance-seed',
    cx: index,
    cy: 0,
    cz: 0,
    revision: 1,
    formatVersion: 1,
    voxelSchemaVersion: 1,
    generatorVersion: 2,
  };
  return {
    identity,
    procedural,
    current,
    record: createStoredChunkRecord({ ...identity, voxels: current, proceduralVoxels: procedural }),
  };
};

describe.runIf(enabled)('Chunk snapshot codec performance gate', () => {
  it('measures the 1,024-Chunk corpus size and active-working-set decode runtime', () => {
    const corpus = Array.from({ length: 1_024 }, (_, index) => buildRecord(index));
    const encodedBytes = corpus.reduce((total, fixture) => total + storedChunkRecordBytes(fixture.record), 0);
    const rawBytes = corpus.length * VOXEL_COUNT * Uint16Array.BYTES_PER_ELEMENT;
    const legacyJsonBytes = corpus.reduce(
      (total, fixture) => total + new TextEncoder().encode(JSON.stringify([...fixture.current])).byteLength,
      0,
    );
    const legacySnapshots = corpus.map((fixture) => JSON.stringify([...fixture.current]));
    const codecs = corpus.reduce<Record<string, number>>((counts, fixture) => {
      counts[fixture.record.codec] = (counts[fixture.record.codec] ?? 0) + 1;
      return counts;
    }, {});
    const binarySamples: number[] = [];
    const legacySamples: number[] = [];
    for (let round = 0; round < 27; round += 1) {
      const fixtureIndexes = Array.from({ length: 8 }, (_, index) => (round * 31 + index * 127) % corpus.length);
      let startedAt = performance.now();
      for (const fixtureIndex of fixtureIndexes) {
        const fixture = corpus[fixtureIndex];
        decodeStoredChunkRecord(fixture.record, { ...fixture.identity, proceduralVoxels: fixture.procedural });
      }
      binarySamples.push(performance.now() - startedAt);
      startedAt = performance.now();
      for (const fixtureIndex of fixtureIndexes)
        Uint16Array.from(JSON.parse(legacySnapshots[fixtureIndex]) as number[]);
      legacySamples.push(performance.now() - startedAt);
    }

    const decodeP50Ms = percentile(binarySamples, 0.5);
    const decodeP95Ms = percentile(binarySamples, 0.95);
    const legacyHydrateP50Ms = percentile(legacySamples, 0.5);
    const legacyHydrateP95Ms = percentile(legacySamples, 0.95);
    const activeRawMiB = (8 * VOXEL_COUNT * Uint16Array.BYTES_PER_ELEMENT) / 1_024 ** 2;
    const result = {
      corpusChunks: corpus.length,
      rawBytes,
      encodedBytes,
      legacyJsonBytes,
      storageRatio: encodedBytes / rawBytes,
      codecs,
      activeWorkingSet: 8,
      decodeP50Ms,
      decodeP95Ms,
      decodeMiBPerSecond: activeRawMiB / (decodeP50Ms / 1_000),
      legacyHydrateP50Ms,
      legacyHydrateP95Ms,
      legacyHydrateMiBPerSecond: activeRawMiB / (legacyHydrateP50Ms / 1_000),
      binarySamplesMs: binarySamples,
      legacySamplesMs: legacySamples,
    };
    console.log(`CHUNK_PERSISTENCE_PERFORMANCE ${JSON.stringify(result)}`);
    expect(encodedBytes).toBeLessThanOrEqual(rawBytes * 0.3);
    expect(encodedBytes).toBeLessThan(legacyJsonBytes);
    expect(decodeP50Ms).toBeLessThanOrEqual(legacyHydrateP50Ms * 1.25);
  });
});
