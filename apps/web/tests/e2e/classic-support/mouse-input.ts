import { expect, type Locator, type Page } from '@playwright/test';

const mousePositions = new WeakMap<Page, { x: number; y: number }>();

export async function lockPointer(page: Page): Promise<Locator> {
  // prettier-ignore
  if (await page.locator('#debug').isVisible()) { await page.keyboard.press('F3'); await expect(page.locator('#debug')).toBeHidden(); }
  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Classic canvas is not visible.');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game');
  mousePositions.set(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return canvas;
}

export async function ensurePointerLock(page: Page): Promise<void> {
  if (!(await page.evaluate(() => document.pointerLockElement?.id === 'game'))) await lockPointer(page);
}

export async function moveMouseBy(
  page: Page,
  dx: number,
  dy: number,
  options: Readonly<{ waitForRender?: boolean }> = {},
): Promise<void> {
  const current = mousePositions.get(page);
  if (!current) throw new Error('Real mouse movement requires a Pointer Lock baseline.');
  if (!(await page.evaluate(() => document.pointerLockElement?.id === 'game')))
    throw new Error('Real mouse movement requires the Classic canvas to retain Pointer Lock.');
  // Pointer Lock delivers relative movement while Playwright's virtual cursor crosses the viewport.
  const next = { x: current.x + dx, y: current.y + dy };
  await page.mouse.move(next.x, next.y);
  mousePositions.set(page, next);
  if (options.waitForRender !== false)
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
}

export async function clickCanvasCenter(page: Page, button: 'left' | 'right'): Promise<void> {
  const box = await page.locator('#game').boundingBox();
  if (!box) throw new Error('Classic canvas disappeared before a real mouse action.');
  const position = mousePositions.get(page) ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(position.x, position.y, { button });
  mousePositions.set(page, position);
}
