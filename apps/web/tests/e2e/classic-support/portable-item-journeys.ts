import { expect, test, type Page, type TestInfo } from '@playwright/test';
import * as crops from './crop-journey';
import * as navigation from './navigation-journey';

export async function completeBeforeSave(page: Page, info: TestInfo) {
  const crop = await test.step('Creative 正常作物输入与实际批次', () =>
    crops.completeCropJourneyBeforeSave(page, info));
  const nav = await test.step('Creative 导航选择、右键注册更新与实际 HUD', () =>
    navigation.completeNavigationBeforeSave(page, info));
  return { crop, navigation: nav };
}
export async function expectForSave(page: Page, state: Awaited<ReturnType<typeof completeBeforeSave>>) {
  const crop = await crops.expectCropForSave(page, state.crop);
  const nav = await navigation.navigationCheckpoint(page);
  expect(nav).toEqual(state.navigation);
  return { crop, navigation: nav };
}
export async function verifyAfterRestore(
  page: Page,
  info: TestInfo,
  state: Awaited<ReturnType<typeof completeBeforeSave>>,
  before: Awaited<ReturnType<typeof expectForSave>>,
) {
  const crop = await crops.verifyCropAfterRestore(page, info, state.crop, before.crop);
  const nav = await navigation.verifyNavigationAfterRestore(page, info, before.navigation);
  return { crop, navigation: nav };
}
