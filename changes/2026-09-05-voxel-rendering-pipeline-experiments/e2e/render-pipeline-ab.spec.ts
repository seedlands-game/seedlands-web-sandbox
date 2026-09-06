import { expect, test, type Browser } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type Sample = {
  elapsedMs: number;
  frameP95Ms: number;
  frameP99Ms: number;
  chunkVisibleP95Ms: number;
  drawCalls: number;
  meshBytes: number;
  loadedChunks: number;
  renderedChunks: number;
  triangles: number;
};

async function sample(browser: Browser, candidate: 'p1' | 'p2' | 'p4', arm: 'control' | 'candidate'): Promise<Sample> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const startedAt = performance.now();
  const renderer = candidate === 'p4' && arm === 'candidate' ? '&renderer=webgpu' : '&renderer=webgl2';
  await startHarnessWorld(page, `render-ab-${candidate}`, `&renderExperiment=${candidate}&renderArm=${arm}${renderer}`);
  const state = await waitForSnapshot(
    page,
    (current) => current.loadedChunks >= 49 && current.generationQueue === 0 && current.meshingQueue === 0,
  );
  const result = {
    elapsedMs: performance.now() - startedAt,
    frameP95Ms: state.performance.frame.p95Ms,
    frameP99Ms: state.performance.frame.p99Ms,
    chunkVisibleP95Ms: state.performance.chunkVisible.p95Ms,
    drawCalls: state.drawCalls,
    meshBytes: state.performance.estimatedMeshBytes,
    loadedChunks: state.loadedChunks,
    renderedChunks: state.renderedChunks,
    triangles: state.triangles,
  };
  await page.close();
  return result;
}

for (const candidate of ['p1', 'p2', 'p4'] as const) {
  test(`${candidate} 生成 A/A 与 A→B→A→B 配对样本`, async ({ browser }, testInfo) => {
    test.skip(true, 'A/B 已完成并固化到 ab-results.md；最终产物不保留实验运行时分支。');
    test.setTimeout(180_000);
    const aa = [await sample(browser, candidate, 'control'), await sample(browser, candidate, 'control')];
    const paired = [
      await sample(browser, candidate, 'control'),
      await sample(browser, candidate, 'candidate'),
      await sample(browser, candidate, 'control'),
      await sample(browser, candidate, 'candidate'),
    ];
    const invariant = [...aa, ...paired];
    expect(new Set(invariant.map((item) => item.renderedChunks)).size).toBe(1);
    expect(new Set(invariant.map((item) => item.triangles)).size).toBe(1);
    const evidence = { candidate, order: ['A', 'A', 'A', 'B', 'A', 'B'], aa, paired };
    process.stdout.write(`\nRENDER_AB_EVIDENCE ${JSON.stringify(evidence)}\n`);
    await testInfo.attach(`${candidate}-ab-samples`, {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  });
}
