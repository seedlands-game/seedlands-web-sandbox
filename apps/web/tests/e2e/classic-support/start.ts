import { expect, type Page } from '@playwright/test';
import { waitForSnapshot } from './harness';
import type { ClassicScenario } from './scenario';

export async function startClassicWorld(
  page: Page,
  scenario: ClassicScenario,
  generalWorkerCount?: 1 | 2,
): Promise<void> {
  const query = new URLSearchParams({
    harness: '1',
    playbook: 'classic',
    renderer: scenario.runtime.renderer,
    wasm: scenario.runtime.wasm ? 'on' : 'off',
    simd: scenario.runtime.simd ? 'on' : 'off',
    ...(generalWorkerCount ? { generalWorkers: String(generalWorkerCount) } : {}),
  });
  await page.addInitScript(() => {
    localStorage.setItem('seedlands.audio.v1', JSON.stringify({ master: 0, music: 0, ambience: 0, sfx: 0, ui: 0 }));
  });
  await page.goto('./?' + query.toString(), { waitUntil: 'networkidle' });
  const playbook = page.locator('#playbook');
  if (await playbook.count()) {
    await playbook.selectOption('classic');
    await expect(playbook).toHaveValue('classic');
  }
  await page.locator('#quality').selectOption(scenario.quality);
  await page.locator('#seed').fill(scenario.seed);
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  const warning = page.getByRole('button', { name: '仍然进入', exact: true });
  if (await warning.isVisible()) await warning.click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await waitForSnapshot(page, (value) => value.loadedChunks > 0 && value.workers.authority === 1, 30_000);
  await page.keyboard.press('F3');
}
