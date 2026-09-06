import { test } from '@playwright/test';
import { runNaturalJourney } from './natural-journey-flow';

test('自然资源到工具、采石、建造照明、危险与存档的完整旅程', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await runNaturalJourney(page, testInfo);
});
