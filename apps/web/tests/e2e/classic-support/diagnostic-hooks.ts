import type { test as classicTest, Page, TestInfo } from '@playwright/test';
import { requireHeadlessClassic } from './settings';
import { attachClassicFailureWithInput, type ClassicStage, type ClassicStageResult } from './evidence';
import { startClassicCpuProfile, stopClassicCpuProfile } from './cpu-profile';

type DiagnosticState = Readonly<{
  stages: Partial<Record<ClassicStage, ClassicStageResult>>;
  benchmark: boolean;
  restore: Readonly<Record<string, unknown>> | undefined;
  skip: boolean;
}>;

async function finishOriginalEvidence(page: Page, info: TestInfo, state: DiagnosticState): Promise<void> {
  if (!page.isClosed()) await page.evaluate(() => document.exitPointerLock()).catch(() => {});
  if (state.skip || info.title.startsWith('Classic 视觉')) return;
  await attachClassicFailureWithInput(page, info, state.stages, state.benchmark, state.restore);
}

export function installClassicDiagnosticHooks(test: typeof classicTest, state: () => DiagnosticState): void {
  test.beforeAll(async ({ headless, launchOptions }) => {
    requireHeadlessClassic(headless, launchOptions);
  });
  test.beforeEach(({ page }, info) => startClassicCpuProfile(page, info, state().benchmark));
  test.afterEach(async ({ page }, info) => {
    try {
      await stopClassicCpuProfile(page, info);
    } finally {
      await finishOriginalEvidence(page, info, state());
    }
  });
}
