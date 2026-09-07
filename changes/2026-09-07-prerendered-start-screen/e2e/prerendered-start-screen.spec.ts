import { expect, test } from '@playwright/test';

const expectStableBox = (
  before: { x: number; y: number; width: number; height: number },
  after: { x: number; y: number; width: number; height: number },
) => {
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(before[key] - after[key])).toBeLessThanOrEqual(1);
};

test('无 JavaScript 首绘直接提供完整的 Svelte 启动页', async ({ page }) => {
  await page.route('**/src/app/bootstrap.ts*', (route) => route.abort());
  await page.goto('/');

  const startCard = page.locator('#start-card');
  await expect(startCard).toBeVisible();
  const firstPaint = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return {
      prerendered: document.querySelector<HTMLElement>('#ui')?.dataset.uiPrerendered,
      startCardClass: document.querySelector('#start-card')?.className,
      recommendedStart: buttons.some((button) => button.textContent?.includes('推荐起点：林间河岸')),
      worldVersion: Boolean(document.querySelector('#world-version-mode')),
      settings: buttons.some((button) => button.textContent?.trim() === '设置'),
      guide: buttons.some((button) => button.textContent?.trim() === '操作指南'),
      enterDisabled: document.querySelector<HTMLButtonElement>('#enter')?.disabled,
    };
  });
  expect(firstPaint).toEqual({
    prerendered: 'svelte5',
    startCardClass: expect.stringContaining('game-panel'),
    recommendedStart: true,
    worldVersion: true,
    settings: true,
    guide: true,
    enterDisabled: true,
  });
});

test('hydration 复用首屏节点并保留输入、焦点、选区与布局', async ({ page }) => {
  const hydrationMessages: string[] = [];
  page.on('console', (message) => {
    if (/hydrat|failed to hydrate/i.test(message.text())) hydrationMessages.push(message.text());
  });

  let releaseBootstrap!: () => void;
  const bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });
  await page.route('**/src/app/bootstrap.ts*', async (route) => {
    await bootstrapGate;
    await route.continue();
  });
  await page.goto('/');

  const seed = page.getByRole('textbox', { name: '世界 Seed' });
  const quality = page.getByRole('combobox', { name: '视觉质量' });
  await seed.fill('before-hydration');
  await quality.selectOption('high');
  await seed.focus();
  await seed.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.setSelectionRange(7, 16);
    (window as Window & { __seedlandsPreHydrationSeed?: HTMLInputElement }).__seedlandsPreHydrationSeed = input;
  });
  const before = await page.locator('#start-card').boundingBox();
  expect(before).not.toBeNull();

  releaseBootstrap();
  await expect(page.locator('#ui')).toHaveAttribute('data-ui-runtime', 'svelte5');
  await expect(seed).toHaveValue('before-hydration');
  await expect(quality).toHaveValue('high');

  const continuity = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#seed');
    const saved = (window as Window & { __seedlandsPreHydrationSeed?: HTMLInputElement }).__seedlandsPreHydrationSeed;
    return {
      sameNode: Boolean(input && saved === input),
      focused: document.activeElement === input,
      selectionStart: input?.selectionStart,
      selectionEnd: input?.selectionEnd,
    };
  });
  expect(continuity).toEqual({ sameNode: true, focused: true, selectionStart: 7, selectionEnd: 16 });
  const after = await page.locator('#start-card').boundingBox();
  expect(after).not.toBeNull();
  expectStableBox(before!, after!);
  expect(hydrationMessages).toEqual([]);
});
