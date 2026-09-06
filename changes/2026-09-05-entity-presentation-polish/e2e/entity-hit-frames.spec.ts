import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('真实躯干攻击的命中前、闪红与恢复视觉帧', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'living-world-autonomy');
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  const enemy = page.getByRole('img', { name: '夜行兽', exact: true });
  const position = (await enemy.getAttribute('data-position'))!.split(',').map(Number);
  await page.evaluate(([x, y, z]) => {
    const h = window.__seedlandsHarness!;
    h.setSpectatorPosition(x - 2.2, y + 1.6, z + 0.6);
    h.setView((Math.atan2(-2.2, 0.6) * 180) / Math.PI, (-Math.atan2(0.5, Math.hypot(2.2, 0.6)) * 180) / Math.PI);
    h.setWorldTime(10);
    h.setTimePaused(true);
  }, position);
  await waitForSnapshot(
    page,
    (s) => s.generationQueue === 0 && s.meshingQueue === 0 && s.performance.uploadQueueDepth === 0,
  );
  await expect(page.locator('#world-clock')).toContainText('10:00');
  await lockPointer(page);
  await page.keyboard.press('F3');
  const before = testInfo.outputPath('before.png');
  const hit = testInfo.outputPath('hit.png');
  const restored = testInfo.outputPath('restored.png');
  await page.screenshot({ path: before });
  await page.mouse.click(640, 360);
  await expect(page.getByRole('status', { name: '交互反馈', exact: true })).toContainText('攻击命中');
  await page.screenshot({ path: hit });
  await page.waitForTimeout(400); // 采样恢复帧，颜色恢复由独立视觉语义检查。
  await page.screenshot({ path: restored });
  await expect(enemy).toBeVisible();
  const destination = process.env.SEEDLANDS_ENTITY_FRAME_DIR;
  if (destination) {
    mkdirSync(destination, { recursive: true });
    for (const [name, path] of [
      ['before', before],
      ['hit', hit],
      ['restored', restored],
    ])
      copyFileSync(path, join(destination, `${name}.png`));
    writeFileSync(
      join(destination, 'index.html'),
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>真实受击帧</title><style>body{margin:24px;background:#11191d;color:#f3e8ce;font:18px system-ui}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}img{width:100%}figure{margin:0}h1{font-size:24px}</style><h1>同一实体的真实浏览器受击帧</h1><p>以下为生产左键命中时的原始画面；没有修改图片颜色。其他生物不应同时闪红。</p><main><figure><figcaption>命中前</figcaption><img src="before.png"></figure><figure><figcaption>命中后瞬间</figcaption><img src="hit.png"></figure><figure><figcaption>400毫秒后</figcaption><img src="restored.png"></figure></main></html>`,
    );
  }
});

test('生产日程驱动居民回营的方向与姿态视觉帧', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'living-world-autonomy');
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding && s.generationQueue === 0 && s.meshingQueue === 0);
  const actor = page.getByRole('img', { name: '营地居民', exact: true });
  const position = (await actor.getAttribute('data-position'))!.split(',').map(Number);
  await page.evaluate(([x, y, z]) => {
    const h = window.__seedlandsHarness!;
    h.setSpectatorPosition(x - 1, y + 3.2, z - 6);
    h.setView(180, -18);
    h.setWorldTime(10);
    h.setTimePaused(true);
  }, position);
  await page.keyboard.press('F3');
  const before = testInfo.outputPath('motion-before.png');
  const moving = testInfo.outputPath('motion-moving.png');
  await page.screenshot({ path: before });
  await page.evaluate(() => window.__seedlandsHarness!.setWorldTime(18.5));
  await expect
    .poll(async () => Number((await actor.getAttribute('data-position'))!.split(',')[0]), { intervals: [50] })
    .toBeLessThan(position[0] - 0.6);
  await page.screenshot({ path: moving });
  const destination = process.env.SEEDLANDS_ENTITY_FRAME_DIR;
  if (destination) {
    mkdirSync(destination, { recursive: true });
    copyFileSync(before, join(destination, 'motion-before.png'));
    copyFileSync(moving, join(destination, 'motion-moving.png'));
    writeFileSync(
      join(destination, 'motion.html'),
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>真实行走帧</title><style>body{margin:24px;background:#11191d;color:#f3e8ce;font:18px system-ui}main{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}img{width:100%}figure{margin:0}h1{font-size:24px}</style><h1>生产日程驱动的居民回营</h1><p>固定镜头面向+Z，世界-X在画面右侧。从日间切到黄昏触发回营，生产位置断言确认居民向世界-X移动超过0.6米（画面右侧）。</p><main><figure><figcaption>开始前</figcaption><img src="motion-before.png"></figure><figure><figcaption>向右回营中</figcaption><img src="motion-moving.png"></figure></main></html>`,
    );
  }
});
