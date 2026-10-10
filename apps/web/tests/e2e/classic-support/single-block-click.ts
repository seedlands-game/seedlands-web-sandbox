import type { Page } from '@playwright/test';
import { clickCanvasCenter } from './mouse-input';

/** The visual regression requests one real click, not a held mining gesture. */
export async function clickSingleBlockWithRealMouse(page: Page): Promise<void> {
  try {
    await clickCanvasCenter(page, 'left');
  } catch (error) {
    await Promise.allSettled([page.mouse.up({ button: 'left' })]);
    throw error;
  }
}
