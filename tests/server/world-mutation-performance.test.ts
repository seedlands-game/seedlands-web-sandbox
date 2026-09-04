import { readFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveFillCommand } from '../../src/server/commands/fill-command';
import { GameServer } from '../../src/server/game-server';
import { WorldMutationBuffer } from '../../src/server/world-mutation';
import { Voxel } from '../../src/world/voxel';

type PerformanceBaseline = {
  environment: { node: string; platform: string; arch: string };
  preChange: { singleEdit10000: { medianP50Ms: number; medianP95Ms: number } };
};

const baseline = JSON.parse(
  readFileSync(
    new URL('../../changes/2026-09-04-world-mutation-transaction/performance-baseline.json', import.meta.url),
    'utf8',
  ),
) as PerformanceBaseline;

const percentile = (values: readonly number[], quantile: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
};

const median = (values: readonly number[]) => percentile(values, 0.5);

function materializeFillChunks(server: GameServer): void {
  for (let cx = 0; cx <= 3; cx += 1) for (let cz = 0; cz <= 3; cz += 1) server.getChunk(cx, -1, cz);
}

function sampleSingleEdits(server: GameServer, count: number, value: number): number {
  const startedAt = performance.now();
  for (let index = 0; index < count; index += 1) {
    const x = index % 100;
    const z = Math.floor(index / 100) % 100;
    const y = -10 + (Math.floor(index / 10_000) % 10);
    server.edit(x, y, z, value);
  }
  return performance.now() - startedAt;
}

function sampleBatch(server: GameServer, value: number): number {
  const buffer = resolveFillCommand({ from: [0, -10, 0], to: [99, -1, 99], voxel: value });
  const startedAt = performance.now();
  server.editBatch({ actorId: 'performance-gate', buffers: [buffer] });
  return performance.now() - startedAt;
}

const performanceGateEnabled = process.env.SEEDLANDS_PERFORMANCE_GATE === '1';

describe.skipIf(!performanceGateEnabled)('world mutation performance gate', () => {
  it('keeps the single edit convenience path within the pre-change regression budget', () => {
    const matchingEnvironment =
      baseline.environment.node === process.version &&
      baseline.environment.platform === platform() &&
      baseline.environment.arch === arch();
    expect(matchingEnvironment, 'Pre-change absolute baseline is only valid in its captured environment').toBe(true);

    const runP50Ms: number[] = [];
    const runP95Ms: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const server = new GameServer({ seedText: `transaction-single-performance-${run}` });
      materializeFillChunks(server);
      sampleSingleEdits(server, 10_000, Voxel.Wood);
      const samples = Array.from({ length: 9 }, (_, sample) =>
        sampleSingleEdits(server, 10_000, sample % 2 ? Voxel.Wood : Voxel.Stone),
      );
      runP50Ms.push(percentile(samples, 0.5));
      runP95Ms.push(percentile(samples, 0.95));
    }

    const medianP50Ms = median(runP50Ms);
    const medianP95Ms = median(runP95Ms);
    console.log(`WORLD_MUTATION_SINGLE_EDIT ${JSON.stringify({ medianP50Ms, medianP95Ms, runP50Ms, runP95Ms })}`);
    expect(medianP50Ms).toBeLessThanOrEqual(baseline.preChange.singleEdit10000.medianP50Ms * 1.15);
    expect(medianP95Ms).toBeLessThanOrEqual(baseline.preChange.singleEdit10000.medianP95Ms * 1.25);
  });

  it('makes a 100k batch at least twice as fast as sequential commits in the same process', () => {
    const sequentialRunP50Ms: number[] = [];
    const batchRunP50Ms: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const sequential = new GameServer({ seedText: `transaction-sequential-performance-${run}` });
      const batched = new GameServer({ seedText: `transaction-batch-performance-${run}` });
      materializeFillChunks(sequential);
      materializeFillChunks(batched);
      sampleSingleEdits(sequential, 100_000, Voxel.Wood);
      sampleBatch(batched, Voxel.Wood);
      const sequentialSamples: number[] = [];
      const batchSamples: number[] = [];
      for (let sample = 0; sample < 9; sample += 1) {
        const value = sample % 2 ? Voxel.Wood : Voxel.Stone;
        if ((run + sample) % 2 === 0) {
          sequentialSamples.push(sampleSingleEdits(sequential, 100_000, value));
          batchSamples.push(sampleBatch(batched, value));
        } else {
          batchSamples.push(sampleBatch(batched, value));
          sequentialSamples.push(sampleSingleEdits(sequential, 100_000, value));
        }
      }
      sequentialRunP50Ms.push(percentile(sequentialSamples, 0.5));
      batchRunP50Ms.push(percentile(batchSamples, 0.5));
    }

    const sequentialP50Ms = median(sequentialRunP50Ms);
    const batchP50Ms = median(batchRunP50Ms);
    const speedup = sequentialP50Ms / batchP50Ms;
    console.log(
      `WORLD_MUTATION_BATCH ${JSON.stringify({ sequentialP50Ms, batchP50Ms, speedup, sequentialRunP50Ms, batchRunP50Ms })}`,
    );
    expect(batchP50Ms).toBeLessThanOrEqual(sequentialP50Ms * 0.5);
  });

  it('coalesces an overwrite-heavy 100k input buffer into 10k canonical writes', () => {
    const server = new GameServer({ seedText: 'transaction-overwrite-performance' });
    const buffer = new WorldMutationBuffer({ sourceId: 'overwrite-heavy', priority: 0, initialCapacity: 100_000 });
    for (let pass = 0; pass < 10; pass += 1)
      for (let index = 0; index < 10_000; index += 1)
        buffer.write(index % 100, -10, Math.floor(index / 100), pass % 2 ? Voxel.Wood : Voxel.Stone);

    const result = server.editBatch({ actorId: 'performance-gate', buffers: [buffer] });
    expect(result.metrics.inputMutationCount).toBe(100_000);
    expect(result.structuralChange?.mutationCount).toBe(10_000);
    expect(result.metrics.canonicalWriteCount).toBe(10_000);
    expect(result.metrics.structuralEventCount).toBe(1);
  });
});
