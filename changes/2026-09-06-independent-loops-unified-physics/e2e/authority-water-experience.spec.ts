import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type AudioWindow = Window & {
  __seedlandsAudio: { snapshot(): { unlocked: boolean; underwaterFilterHz: number; recentSounds: { key: string }[] } };
};
const state = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());
const audio = (page: Page) => page.evaluate(() => (window as unknown as AudioWindow).__seedlandsAudio.snapshot());

test.use({ video: 'on' });

test('真实走入水体、下潜与浮出连通物理介质、视觉滤镜和生产音频', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await startHarnessWorld(page, 'authority-water-medium');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness as unknown as HarnessApi;
    await h.fillWorld({ from: [-5, 48, -5], to: [6, 56, 5], voxel: 0 });
    await h.fillWorld({ from: [-5, 48, -5], to: [6, 48, 5], voxel: 3 });
    await h.fillWorld({ from: [-5, 49, -5], to: [-5, 51, 5], voxel: 3 });
    await h.fillWorld({ from: [-5, 49, -5], to: [6, 51, -5], voxel: 3 });
    await h.fillWorld({ from: [-5, 49, 5], to: [6, 51, 5], voxel: 3 });
    await h.fillWorld({ from: [4, 49, -5], to: [6, 51, 5], voxel: 3 });
    await h.fillWorld({ from: [-4, 49, -4], to: [3, 51, 4], voxel: 8 });
    await h.movePlayerTo(5.5, 53.6, 0.5);
    h.setView(90, -8);
  });
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding && Math.abs(s.serverPlayerPosition[0] - 5.5) < 0.01);
  await lockPointer(page);
  const dry = await state(page);
  expect(dry.water.bodyFraction).toBe(0);
  expect((await audio(page)).unlocked).toBe(true);
  await testInfo.attach('medium-01-shore', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.down('KeyW');
  try {
    await expect.poll(async () => (await state(page)).water.bodyFraction).toBeGreaterThan(0.4);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const partial = await state(page);
  expect(partial.water.wading).toBe(true);
  await expect
    .poll(async () => (await audio(page)).recentSounds.some((sound) => sound.key === 'water-enter'))
    .toBe(true);
  await testInfo.attach('medium-02-entry', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.down('ShiftLeft');
  try {
    await expect.poll(async () => (await state(page)).water.cameraSubmerged).toBe(true);
    await expect.poll(async () => (await state(page)).water.underwaterBlend).toBeGreaterThan(0.8);
  } finally {
    await page.keyboard.up('ShiftLeft');
  }
  const submerged = await state(page);
  expect(submerged.water.bodyFraction).toBeGreaterThan(0.9);
  expect(submerged.water.swimming).toBe(true);
  await expect.poll(async () => (await audio(page)).underwaterFilterHz).toBeLessThan(3000);
  await testInfo.attach('medium-03-submerged', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.down('Space');
  try {
    await expect.poll(async () => (await state(page)).water.cameraSubmerged).toBe(false);
    await expect.poll(async () => (await state(page)).water.underwaterBlend).toBeLessThan(0.2);
  } finally {
    await page.keyboard.up('Space');
  }
  await expect.poll(async () => (await audio(page)).underwaterFilterHz).toBeGreaterThan(15000);
  const emerged = await state(page);
  expect(emerged.colliding).toBe(false);
  await testInfo.attach('medium-04-emerged', { body: await page.screenshot(), contentType: 'image/png' });
  await testInfo.attach('medium-physical-audio-evidence', {
    body: JSON.stringify({
      dry: dry.water,
      partial: partial.water,
      submerged: submerged.water,
      emerged: emerged.water,
      audio: await audio(page),
    }),
    contentType: 'application/json',
  });
});
