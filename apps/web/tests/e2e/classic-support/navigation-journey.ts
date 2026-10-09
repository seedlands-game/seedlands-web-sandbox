import { expect, type Page, type TestInfo } from '@playwright/test';
import type { NavigationItemsCheckpoint } from '@seedlands/stdlib/server/gameplay/navigation-items-runtime';
import { clickCanvasCenter, closeInventory, playerState, type ClassicWindow } from './harness';

export async function navigationCheckpoint(page: Page): Promise<NavigationItemsCheckpoint> {
  return page.evaluate(async () => {
    const result = await (window as unknown as ClassicWindow).__seedlandsHarness?.world.checkpoint({ kind: 'export' });
    if (!result?.ok) throw new Error('Navigation checkpoint export failed.');
    const data = result.data as { snapshot: { gameplay: { navigationItems?: NavigationItemsCheckpoint } } };
    const navigation = data.snapshot.gameplay.navigationItems;
    if (!navigation) throw new Error('Navigation owner checkpoint is missing.');
    return navigation;
  });
}

async function select(page: Page, itemId: 'compass' | 'clock' | 'map') {
  const name = { compass: '指南针', clock: '时钟', map: '地图' }[itemId];
  await page.keyboard.press('KeyE');
  const survival = page.getByRole('dialog', { name: '背包与合成' });
  if (await survival.isVisible()) await survival.getByRole('button', { name: '切换创造模式', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await expect(catalog).toBeVisible();
  await catalog.locator('#creative-item-filter').fill(name);
  await catalog.getByRole('button', { name: new RegExp(`^将${name}放入创造快捷栏 `) }).click();
  await closeInventory(page);
  await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute('data-item', itemId);
  await expect(page.locator('#navigation-item-hud')).toHaveAttribute('data-kind', itemId);
}

async function returnToSurvival(page: Page) {
  await page.keyboard.press('KeyE');
  await page
    .getByRole('dialog', { name: '创造内容目录' })
    .getByRole('button', { name: '切换生存模式', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
  await closeInventory(page);
  await expect(page.locator('#navigation-item-hud')).toBeHidden();
}

async function expectMapHud(page: Page, checkpoint: NavigationItemsCheckpoint) {
  expect(checkpoint.maps).toHaveLength(1);
  const map = checkpoint.maps[0]!;
  const svg = page.locator('#navigation-item-hud svg');
  await expect(svg).toHaveAttribute('data-map-id', map.id);
  await expect(svg).toHaveAttribute('data-pixel-count', String(map.pixels.length));
  expect(map.pixels.find(({ x, z }) => x === 0 && z === 0)?.color).toBe(6);
  await expect(svg.locator('rect[x="-0.5"][y="-0.5"]')).toHaveAttribute('data-color', '6');
}

export async function completeNavigationBeforeSave(page: Page, info: TestInfo) {
  const inventory = (await playerState(page)).inventory;
  await select(page, 'compass');
  const turns = Number(await page.locator('#navigation-item-hud svg').getAttribute('data-turns'));
  expect(Number.isFinite(turns) && turns >= 0 && turns < 1).toBe(true);
  await select(page, 'clock');
  const phase = Number(await page.locator('#navigation-item-hud svg').getAttribute('data-phase'));
  expect(Number.isFinite(phase) && phase >= 0 && phase < 1).toBe(true);
  await select(page, 'map');
  await expect(page.locator('#navigation-item-hud')).toContainText('尚未探索');
  await clickCanvasCenter(page, 'right');
  await expect(page.locator('#navigation-item-hud svg')).toBeVisible();
  const first = await navigationCheckpoint(page);
  await expectMapHud(page, first);
  const revision = Number(await page.locator('#navigation-item-hud svg').getAttribute('data-navigation-revision'));
  expect(Number.isSafeInteger(revision) && revision > 0).toBe(true);
  await clickCanvasCenter(page, 'right');
  await expect
    .poll(async () => Number(await page.locator('#navigation-item-hud svg').getAttribute('data-navigation-revision')))
    .toBeGreaterThan(revision);
  const updated = await navigationCheckpoint(page);
  expect(updated.sequence).toBe(first.sequence);
  expect(updated.maps[0]!.id).toBe(first.maps[0]!.id);
  await expectMapHud(page, updated);
  await info.attach('navigation-creative-map.png', { contentType: 'image/png', body: await page.screenshot() });
  await returnToSurvival(page);
  expect((await playerState(page)).inventory).toEqual(inventory);
  return updated;
}

export async function verifyNavigationAfterRestore(page: Page, info: TestInfo, before: NavigationItemsCheckpoint) {
  const restored = await navigationCheckpoint(page);
  expect(restored).toEqual(before);
  const inventory = (await playerState(page)).inventory;
  await select(page, 'map');
  await expectMapHud(page, restored);
  await info.attach('navigation-restored-map.png', { contentType: 'image/png', body: await page.screenshot() });
  await returnToSurvival(page);
  expect((await playerState(page)).inventory).toEqual(inventory);
  return restored;
}
