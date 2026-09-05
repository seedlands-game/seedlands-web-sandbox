import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type OverlayHarness = Window & {
  __seedlandsHarness?: {
    fillWorld: (command: { from: [number, number, number]; to: [number, number, number]; voxel: number }) => void;
    setVoxelAt: (x: number, y: number, z: number, voxel: number) => void;
    setSpectatorPosition: (x: number, y: number, z: number) => void;
    setView: (yaw: number, pitch: number) => void;
    snapshot: () => {
      breakingOverlay: { position: [number, number, number]; stage: number } | null;
      generationQueue: number;
      meshingQueue: number;
      deferredRemeshes: number;
      renderedChunks: number;
    };
  };
};

test('真实按住挖掘跨阶段与轻微转头时裂纹保持贴合且取消后清除', async ({ page }, testInfo) => {
  const framePaths = {
    early: testInfo.outputPath('crack-stage-early.png'),
    middle: testInfo.outputPath('crack-stage-middle.png'),
    turned: testInfo.outputPath('crack-stage-turned.png'),
  };
  await startHarnessWorld(page, 'stable-break-overlay-texture');
  await page.evaluate(() => {
    const h = (window as OverlayHarness).__seedlandsHarness!;
    h.fillWorld({ from: [-1, 48, -5], to: [1, 48, 1], voxel: 3 });
    h.fillWorld({ from: [-1, 49, -5], to: [1, 52, 1], voxel: 0 });
    h.setVoxelAt(0, 50, -3, 3);
    h.setSpectatorPosition(0.5, 50.5, 0.5);
    h.setView(0, 0);
  });
  await waitForSnapshot(
    page,
    (current) =>
      current.generationQueue === 0 &&
      current.meshingQueue === 0 &&
      current.deferredRemeshes === 0 &&
      current.renderedChunks > 0,
  );

  const canvas = await lockPointer(page);
  await canvas.dispatchEvent('mousedown', { button: 0 });
  await page.waitForFunction(
    () => ((window as OverlayHarness).__seedlandsHarness?.snapshot().breakingOverlay?.stage ?? -1) >= 2,
  );
  const early = await page.evaluate(() => (window as OverlayHarness).__seedlandsHarness!.snapshot().breakingOverlay);
  await page.screenshot({ path: framePaths.early });

  await page.waitForFunction(
    () => ((window as OverlayHarness).__seedlandsHarness?.snapshot().breakingOverlay?.stage ?? -1) >= 5,
  );
  const middle = await page.evaluate(() => (window as OverlayHarness).__seedlandsHarness!.snapshot().breakingOverlay);
  expect(middle?.position).toEqual(early?.position);
  expect(middle!.stage).toBeGreaterThan(early!.stage);
  await page.screenshot({ path: framePaths.middle });

  await page.evaluate(() => (window as OverlayHarness).__seedlandsHarness!.setView(2, 0));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const turned = await page.evaluate(() => (window as OverlayHarness).__seedlandsHarness!.snapshot().breakingOverlay);
  expect(turned?.position).toEqual([0, 50, -3]);
  await page.screenshot({ path: framePaths.turned });

  await canvas.dispatchEvent('mouseup', { button: 0 });
  await page.waitForFunction(() => (window as OverlayHarness).__seedlandsHarness?.snapshot().breakingOverlay === null);
  await expect(page.locator('#break-progress')).toHaveCount(0);

  const destination = process.env.SEEDLANDS_STABLE_BREAK_FRAME_DIR;
  if (destination) {
    mkdirSync(destination, { recursive: true });
    for (const [name, source] of Object.entries(framePaths)) copyFileSync(source, join(destination, `${name}.png`));
    writeFileSync(
      join(destination, 'presentation.html'),
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>稳定破坏裂纹连续帧</title><style>body{margin:20px;background:#11191d;color:#f3e8ce;font:18px system-ui}main{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img{display:block;width:100%;border:1px solid #8a6935}figcaption{margin:0 0 8px}p{color:#c9b991}</style><h1>真实按住挖掘 · 连续阶段与轻微转头</h1><p>金色细框是目标选择轮廓；底部八个方格是快捷栏，不是采集进度条。</p><main><figure><figcaption>早期阶段</figcaption><img src="early.png"></figure><figure><figcaption>中期阶段</figcaption><img src="middle.png"></figure><figure><figcaption>中期后轻微向右转头</figcaption><img src="turned.png"></figure></main></html>',
    );
  }
});
