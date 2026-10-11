import { expect, type Page } from '@playwright/test';
import type { ClassicWindow } from './harness';
import type { ClassicSnapshot } from './harness-snapshot';
import type { Point } from './scenario';

export function readClassicVoxelInBrowser(target: Point) {
  return (window as unknown as ClassicWindow).__seedlandsHarness?.getVoxelAt?.(...target) ?? null;
}

export function readClassicSnapshotInBrowser(withPhysics: boolean) {
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
}

export const snapshot = (page: Page) =>
  page.evaluate(readClassicSnapshotInBrowser, process.env.SEEDLANDS_CLASSIC_BENCHMARK !== '1');

export async function waitForSnapshot(
  page: Page,
  predicate: (value: ClassicSnapshot) => boolean,
  timeout = 20_000,
  observe: () => Promise<ClassicSnapshot | null> = () => snapshot(page),
): Promise<ClassicSnapshot> {
  let matched: ClassicSnapshot | null = null;
  await expect
    .poll(
      async () => {
        const current = await observe();
        if (!current || !predicate(current)) return false;
        matched = structuredClone(current);
        return true;
      },
      { timeout, intervals: [16, 32, 64, 100] },
    )
    .toBe(true);
  return matched!;
}
