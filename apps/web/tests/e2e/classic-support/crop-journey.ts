import { expect, type Page, type TestInfo } from '@playwright/test';
import type { HarnessCropStageSnapshot } from '../../../src/app/gameplay/game-harness-contract';
import { aimAtVoxelWithRealMouse } from './aim';
import { clickCanvasCenter, closeInventory, playerState, voxelAt, type ClassicWindow } from './harness';
import type { Point } from './scenario';
import { walkEquipmentRoute } from './equipment-journey-support';

const plots = [
  [67, 31, 2],
  [69, 31, 2],
] as const;
const presentationId = 'seedlands:wheat-crop';
const names = {
  'dirt-block': '泥土块',
  'wood-hoe': '木锄',
  'wheat-seeds': '小麦种子',
  'white-dye': '白色染料',
} as const;
export type CropJourneyState = Readonly<{ position: Point }>;

export const observeCrops = (page: Page): Promise<HarnessCropStageSnapshot | null> =>
  page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness?.cropStageSnapshot() ?? null);

async function selectCreative(page: Page, itemId: keyof typeof names) {
  await page.keyboard.press('KeyE');
  const survival = page.getByRole('dialog', { name: '背包与合成' });
  if (await survival.isVisible()) await survival.getByRole('button', { name: '切换创造模式', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await expect(catalog).toBeVisible();
  await catalog.locator('#creative-item-filter').fill(names[itemId]);
  await catalog.getByRole('button', { name: new RegExp(`^将${names[itemId]}放入创造快捷栏 `) }).click();
  await closeInventory(page);
  await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute('data-item', itemId);
}

async function returnToSurvival(page: Page) {
  await page.keyboard.press('KeyE');
  await page
    .getByRole('dialog', { name: '创造内容目录' })
    .getByRole('button', { name: '切换生存模式', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
  await closeInventory(page);
}

async function interact(page: Page, position: Point) {
  await aimAtVoxelWithRealMouse(page, position);
  await clickCanvasCenter(page, 'right');
}

async function expectCrop(page: Page, position: Point, stage: number | null) {
  let accepted: HarnessCropStageSnapshot | null = null;
  await expect
    .poll(
      async () => {
        accepted = await observeCrops(page);
        if (!accepted) return false;
        const same = (cell: Point) => cell.every((value, index) => value === position[index]);
        const crop = accepted.cropStages.find((entry) => same(entry.position));
        const batch = accepted.renderedBatches.find((entry) => entry.positions.some(same));
        if (stage === null) return !crop && !batch;
        return (
          crop?.stage === stage &&
          crop.presentationId === presentationId &&
          batch?.stage === stage &&
          batch.presentationId === presentationId &&
          batch.enabled &&
          batch.lightingBound &&
          batch.vertexCount === batch.positions.length * 8 &&
          batch.indexCount === batch.positions.length * 12
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return accepted!;
}

async function capture(page: Page, info: TestInfo, name: string, value: HarnessCropStageSnapshot) {
  await info.attach(name, { body: JSON.stringify(value), contentType: 'application/json' });
  await info.attach(`${name}-screen`, { body: await page.screenshot(), contentType: 'image/png' });
}

/** Creative catalog/actions prove rendering and lifecycle; Survival agriculture is a separate acceptance. */
export async function completeCropJourneyBeforeSave(page: Page, info: TestInfo): Promise<CropJourneyState> {
  const inventoryBefore = (await playerState(page)).inventory;
  for (const [index, position] of plots.entries()) {
    await selectCreative(page, 'dirt-block');
    expect(await voxelAt(page, position)).toBe(0);
    expect(await voxelAt(page, [position[0], position[1] - 1, position[2]])).toBe(3);
    await walkEquipmentRoute(page, [position[0] - 1.5, position[2] - 1.5]);
    await aimAtVoxelWithRealMouse(page, [position[0], position[1] - 1, position[2]], position);
    await clickCanvasCenter(page, 'right');
    await expect.poll(() => voxelAt(page, position)).toBe(2);
    await selectCreative(page, 'wood-hoe');
    await interact(page, position);
    await expect.poll(() => voxelAt(page, position)).toBe(26);
    await selectCreative(page, 'wheat-seeds');
    await interact(page, position);
    await capture(page, info, `crop-creative-${index}-stage-0`, await expectCrop(page, position, 0));
    await selectCreative(page, 'white-dye');
    await interact(page, position);
    await capture(page, info, `crop-creative-${index}-stage-7`, await expectCrop(page, position, 7));
    if (index === 0) {
      await selectCreative(page, 'dirt-block');
      await interact(page, position);
      await capture(page, info, 'crop-creative-harvested', await expectCrop(page, position, null));
      await expect.poll(() => voxelAt(page, position)).toBe(26);
    }
  }
  await returnToSurvival(page);
  expect((await playerState(page)).inventory).toEqual(inventoryBefore);
  return { position: plots[1] };
}

export const expectCropForSave = (page: Page, state: CropJourneyState) => expectCrop(page, state.position, 7);

export async function verifyCropAfterRestore(
  page: Page,
  info: TestInfo,
  state: CropJourneyState,
  before: HarnessCropStageSnapshot,
) {
  await walkEquipmentRoute(page, [state.position[0] - 1.5, state.position[2] - 1.5]);
  const restored = await expectCrop(page, state.position, 7);
  expect(restored.runtimeEpoch).not.toBe(before.runtimeEpoch);
  expect(restored.cropStages).toEqual(before.cropStages);
  await capture(page, info, 'crop-restored', restored);
  const inventoryBefore = (await playerState(page)).inventory;
  await selectCreative(page, 'dirt-block');
  await interact(page, state.position);
  await capture(page, info, 'crop-restored-harvested', await expectCrop(page, state.position, null));
  await expect.poll(() => voxelAt(page, state.position)).toBe(26);
  await returnToSurvival(page);
  expect((await playerState(page)).inventory).toEqual(inventoryBefore);
  return restored;
}
