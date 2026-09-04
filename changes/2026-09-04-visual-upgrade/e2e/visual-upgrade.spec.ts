import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { macroAt, type MacroBiome } from '../../../src/world/macro-world';
import { normalizeSeed } from '../../../src/world/voxel';
import {
  moveHarnessSpectator,
  setHarnessView,
  setHarnessWorldTime,
  snapshot,
  startHarnessWorld,
  waitForSnapshot,
} from '../../../tests/e2e/support/harness';

const seedText = 'seedlands-visual-regression';
const seed = normalizeSeed(seedText);
const screenshotDirectory = 'test-results/visual-upgrade';

function findEnvironment(predicate: (biome: MacroBiome, water: boolean) => boolean) {
  for (let radius = 0; radius <= 1536; radius += 48)
    for (let z = -radius; z <= radius; z += 48)
      for (let x = -radius; x <= radius; x += 48) {
        if (Math.abs(x) !== radius && Math.abs(z) !== radius) continue;
        const context = macroAt(seed, x, z);
        if (predicate(context.biome, context.hydrology.water)) return { x, z, context };
      }
  throw new Error('Could not locate the requested deterministic visual environment.');
}

test.describe.serial('Seedlands visual upgrade', () => {
  test.beforeAll(async () => {
    await mkdir(screenshotDirectory, { recursive: true });
  });

  test('exposes a clean player HUD and deterministic environment controls', async ({ page }) => {
    await startHarnessWorld(page, seedText);
    await expect(page.locator('#hotbar .slot')).toHaveCount(4);
    await expect(page.locator('#world-clock')).toContainText('Day');
    await expect(page.locator('#crosshair')).toBeVisible();

    await setHarnessWorldTime(page, 18.5);
    await waitForSnapshot(page, (current) => current.timePaused && Math.abs(current.worldTime - 18.5) < 0.01);
    await expect(page.locator('#world-clock')).toContainText('Sunset');
    const sunsetSky = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--sky-top'),
    );

    await setHarnessWorldTime(page, 23);
    await waitForSnapshot(page, (current) => current.timePaused && Math.abs(current.worldTime - 23) < 0.01);
    await expect(page.locator('#world-clock')).toContainText('Night');
    const nightSky = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--sky-top'),
    );
    expect(nightSky).not.toBe(sunsetSky);

    await page.keyboard.press('F3');
    await expect(page.locator('#debug')).toBeHidden();
    await page.keyboard.press('F3');
    await expect(page.locator('#debug')).toBeVisible();
    await expect(page.locator('#debug')).toContainText('Triangles');
  });

  test('renders representative biomes, natural water, and three times of day', async ({ page }) => {
    await startHarnessWorld(page, seedText);
    await page.keyboard.press('F3');
    await setHarnessView(page, 28, -18);
    const environments = [
      ['plains', findEnvironment((biome, water) => biome === 'plains' && !water)],
      ['forest', findEnvironment((biome, water) => biome === 'forest' && !water)],
      ['mountain', findEnvironment((biome, water) => biome === 'mountain' && !water)],
      ['water', findEnvironment((_biome, water) => water)],
    ] as const;

    await setHarnessWorldTime(page, 10);
    for (const [name, location] of environments) {
      const y = (location.context.hydrology.waterLevel ?? location.context.terrainHeight) + 9;
      await moveHarnessSpectator(page, location.x + 0.5, y + 1.6, location.z + 0.5);
      await waitForSnapshot(
        page,
        (current) =>
          current.streamCenter[0] === Math.floor(current.player[0] / 32) &&
          current.generationQueue === 0 &&
          current.meshingQueue === 0 &&
          current.loadedChunks > 0 &&
          current.triangles > 0,
      );
      await page.screenshot({ path: `${screenshotDirectory}/${name}-day.png` });
    }

    for (const [name, hour] of [
      ['sunset', 18.5],
      ['night', 23],
    ] as const) {
      await setHarnessWorldTime(page, hour);
      const environment = await snapshot(page);
      expect(environment?.worldTime).toBeCloseTo(hour, 2);
      await page.screenshot({ path: `${screenshotDirectory}/water-${name}.png` });
    }
  });
});
