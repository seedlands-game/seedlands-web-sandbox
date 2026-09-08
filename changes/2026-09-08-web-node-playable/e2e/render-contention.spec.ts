import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { RemotePlayableEvidence } from '../../../apps/web/src/app/world/remote-playable-evidence';
import { COLLISION_EPSILON } from '../../../packages/game-core/src/physics/geometry';
import {
  REMOTE_PLAYABLE_ACCESS_KEY,
  REMOTE_PLAYABLE_SEED,
  RemotePlayableNodeFixture,
} from './remote-playable-node-fixture';
import type { RenderContentionProbeSnapshot, RenderContentionVariant } from './render-contention-probe';

const FORMAL_SEQUENCE = ['A', 'A', 'A', 'B', 'B', 'A'] as const;
const SELF_TEST_CASES = [
  { variant: 'B', forceAuthenticationFailure: false },
  { variant: 'B', forceAuthenticationFailure: true },
] as const;
const PRODUCT_DEADLINE_MS = 30_000;
const READY_POLL_DEADLINE_MS = 31_500;
const origin = `http://127.0.0.1:${process.env.SEEDLANDS_E2E_PORT ?? '4173'}`;
const basePath = process.env.SEEDLANDS_BASE_PATH ?? '/';
const probePath = new URL(
  `@fs${resolve('changes/2026-09-08-web-node-playable/e2e/render-contention-probe.ts')}`,
  new URL(basePath, `${origin}/`),
).pathname;
const outputDirectory = resolve(
  process.env.SEEDLANDS_RENDER_CONTENTION_OUTPUT ?? '/tmp/seedlands-web-node-playable/render-contention',
);
const nodePort = Number(process.env.SEEDLANDS_RENDER_CONTENTION_NODE_PORT ?? '18789');
const selfTest = process.env.SEEDLANDS_RENDER_CONTENTION_SELF_TEST === '1';
const trialCases = selfTest
  ? SELF_TEST_CASES
  : FORMAL_SEQUENCE.map((variant) => ({ variant, forceAuthenticationFailure: false }) as const);
const sequence = trialCases.map(({ variant }) => variant);
const sourceFiles = [
  'package.json',
  'playwright.config.ts',
  'apps/node-server/dist/node-server.js',
  'apps/web/src/app/game.ts',
  'apps/web/src/app/world/initial-playable-area.ts',
  'apps/web/src/app/world/initial-world-ready.ts',
  'apps/web/src/client/authority/remote-authority-client.ts',
  'apps/web/src/client/authority/remote-authority-mesh-mirror.ts',
  'changes/2026-09-08-web-node-playable/e2e/remote-playable-node-fixture.ts',
  'changes/2026-09-08-web-node-playable/e2e/render-contention-probe.ts',
  'changes/2026-09-08-web-node-playable/e2e/render-contention.spec.ts',
  'changes/2026-09-08-web-node-playable/e2e/run-render-contention-experiment.mjs',
  'changes/2026-09-08-web-node-playable/render-contention-experiment.json',
  'changes/2026-09-08-web-node-playable/contracts/validation.json',
] as const;

type TrialResult = Readonly<{
  ordinal: number;
  variant: RenderContentionVariant;
  outcome: 'ready' | 'timeout' | 'failure';
  cappedClickToReadyMs: number;
  probe: RenderContentionProbeSnapshot | null;
  requiredRenderedChunks: number;
  evidence: RemotePlayableEvidence | null;
  finalFrame: Readonly<{ path: string; sha256: string }> | null;
  error: string | null;
  nodeLog: readonly string[];
}>;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

async function armProbe(page: Page, variant: RenderContentionVariant): Promise<void> {
  await page.evaluate(
    async ([path, selected]) =>
      ((await import(path)) as typeof import('./render-contention-probe')).arm(selected as RenderContentionVariant),
    [probePath, variant] as const,
  );
}

async function readProbe(page: Page): Promise<RenderContentionProbeSnapshot> {
  return page.evaluate(
    async (path) => ((await import(path)) as typeof import('./render-contention-probe')).read(),
    probePath,
  );
}

async function releaseProbe(page: Page): Promise<void> {
  await page
    .evaluate(async (path) => ((await import(path)) as typeof import('./render-contention-probe')).release(), probePath)
    .catch(() => undefined);
}

