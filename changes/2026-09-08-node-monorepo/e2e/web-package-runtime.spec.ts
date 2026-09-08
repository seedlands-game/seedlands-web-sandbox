import { expect, test } from '@playwright/test';
import { snapshot, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('Web package starts and renders through the explicit TypeScript fallback', async ({ page }) => {
  await startHarnessWorld(page, 'monorepo-typescript-fallback', '&renderer=webgl2&wasm=off&simd=off');

  const state = await snapshot(page);
  expect(state).not.toBeNull();
  expect(state?.experiments.requested.wasm).toBe(false);
  expect(state?.loadedChunks).toBeGreaterThan(0);
  expect(state?.renderedChunks).toBeGreaterThan(0);
  expect(state?.experiments.workers.filter(({ lane }) => lane === 'general')).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: 'off', effectiveArtifact: 'off' })]),
  );
});
