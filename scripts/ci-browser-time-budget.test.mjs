import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/ci.yml');
const config = read('playwright.config.ts');
const main = read('apps/web/tests/e2e/classic-runtime.spec.ts');
const visual = read('apps/web/tests/e2e/classic-support/visual-rebuild.ts');
const modular = read('apps/web/tests/e2e/classic-support/modular-pack-smoke.ts');
const minecart = read('apps/web/tests/e2e/classic-support/minecart-journey.ts');
const timeout = (source) => {
  const match = source.match(/test\.setTimeout\(([\d_]+)\)/);
  assert.ok(match, 'A concrete test timeout is required.');
  return Number(match[1].replaceAll('_', ''));
};

test('Classic owner contracts remain in the explicit behavior and type selections', () => {
  const script = JSON.parse(read('package.json')).scripts['test:classic:headless'];
  const types = JSON.parse(read('tsconfig.classic-tests.json')).include;
  const units = [
    'apps/web/tests/unit/worker/persistence-chunk-directory-revision.test.ts',
    'apps/web/tests/unit/worker/persistence-column-directory.test.ts',
    'apps/web/tests/unit/client/browser-column-directory.test.ts',
  ];
  for (const path of [...units, 'apps/web/tests/e2e/classic-support/equipment-diagnostics-contract.test.ts'])
    assert.ok(script.split(/\s+/).includes(path), `${path} is absent from the existing headless selection`);
  for (const path of units) assert.ok(types.includes(path), `${path} is absent from Classic test types`);
  assert.ok(types.includes('apps/web/tests/e2e'), 'The original whole E2E directory must remain typed');
});

test('Chromium job covers the original complete journey and diagnostic retry', () => {
  assert.equal(timeout(main), 900_000);
  assert.equal(timeout(visual), 240_000);
  assert.equal(timeout(modular), 90_000);
  assert.equal(timeout(minecart), 120_000);
  assert.match(main, /registerClassicMinecartJourney\(test\)/);
  assert.match(config, /retries: process\.env\.CI \? 1 : 0/);
  assert.match(config, /failOnFlakyTests: true/);
  assert.match(main, /test\.skip\(modularPackSmokeEnabled/);
  assert.match(modular, /test\.skip\(!modularPackSmokeEnabled/);
  const job = workflow.match(/\n {2}chromium:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:|$)/)?.[1];
  assert.ok(job, 'The unique Chromium job must exist.');
  assert.equal((job.match(/run: pnpm harness:classic\s*\n/g) ?? []).length, 1);
  assert.doesNotMatch(job, /run: pnpm build/);
  const minutes = Number(job.match(/timeout-minutes: (\d+)/)?.[1]);
  const runnerMinutes = (Math.max(timeout(main) + timeout(visual) + timeout(minecart), timeout(modular)) * 2) / 60_000;
  // Setup, failure attachments, artifact upload and cleanup need a separate bounded margin.
  assert.ok(
    Number.isSafeInteger(minutes) && minutes >= runnerMinutes + 5,
    `Chromium job ${minutes}min cannot cover ${runnerMinutes}min of existing tests plus 5min reporting margin.`,
  );
});

test('Chromium keeps every evidence tree while separating the HTML report from raw failure traces', () => {
  const job = workflow.match(/\n {2}chromium:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:|$)/)?.[1];
  assert.ok(job, 'The unique Chromium job must exist.');
  const uploads = job.split(/\n {6}- name:/).filter((step) => step.includes('uses: actions/upload-artifact@'));
  const owners = new Map();
  const names = new Set();
  for (const step of uploads) {
    assert.match(step, /if: \$\{\{ always\(\) && steps\.classic\.outcome != 'skipped' \}\}/);
    assert.match(step, /uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
    assert.match(step, /retention-days: 7/);
    const name = step.match(/\n {10}name: (.+)/)?.[1];
    assert.ok(name?.includes('${{ github.run_id }}-${{ github.run_attempt }}'));
    assert.ok(!names.has(name), 'Evidence artifacts must have distinct run-bound names.');
    names.add(name);
    const paths = step
      .match(/\n {10}path: \|\n((?: {12}[^\n]+\n)+)/)?.[1]
      .trim()
      .split('\n')
      .map((path) => path.trim());
    assert.ok(paths?.length, 'Evidence upload must declare its complete source trees.');
    for (const path of paths) {
      assert.ok(!owners.has(path), `Duplicate evidence tree ${path}`);
      owners.set(path, name);
    }
    if (paths.includes('harness/results/')) assert.match(step, /if-no-files-found: error/);
  }
  assert.deepEqual([...owners.keys()].sort(), ['harness/results/', 'playwright-report/', 'test-results/']);
  assert.notEqual(
    owners.get('playwright-report/'),
    owners.get('test-results/'),
    'Combined HTML and raw traces exceeded the observed single-artifact download limit.',
  );
});
