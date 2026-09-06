import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { analyseProfiles, type CpuProfile } from './p0-profiler';

const EVIDENCE_DIRECTORY = new URL('../evidence/', import.meta.url);
const SCENARIOS = ['natural', 'loading', 'fluid', 'ai', 'save', 'map'];

type RawCapture = {
  target: { id: string; type: string; title: string; url: string };
  role: string;
  profile: CpuProfile;
  heapUsage: unknown;
};

test('P0：离线按源码行重建责任归因', async () => {
  test.setTimeout(60_000);
  const origin = process.env.SEEDLANDS_P0_ORIGIN ?? 'http://127.0.0.1:4188';
  const updatedRuns: unknown[] = [];
  for (const scenario of SCENARIOS) {
    for (const repetition of [1, 2]) {
      const stem = `p0-profile-${scenario}-a${repetition}`;
      const [summaryText, rawText] = await Promise.all([
        readFile(new URL(`${stem}.json`, EVIDENCE_DIRECTORY), 'utf8'),
        readFile(new URL(`${stem}-raw.cpuprofile.json`, EVIDENCE_DIRECTORY), 'utf8'),
      ]);
      const summary = JSON.parse(summaryText) as Record<string, unknown>;
      const raw = JSON.parse(rawText) as { captures: RawCapture[] };
      const analysis = await analyseProfiles(origin, scenario, raw.captures);
      const updated = { ...summary, analysisRevision: 2, analysis };
      await writeFile(new URL(`${stem}.json`, EVIDENCE_DIRECTORY), `${JSON.stringify(updated, null, 2)}\n`);
      updatedRuns.push(updated);
      expect((analysis as { separate: { unattributedPercent: number } }).separate.unattributedPercent).toBeLessThan(5);
    }
  }
  const aggregatePath = new URL('p0-aa-summary.json', EVIDENCE_DIRECTORY);
  const aggregate = JSON.parse(await readFile(aggregatePath, 'utf8')) as Record<string, unknown>;
  await writeFile(
    aggregatePath,
    `${JSON.stringify({ ...aggregate, analysisRevision: 2, runs: updatedRuns }, null, 2)}\n`,
  );
});
