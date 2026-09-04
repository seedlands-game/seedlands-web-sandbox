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
  worldRevision: number;
  structuralEventCount: number;
  remeshSchedulingCount: number;
  lastCommitMutationCount: number;
  lastCommitMeshChunkCount: number;
  storageBytes: number;
  worldTime: number;
  timePaused: boolean;
  quality: 'low' | 'medium' | 'high';
  triangles: number;
  drawCalls: number;
  runtime: 'integrated-server';
  serverRevision: number;
  voxelAtOrigin: number;
  serverPlayerPosition: [number, number, number];
  serverWorldTime: number;
  performance: {
    scenarioId: string;
    frame: {
      count: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      maxMs: number;
      longFrameCount: number;
      lastLongFrameMs: number;
    };
    chunkVisible: { count: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
    completedChunkTraces: number;
    traceEventCount: number;
    maxMeshCommitsInFrame: number;
    maxMeshPartsInFrame: number;
    visibleAfterPostrender: boolean;
    incidents: number;
    droppedEvents: number;
    uploadQueueDepth: number;
    estimatedMeshBytes: number;
  };
};

type HarnessWindow = Window & {
  __seedlandsHarness?: {
    snapshot: () => HarnessSnapshot;
    beginPerformanceScenario: (name: string) => string;
    setStreamingVariant: (variant: 'main-snapshot' | 'worker-first') => void;
    removeVoxelAt: (x: number, y: number, z: number) => void;
    fillWorld: (command: { from: [number, number, number]; to: [number, number, number]; voxel: number }) => void;
    movePlayerTo: (x: number, y: number, z: number) => void;
    prepareFlatMovement: () => void;
    prepareCenterExcavation: () => void;
    prepareStepDown: () => void;
    setWorldTime: (hour: number) => void;
    setTimePaused: (paused: boolean) => void;
    setTimeSpeed: (speed: number) => void;
    setView: (yaw: number, pitch: number) => void;
    setSpectatorPosition: (x: number, y: number, z: number) => void;
  };
};

export async function startHarnessWorld(page: Page, seed: string, query = ''): Promise<void> {
  await page.goto(`./?harness=1${query}`, { waitUntil: 'networkidle' });
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

export async function waitForPlayerMovement(
  page: Page,
  expectation: {
    axis: 0 | 1 | 2;
    start: number;
    minimumDelta: number;
    direction?: -1 | 1;
    yTarget?: number;
    yTolerance?: number;
  },
): Promise<HarnessSnapshot> {
  try {
    await page.waitForFunction(
      (expected) => {
        const current = (window as HarnessWindow).__seedlandsHarness?.snapshot();
        if (!current) return false;
        const delta = current.player[expected.axis] - expected.start;
        const moved = expected.direction
          ? delta * expected.direction > expected.minimumDelta
          : Math.abs(delta) > expected.minimumDelta;
        const atExpectedHeight =
          expected.yTarget === undefined ||
          Math.abs(current.player[1] - expected.yTarget) < (expected.yTolerance ?? 0.05);
        return moved && atExpectedHeight;
      },
      expectation,
      { timeout: 15_000 },
    );
  } catch (error) {
    throw new Error(`Player movement did not satisfy the expected condition: ${JSON.stringify(await snapshot(page))}`, {
      cause: error,
    });
  }
  const current = await snapshot(page);
  if (!current) throw new Error('Seedlands harness snapshot is unavailable after player movement.');
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

export async function fillHarnessWorld(
  page: Page,
  from: [number, number, number],
  to: [number, number, number],
  voxel: number,
): Promise<void> {
  await page.evaluate(
    ({ from: fillFrom, to: fillTo, voxel: fillVoxel }) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands harness fill entry is unavailable.');
      harness.fillWorld({ from: fillFrom, to: fillTo, voxel: fillVoxel });
    },
    { from, to, voxel },
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

export async function prepareCenterExcavation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as HarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Seedlands center-excavation fixture is unavailable.');
    harness.prepareCenterExcavation();
  });
}

export async function prepareStepDown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as HarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Seedlands step-down fixture is unavailable.');
    harness.prepareStepDown();
  });
}

export async function setHarnessWorldTime(page: Page, hour: number, paused = true): Promise<void> {
  await page.evaluate(
    ([targetHour, shouldPause]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands environment controls are unavailable.');
      harness.setWorldTime(targetHour);
      harness.setTimePaused(shouldPause);
    },
    [hour, paused] as const,
  );
}

export async function setHarnessView(page: Page, yaw: number, pitch: number): Promise<void> {
  await page.evaluate(
    ([targetYaw, targetPitch]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands view controls are unavailable.');
      harness.setView(targetYaw, targetPitch);
    },
    [yaw, pitch] as const,
  );
}

export async function moveHarnessSpectator(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate(
    ([targetX, targetY, targetZ]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands spectator controls are unavailable.');
      harness.setSpectatorPosition(targetX, targetY, targetZ);
    },
    [x, y, z] as const,
  );
}
