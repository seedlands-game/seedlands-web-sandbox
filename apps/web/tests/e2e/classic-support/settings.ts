import { expect, type Page, type TestInfo } from '@playwright/test';

export const classicBenchmark = {
  enabled: process.env.SEEDLANDS_CLASSIC_BENCHMARK === '1',
  generalWorkers:
    process.env.SEEDLANDS_CLASSIC_GENERAL_WORKERS === '1'
      ? 1
      : process.env.SEEDLANDS_CLASSIC_GENERAL_WORKERS === '2'
        ? 2
        : undefined,
} as const;

export type ClassicMainExecutionBudget = Readonly<{ timeoutMs: 900_000 | 1_800_000; diagnosticOnly: boolean }>;

export function readClassicMainExecutionBudget(
  environment: Readonly<Record<string, string | undefined>>,
): ClassicMainExecutionBudget {
  const requested = environment.SEEDLANDS_CLASSIC_DIAGNOSTIC_MAIN_BUDGET;
  if (requested === undefined) return { timeoutMs: 900_000, diagnosticOnly: false };
  if (requested !== '30m') throw new Error('Unsupported diagnostic main execution window.');
  if (environment.CI || environment.GITHUB_ACTIONS) throw new Error('Extended main execution is disabled in CI.');
  if (environment.SEEDLANDS_CLASSIC_BENCHMARK === '1')
    throw new Error('Extended main execution cannot be combined with benchmark.');
  return { timeoutMs: 1_800_000, diagnosticOnly: true };
}

export async function configureClassicMainExecutionBudget(testInfo: TestInfo): Promise<ClassicMainExecutionBudget> {
  const budget = readClassicMainExecutionBudget(process.env);
  if (budget.diagnosticOnly) {
    testInfo.setTimeout(budget.timeoutMs);
    await testInfo.attach('classic-main-execution-budget.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        ...budget,
        eligible: false,
        canonicalTimeoutMs: 900_000,
        sourceSha: process.env.SEEDLANDS_SOURCE_SHA ?? null,
        note: 'Private diagnostic only; all original local timeouts and assertions remain in effect.',
      }),
    });
  }
  return budget;
}

export function requireHeadlessClassic(headless: boolean, launchOptions: Readonly<{ headless?: boolean }>): void {
  if (!headless || launchOptions.headless === false)
    throw new Error(
      'Classic acceptance requires bundled Chromium in headless mode; native browser windows are forbidden.',
    );
}

export async function configureClassicSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#mouse-sensitivity').fill('0.25');
  await expect(page.locator('#mouse-sensitivity')).toHaveValue('0.25');
  await page.locator('#mouse-sensitivity').fill('0.13');
  await page.locator('#settings-difficulty').selectOption('hard');
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeEnabled();
  await page.locator('#settings-difficulty').selectOption('normal');
  const back = page.getByRole('button', { name: '返回', exact: true });
  await expect(back).toBeEnabled();
  await expect(page.locator('#settings-difficulty')).toHaveValue('normal');
  await back.click();
  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
}

export async function deleteClassicWorld(page: Page, seed: string, generatorVersion: number): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存并返回主菜单', exact: true }).click();
  const remove = page.getByRole('button', { name: `删除世界 ${seed} v${generatorVersion}`, exact: true });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(remove).toHaveCount(0);
}
