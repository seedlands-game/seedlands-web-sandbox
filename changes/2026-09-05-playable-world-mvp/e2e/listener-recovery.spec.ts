import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('重复世界退出后的监听器与DOM资源回收审计', async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  const cdp = await context.newCDPSession(page);
  const samples = [];
  await startHarnessWorld(page, 'living-world-autonomy');
  for (let cycle = 0; cycle < 20; cycle++) {
    await waitForSnapshot(page, (s) => s.renderedChunks > 4 && s.onGround);
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await page.getByRole('button', { name: '保存并返回主菜单', exact: true }).click();
    await expect.poll(() => page.workers().length).toBeLessThanOrEqual(1);
    await cdp.send('HeapProfiler.collectGarbage');
    const targets = [];
    for (const expression of ['window', 'document', 'document.querySelector("#game")', 'navigator.xr']) {
      const { result } = await cdp.send('Runtime.evaluate', { expression, objectGroup: 'listener-audit' });
      if (!result.objectId) continue;
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
      targets.push({
        expression,
        listeners: listeners.map((l) => ({
          type: l.type,
          scriptId: l.scriptId,
          line: l.lineNumber,
          handler: l.handler?.description?.slice(0, 180),
        })),
      });
    }
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'listener-audit' });
    samples.push({ cycle, dom: await cdp.send('Memory.getDOMCounters'), targets });
    if (cycle < 19) await page.getByRole('button', { name: '继续世界', exact: true }).click();
  }
  writeFileSync(testInfo.outputPath('listener-recovery.json'), JSON.stringify(samples, null, 2));
  expect(samples.at(-1)!.dom.jsEventListeners - samples[2].dom.jsEventListeners).toBeLessThanOrEqual(3);
  expect(samples.at(-1)!.dom.nodes - samples[2].dom.nodes).toBeLessThanOrEqual(20);
  for (const sample of samples) {
    const xr = sample.targets.find((target) => target.expression === 'navigator.xr');
    if (xr) expect(xr.listeners.filter((listener) => listener.type === 'devicechange')).toHaveLength(0);
  }
});
