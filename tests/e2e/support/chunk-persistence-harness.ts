import type { Page } from '@playwright/test';
import type { ChunkPersistenceCorpusSummary } from '../../../src/client/browser-chunk-persistence';
import type { ChunkPersistenceLoadScenario } from '../../../src/client/chunk-persistence-benchmark';

type PersistenceHarnessWindow = Window & {
  __seedlandsPersistenceHarness?: {
    seedCorpus: (database: string, seedText: string, chunkCount: number) => Promise<ChunkPersistenceCorpusSummary>;
    loadScenario: (
      database: string,
      seedText: string,
      activeChunkCount: number,
    ) => Promise<ChunkPersistenceLoadScenario>;
    saveOneChangedChunk: (
      database: string,
    ) => Promise<{ encodedChunkCount: number; idbPutCount: number; untouchedChunkReadCount: number }>;
  };
};

type SeededCorpus = ChunkPersistenceCorpusSummary & { database: string; seedText: string };
type LoadScenario = ChunkPersistenceLoadScenario & {
  saveOneChangedChunk: () => Promise<{
    encodedChunkCount: number;
    idbPutCount: number;
    untouchedChunkReadCount: number;
  }>;
};

const seeds = new Map<string, string>();

export async function startChunkPersistenceHarness(page: Page): Promise<void> {
  await page.goto('/?harness=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as PersistenceHarnessWindow).__seedlandsPersistenceHarness));
}

export async function seedChunkPersistenceCorpus(
  page: Page,
  options: { name: string; chunkCount: number },
): Promise<SeededCorpus> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const database = `seedlands-persistence-${options.name}-${suffix}`;
  const seedText = `persistence-${options.name}`;
  const summary = (await page.evaluate(
    async ({ databaseName, corpusSeed, chunkCount }) => {
      const harness = (window as PersistenceHarnessWindow).__seedlandsPersistenceHarness;
      if (!harness) throw new Error('Chunk persistence harness is unavailable.');
      return harness.seedCorpus(databaseName, corpusSeed, chunkCount);
    },
    { databaseName: database, corpusSeed: seedText, chunkCount: options.chunkCount },
  )) as ChunkPersistenceCorpusSummary;
  seeds.set(database, seedText);
  return { ...summary, database, seedText };
}

export async function runChunkPersistenceLoadScenario(
  page: Page,
  options: { database: string; activeChunkCount: number },
): Promise<LoadScenario> {
  const seedText = seeds.get(options.database);
  if (!seedText) throw new Error(`Unknown seeded Chunk database: ${options.database}`);
  const result = await page.evaluate(
    async ({ databaseName, corpusSeed, activeChunkCount }) => {
      const harness = (window as PersistenceHarnessWindow).__seedlandsPersistenceHarness;
      if (!harness) throw new Error('Chunk persistence harness is unavailable.');
      return harness.loadScenario(databaseName, corpusSeed, activeChunkCount);
    },
    { databaseName: options.database, corpusSeed: seedText, activeChunkCount: options.activeChunkCount },
  );
  return {
    ...result,
    saveOneChangedChunk: async () =>
      page.evaluate(async (database) => {
        const harness = (window as PersistenceHarnessWindow).__seedlandsPersistenceHarness;
        if (!harness) throw new Error('Chunk persistence harness is unavailable.');
        return harness.saveOneChangedChunk(database);
      }, options.database) as Promise<{
        encodedChunkCount: number;
        idbPutCount: number;
        untouchedChunkReadCount: number;
      }>,
  };
}