async function connectForm(page: Page, nodeUrl: string, forceAuthenticationFailure: boolean): Promise<void> {
  await page.goto('/?harness=1');
  await expect(page.locator('#enter')).toBeEnabled({ timeout: 20_000 });
  await page.selectOption('#connection-mode', 'remote');
  await expect(page.locator('#node-url')).toBeVisible();
  await page.fill('#node-url', nodeUrl);
  await page
    .locator('input[type="password"]')
    .fill(forceAuthenticationFailure ? 'seedlands-e2e-invalid-key' : REMOTE_PLAYABLE_ACCESS_KEY);
}

async function renderedRequiredChunkCount(page: Page, current: RemotePlayableEvidence): Promise<number> {
  const centerX = Math.floor(current.authoritativePlayer[0] / 32);
  const centerY = Math.floor((current.authoritativePlayer[1] - COLLISION_EPSILON) / 32);
  const centerZ = Math.floor(current.authoritativePlayer[2] / 32);
  let rendered = 0;
  for (let cz = centerZ - 1; cz <= centerZ + 1; cz += 1)
    for (let cx = centerX - 1; cx <= centerX + 1; cx += 1) {
      const revision = await page.evaluate(
        ([x, y, z]) => window.__seedlandsRemoteEvidence?.renderedRevisionAt(x, y, z) ?? null,
        [cx * 32, centerY * 32, cz * 32],
      );
      if (revision !== null) rendered += 1;
    }
  return rendered;
}

