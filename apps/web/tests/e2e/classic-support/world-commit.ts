import type { Page } from '@playwright/test';
import type { ClassicScenario, Point } from './scenario';

export type WorldCommitProjection = Readonly<{ committed: boolean; reason?: string; worldRevision: number }>;

export type HarnessResult<T> = Readonly<
  | { ok: true; data: T; frontier: Readonly<Record<string, unknown>> }
  | { ok: false; error: Readonly<{ code: string; message: string }> }
>;

export function fixtureChunkCoordinates(scenario: ClassicScenario): readonly (readonly [number, number, number])[] {
  const chunks = new Map<string, readonly [number, number, number]>();
  const includeRegion = (from: Point, to: Point) => {
    const chunkFrom = from.map((value) => Math.floor(value / 32));
    const chunkTo = to.map((value) => Math.floor(value / 32));
    for (let cy = Math.min(chunkFrom[1]!, chunkTo[1]!); cy <= Math.max(chunkFrom[1]!, chunkTo[1]!); cy += 1)
      for (let cz = Math.min(chunkFrom[2]!, chunkTo[2]!); cz <= Math.max(chunkFrom[2]!, chunkTo[2]!); cz += 1)
        for (let cx = Math.min(chunkFrom[0]!, chunkTo[0]!); cx <= Math.max(chunkFrom[0]!, chunkTo[0]!); cx += 1)
          chunks.set(`${cx},${cy},${cz}`, [cx, cy, cz]);
  };
  includeRegion(scenario.initialState.floor.from, scenario.initialState.floor.to);
  includeRegion(scenario.initialState.air.from, scenario.initialState.air.to);
  for (const resource of scenario.initialState.resourceVoxels) includeRegion(resource.position, resource.position);
  return [...chunks.values()];
}

export async function prepareFixtureChunks(page: Page, scenario: ClassicScenario): Promise<void> {
  const chunks = fixtureChunkCoordinates(scenario);
  const result = await page.evaluate(async (chunks) => {
    const harness = (window as unknown as { __seedlandsHarness?: { world: { prepare(input: unknown): unknown } } })
      .__seedlandsHarness;
    if (!harness) throw new Error('Classic Harness is unavailable.');
    return harness.world.prepare({ kind: 'chunks', chunks });
  }, chunks);
  const receipt = result as HarnessResult<{ prepared: readonly string[] }>;
  if (!receipt.ok) throw new Error(`prepare fixture chunks: ${receipt.error.code}: ${receipt.error.message}`);
  const expected = new Set(chunks.map((chunk) => chunk.join(',')));
  if (receipt.data.prepared.length !== expected.size || receipt.data.prepared.some((key) => !expected.has(key)))
    throw new Error(`Fixture Chunk preparation is incomplete: ${JSON.stringify(receipt.data.prepared)}.`);
}
