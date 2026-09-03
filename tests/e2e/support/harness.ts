import type { Locator, Page } from '@playwright/test';

export type HarnessSnapshot = {
  frameMs: number;
  player: [number, number, number];
  streamCenter: [number, number];
  loadedChunks: number;
  renderedChunks: number;
  generationQueue: number;
  meshingQueue: number;
  onGround: boolean;
  colliding: boolean;
  interactionAttempts: number;
  mutationCount: number;
  storageBytes: number;
};

type HarnessWindow = Window & {
  __seedlandsHarness?: {
    snapshot: () => HarnessSnapshot;
    removeVoxelAt: (x: number, y: number, z: number) => void;
    movePlayerTo: (x: number, y: number, z: number) => void;
    prepareFlatMovement: () => void;
  };
};

export async function startHarnessWorld(page: Page, seed: string): Promise<void> {
  await page.goto('/?harness=1', { waitUntil: 'networkidle' });
  await page.locator('#seed').fill(seed);
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });
  await waitForSnapshot(page, (snapshot) => snapshot.loadedChunks > 0);
}

export async function snapshot(page: Page): Promise<HarnessSnapshot | null> {
  return page.evaluate(() => (window as HarnessWindow).__seedlandsHarness?.snapshot() ?? null);
}

export async function waitForSnapshot(
  page: Page,
  predicate: (snapshot: HarnessSnapshot) => boolean,
): Promise<HarnessSnapshot> {
  try {
    await page.waitForFunction(
      (predicateSource) => {
        const harness = (window as HarnessWindow).__seedlandsHarness;
        if (!harness) return false;
        const matches = new Function('snapshot', `return (${predicateSource})(snapshot);`) as (
          snapshot: HarnessSnapshot,
        ) => boolean;
        return matches(harness.snapshot());
      },
      predicate.toString(),
      { timeout: 15_000 },
    );
  } catch (error) {
    throw new Error(`Harness state did not satisfy the expected condition: ${JSON.stringify(await snapshot(page))}`, {
      cause: error,
    });
  }
  const current = await snapshot(page);
  if (!current) throw new Error('Seedlands harness snapshot is unavailable after the wait completed.');
  return current;
}

export async function lockPointer(page: Page): Promise<Locator> {
  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas has no visible bounding box.');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game', undefined, { timeout: 5_000 });
  return canvas;
}

export async function clickCanvasCenter(page: Page, button: 'left' | 'right'): Promise<void> {
  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas has no visible bounding box.');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button });
}

export async function removeHarnessVoxel(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate(
    ([targetX, targetY, targetZ]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands harness edit entry is unavailable.');
      harness.removeVoxelAt(targetX, targetY, targetZ);
    },
    [x, y, z],
  );
}

export async function moveHarnessPlayer(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate(
    ([targetX, targetY, targetZ]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands harness movement entry is unavailable.');
      harness.movePlayerTo(targetX, targetY, targetZ);
    },
    [x, y, z],
  );
}

export async function prepareFlatMovement(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as HarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Seedlands flat-movement fixture is unavailable.');
    harness.prepareFlatMovement();
  });
}