async function runTrial(
  browser: Browser,
  ordinal: number,
  variant: RenderContentionVariant,
  forceAuthenticationFailure: boolean,
): Promise<TrialResult> {
  const fixture = await RemotePlayableNodeFixture.create(nodePort);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  let probe: RenderContentionProbeSnapshot | null;
  let evidence: RemotePlayableEvidence | null = null;
  let requiredRenderedChunks = 0;
  let finalFrame: TrialResult['finalFrame'] = null;
  let outcome: TrialResult['outcome'] = 'failure';
  let error: string | null = null;
  try {
    await fixture.start(origin);
    await connectForm(page, fixture.url, forceAuthenticationFailure);
    await armProbe(page, variant);
    await page.click('#enter');
    await expect
      .poll(() => readProbe(page).then(({ terminal }) => terminal), { timeout: READY_POLL_DEADLINE_MS })
      .not.toBe('pending');
    probe = await readProbe(page);
    if (probe.terminal !== 'ready') throw new Error(`Remote loading ended with ${probe.terminal}.`);
    evidence = await page.evaluate(() => window.__seedlandsRemoteEvidence!.snapshot());
    requiredRenderedChunks = await renderedRequiredChunkCount(page, evidence);
    const framePath = join(outputDirectory, `trial-${String(ordinal).padStart(2, '0')}-${variant}.png`);
    const bytes = await page.screenshot({ path: framePath });
    finalFrame = { path: framePath, sha256: createHash('sha256').update(bytes).digest('hex') };
    outcome = 'ready';
  } catch (caught) {
    probe = await readProbe(page).catch(() => null);
    error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
    const timeoutError = page.locator('.start-error').filter({ hasText: '初始区块加载超时' });
    await timeoutError.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
    const productError = await page
      .locator('.start-error')
      .allTextContents()
      .catch(() => []);
    if (productError.some((message) => message.includes('初始区块加载超时'))) outcome = 'timeout';
  } finally {
    await releaseProbe(page);
    probe = await readProbe(page).catch(() => probe);
    await context.close();
    await fixture.dispose();
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  const nodeLog = fixture.logs().map((line) => line.replaceAll(REMOTE_PLAYABLE_ACCESS_KEY, '[REDACTED_ACCESS_KEY]'));
  return {
    ordinal,
    variant,
    outcome,
    cappedClickToReadyMs: Math.min(probe?.clickToReadyMs ?? PRODUCT_DEADLINE_MS, PRODUCT_DEADLINE_MS),
    probe,
    requiredRenderedChunks,
    evidence,
    finalFrame,
    error,
    nodeLog,
  };
}

function summarize(results: readonly TrialResult[]) {
  const candidates = results.filter(({ variant }) => variant === 'B');
  const candidateMedianMs = median(candidates.map(({ cappedClickToReadyMs }) => cappedClickToReadyMs));
  const initialAaBothCensored = results[0]!.outcome === 'timeout' && results[1]!.outcome === 'timeout';
  const balancedControlsBothCensored = results[2]!.outcome === 'timeout' && results[5]!.outcome === 'timeout';
  const candidateCorrect = candidates.every(
    ({ outcome, requiredRenderedChunks, probe, finalFrame }) =>
      outcome === 'ready' &&
      requiredRenderedChunks === 9 &&
      probe?.autoRenderRestored === true &&
      probe.previousAutoRender === true &&
      probe.renderRequests > 0 &&
      probe.pacedPostrenders > 0 &&
      probe.finalPostrenderAtMs !== null &&
      finalFrame !== null,
  );
  const candidateCleanupVerified = candidates.every(({ probe }) => probe?.autoRenderRestored === true);
  const controlUnmodified = results
    .filter(({ variant }) => variant === 'A')
    .every(({ probe }) => probe?.renderRequests === 0 && probe?.previousAutoRender === true);
  const rendererConfirmed = results.every(({ probe }) => /swiftshader/iu.test(probe?.renderer ?? ''));
  const candidateWithinMargin =
    candidates.length === 2 && candidates.every(({ cappedClickToReadyMs }) => cappedClickToReadyMs <= 24_000);
  return {
    aaNoise: initialAaBothCensored ? 'NOT_ESTIMABLE_CENSORED' : 'CONTROL_NOT_REPRODUCED',
    initialAaBothCensored,
    balancedControlsBothCensored,
    candidateMedianMs,
    conservativeCandidateMarginMs:
      PRODUCT_DEADLINE_MS - Math.max(...candidates.map((item) => item.cappedClickToReadyMs)),
    candidateCorrect,
    candidateCleanupVerified,
    controlUnmodified,
    rendererConfirmed,
    candidateWithinMargin,
    decision:
      initialAaBothCensored &&
      balancedControlsBothCensored &&
      candidateCorrect &&
      candidateCleanupVerified &&
      controlUnmodified &&
      rendererConfirmed &&
      candidateWithinMargin
        ? 'supports-render-contention-hypothesis'
        : 'stop-without-product-adoption',
  } as const;
}

test.describe.configure({ mode: 'serial', retries: 0 });

test('non-production remote loading render-contention experiment', async ({ browser }) => {
  test.setTimeout(trialCases.length * 45_000 + 30_000);
  await mkdir(outputDirectory, { recursive: true });
  const results: TrialResult[] = [];
  for (const [index, trial] of trialCases.entries())
    results.push(await runTrial(browser, index + 1, trial.variant, trial.forceAuthenticationFailure));
  const sourceInputs = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(
        async (path) =>
          [
            path,
            createHash('sha256')
              .update(await readFile(path))
              .digest('hex'),
          ] as const,
      ),
    ),
  );
  const summary = selfTest ? null : summarize(results);
  const record = {
    kind: 'seedlands-render-contention-non-production-experiment',
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceTreeStatus: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    sourceInputs,
    browserVersion: browser.version(),
    seed: REMOTE_PLAYABLE_SEED,
    config: {
      sequence,
      viewport: { width: 1280, height: 720 },
      productDeadlineMs: PRODUCT_DEADLINE_MS,
      candidateRenderCadenceMs: 100,
      compute: 'inline',
      nodeWarmup: 'fresh-process-and-empty-data-directory-per-trial',
      browserWarmup: 'one-browser-process-with-fresh-context-per-trial',
      nodePort,
      origin,
      authority: 'real-node-process',
      browserGraphics: 'forced-swiftshader',
    },
    results,
    summary,
  };
  await writeFile(join(outputDirectory, 'raw-results.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    JSON.stringify({
      kind: record.kind,
      sourceSha: record.sourceSha,
      samples: results.map(({ ordinal, variant, outcome, cappedClickToReadyMs, requiredRenderedChunks, probe }) => ({
        ordinal,
        variant,
        outcome,
        cappedClickToReadyMs,
        requiredRenderedChunks,
        renderer: probe?.renderer ?? null,
        renderRequests: probe?.renderRequests ?? null,
        pacedPostrenders: probe?.pacedPostrenders ?? null,
        autoRenderRestored: probe?.autoRenderRestored ?? null,
      })),
      summary,
      artifact: join(outputDirectory, 'raw-results.json'),
    }),
  );
  expect(results.every(({ probe }) => /swiftshader/iu.test(probe?.renderer ?? ''))).toBe(true);
  expect(
    results.filter(({ variant }) => variant === 'B').every(({ probe }) => probe?.autoRenderRestored === true),
  ).toBe(true);
  if (selfTest) {
    expect(results[0]).toMatchObject({
      outcome: 'ready',
      requiredRenderedChunks: 9,
      probe: { previousAutoRender: true, autoRenderRestored: true },
    });
    expect(results[1]).toMatchObject({
      outcome: 'failure',
      probe: {
        previousAutoRender: true,
        autoRenderRestored: true,
        terminal: 'failed',
        finalPostrenderAtMs: null,
        finalPostrenderUnavailableReason: 'application-destroyed',
      },
    });
  }
});
