import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/ci.yml');
const config = read('playwright.config.ts');
const main = read('apps/web/tests/e2e/classic-runtime.spec.ts');
const visual = read('apps/web/tests/e2e/classic-support/visual-rebuild.ts');
const modular = read('apps/web/tests/e2e/classic-support/modular-pack-smoke.ts');
const timeout = (source) => {
  const match = source.match(/test\.setTimeout\(([\d_]+)\)/);
  assert.ok(match, 'A concrete test timeout is required.');
  return Number(match[1].replaceAll('_', ''));
};

test('Chromium job covers the original complete journey and diagnostic retry', () => {
  assert.equal(timeout(main), 900_000);
  assert.equal(timeout(visual), 240_000);
  assert.equal(timeout(modular), 90_000);
  assert.match(config, /retries: process\.env\.CI \? 1 : 0/);
  assert.match(config, /failOnFlakyTests: true/);
  assert.match(main, /test\.skip\(modularPackSmokeEnabled/);
  assert.match(modular, /test\.skip\(!modularPackSmokeEnabled/);
  const job = workflow.match(/\n {2}chromium:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:|$)/)?.[1];
  assert.ok(job, 'The unique Chromium job must exist.');
  assert.equal((job.match(/run: pnpm harness:classic\s*\n/g) ?? []).length, 1);
  assert.doesNotMatch(job, /run: pnpm build/);
  const minutes = Number(job.match(/timeout-minutes: (\d+)/)?.[1]);
  const runnerMinutes = (Math.max(timeout(main) + timeout(visual), timeout(modular)) * 2) / 60_000;
  // Setup, failure attachments, artifact upload and cleanup need a separate bounded margin.
  assert.ok(
    Number.isSafeInteger(minutes) && minutes >= runnerMinutes + 5,
    `Chromium job ${minutes}min cannot cover ${runnerMinutes}min of existing tests plus 5min reporting margin.`,
  );
});
