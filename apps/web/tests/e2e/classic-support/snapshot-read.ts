import type { Page } from '@playwright/test';
import type { ClassicWindow } from './harness';

export const snapshot = (page: Page) =>
  page.evaluate((withPhysics) => {
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness;
    const observed = harness?.snapshot() ?? null;
    if (!observed || !withPhysics) return observed;
    const diagnostics = harness?.physicsDiagnostics?.();
    const matches =
      diagnostics &&
      diagnostics.epoch === observed.nativeMovementInput?.epoch &&
      diagnostics.physicsTick === observed.authority.physicsTick &&
      diagnostics.acknowledgedInputSequence === observed.authority.acknowledgedInputSequence;
    return { ...observed, physicsDiagnostics: matches ? diagnostics : null };
  }, process.env.SEEDLANDS_CLASSIC_BENCHMARK !== '1');
