import type { test as classicTest, Page, TestInfo } from '@playwright/test';
import { requireHeadlessClassic } from './settings';
import { attachClassicFailureWithInput, type ClassicStage, type ClassicStageResult } from './evidence';
import { startClassicCpuProfile, stopClassicCpuProfile } from './cpu-profile';
import { startClassicNativeTrace, stopClassicNativeTrace } from './native-trace';
import { startClassicAuthorityCpuProfile, stopClassicAuthorityCpuProfile } from './authority-cpu-profile';
import { startClassicKeyboardTiming, stopClassicKeyboardTiming } from './keyboard-timing';

type DiagnosticState = Readonly<{
  stages: Partial<Record<ClassicStage, ClassicStageResult>>;
  benchmark: boolean;
  restore: Readonly<Record<string, unknown>> | undefined;
  skip: boolean;
}>;

async function finishOriginalEvidence(page: Page, info: TestInfo, state: DiagnosticState): Promise<void> {
  if (!page.isClosed()) await page.evaluate(() => document.exitPointerLock()).catch(() => {});
  if (state.skip || info.title.startsWith('Classic 视觉') || info.title.startsWith('Classic 普通矿车')) return;
  await attachClassicFailureWithInput(page, info, state.stages, state.benchmark, state.restore);
}

export function installClassicDiagnosticHooks(test: typeof classicTest, state: () => DiagnosticState): void {
  test.beforeAll(async ({ headless, launchOptions }) => {
    requireHeadlessClassic(headless, launchOptions);
  });
  test.beforeEach(async ({ page }, info) => {
    await startClassicKeyboardTiming(page, info, state().benchmark);
    await startClassicAuthorityCpuProfile(page, info, state().benchmark);
    await startClassicNativeTrace(page, info, state().benchmark);
    await startClassicCpuProfile(page, info, state().benchmark);
  });
  test.afterEach(async ({ page }, info) => {
    const errors: unknown[] = [];
    for (const operation of [
      () => stopClassicKeyboardTiming(page, info),
      () => stopClassicAuthorityCpuProfile(page, info),
      () => stopClassicNativeTrace(page, info),
      () => stopClassicCpuProfile(page, info),
      () => finishOriginalEvidence(page, info, state()),
    ]) {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Classic diagnostic/evidence hooks failed.');
  });
}
