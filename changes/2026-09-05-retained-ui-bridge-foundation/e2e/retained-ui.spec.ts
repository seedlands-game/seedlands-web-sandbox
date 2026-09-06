import { expect, test } from '@playwright/test';
import { lockPointer, startHarnessWorld } from '../../../tests/e2e/support/harness';

type UiSnapshot = {
  runtime: 'svelte5';
  shellPublishCount: number;
  hudPublishCount: number;
  interactionPublishCount: number;
  debugProjectionCount: number;
  debugPublishCount: number;
  staleUpdateCount: number;
  coalescedUpdateCount: number;
  totalPublishRate: number;
};

type UiHarnessWindow = Window & {
  __seedlandsHarness?: { snapshot: () => { ui?: UiSnapshot } };
  __retainedHotbarNode?: Element | null;
  __retainedCrosshairNode?: Element | null;
};

test('mounts one retained Svelte root and preserves stable HUD nodes', async ({ page }) => {
  await page.goto('./?harness=1', { waitUntil: 'networkidle' });
  const root = page.locator('#ui');
  await expect(root).toHaveAttribute('data-ui-runtime', 'svelte5');
  await expect(page.getByRole('heading', { name: 'Seedlands' })).toBeVisible();
  await page.getByLabel('世界 Seed').fill('retained-ui-runtime');
  await page.getByRole('button', { name: '进入世界' }).click();
  await expect(page.locator('#start-card')).toBeHidden();
  await expect(page.getByLabel('准星')).toBeVisible();
  await expect(page.getByRole('list', { name: '材质快捷栏' })).toBeVisible();

  await page.evaluate(() => {
    const target = window as UiHarnessWindow;
    target.__retainedHotbarNode = document.querySelector('#hotbar');
    target.__retainedCrosshairNode = document.querySelector('#crosshair');
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const next = () => {
          frames += 1;
          if (frames >= 120) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
  );
  expect(
    await page.evaluate(() => {
      const target = window as UiHarnessWindow;
      return (
        target.__retainedHotbarNode === document.querySelector('#hotbar') &&
        target.__retainedCrosshairNode === document.querySelector('#crosshair')
      );
    }),
  ).toBe(true);

  const ui = await page.evaluate(() => (window as UiHarnessWindow).__seedlandsHarness?.snapshot().ui);
  expect(ui).toMatchObject({ runtime: 'svelte5', staleUpdateCount: 0 });
  expect(ui?.debugProjectionCount).toBeLessThanOrEqual(9);
  expect(ui?.totalPublishRate).toBeLessThanOrEqual(6);
});

test('preserves Hotbar, Macro Map and Debug Shell behavior through retained actions', async ({ page }) => {
  await startHarnessWorld(page, 'retained-ui-actions');

  const hotbar = page.getByRole('list', { name: '材质快捷栏' });
  const stone = hotbar.getByRole('button', { name: /选择石头/ });
  await expect(stone).toBeVisible();
  await stone.click();
  await expect(stone).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeHidden();
  await page.keyboard.press('F3');
  const debug = page.getByRole('region', { name: '运行指标' });
  await expect(debug).toBeVisible();
  await expect(debug).toContainText(/FPS|Frame/);

  await page.keyboard.press('KeyM');
  const map = page.getByRole('region', { name: 'Macro 世界地图总览' });
  await expect(map).toBeVisible();
  await map.getByLabel('图层').selectOption('biome');
  await expect(map.locator('canvas')).toHaveAttribute('data-rendered-layer', 'biome');
  await map.getByRole('button', { name: '关闭' }).click();
  await expect(map).toBeHidden();

  await lockPointer(page);
  await page.keyboard.press('F4');
  await page.waitForFunction(() => document.pointerLockElement === null);
  const shell = page.getByRole('dialog', { name: '服务端调试命令' });
  const input = shell.getByRole('textbox', { name: '命令' });
  const status = shell.getByRole('status');
  await expect(input).toBeFocused();
  await input.fill('/seed');
  await input.press('Enter');
  await expect(status).toContainText('成功');
  await input.fill('/unknown');
  await input.press('Enter');
  await expect(status).toContainText('COMMAND_PARSE_FAILED');
  await input.fill('/draft');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('/unknown');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('/draft');

  const beforeTyping = await page.evaluate(() => window.__seedlandsHarness?.snapshot().player);
  await input.fill('wasd1234mpt');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const afterTyping = await page.evaluate(() => window.__seedlandsHarness?.snapshot().player);
  expect(afterTyping?.[0]).toBe(beforeTyping?.[0]);
  expect(afterTyping?.[2]).toBe(beforeTyping?.[2]);
  await expect(page.getByRole('region', { name: 'Macro 世界地图总览' })).toBeHidden();
  await input.press('Escape');
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
});

test('keeps the static fallback when application JavaScript is unavailable', async ({ page }) => {
  await page.route('**/src/app/main.ts*', (route) => route.abort());
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-ui-fallback]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Seedlands' })).toBeVisible();
  await expect(page.getByLabel('世界 Seed')).toBeVisible();
  await expect(page.getByLabel('视觉质量')).toBeVisible();
  await expect(page.getByRole('button', { name: '进入世界' })).toBeVisible();
});

test('keeps the command surface usable on a narrow reduced-motion viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startHarnessWorld(page, 'retained-ui-narrow');
  await page.keyboard.press('F4');
  const shell = page.getByRole('dialog', { name: '服务端调试命令' });
  await expect(shell).toBeVisible();
  await expect(shell.getByRole('textbox', { name: '命令' })).toBeVisible();
  await expect(shell.getByRole('status')).toBeVisible();
  const bounds = await shell.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(700);
  const transitionMs = await page.locator('#interaction-feedback').evaluate((element) => {
    const value = getComputedStyle(element).transitionDuration;
    return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  });
  expect(transitionMs).toBeLessThan(1);
});
