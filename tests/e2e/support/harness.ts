import type { Locator, Page } from '@playwright/test';

export type HarnessSnapshot = {
  frameMs: number;
  player: [number, number, number];
  streamCenter: [number, number];
  loadedChunks: number;
  renderedChunks: number;
  generationQueue: number;
  meshingQueue: number;
  deferredRemeshes: number;
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
  runtime: 'integrated-server' | 'authority-worker';
  authority: {
    physicsHz: 30 | 60 | 120;
    paused: boolean;
    physicsTick: number;
    commitSequence: number;
    acknowledgedInputSequence: number;
    snapshotRejections: Readonly<Record<string, number>>;
    residency: {
      residentCount: number;
      target: number;
      hardLimit: number;
      pinnedCount: number;
      dirtyCount: number;
      evictableCleanCount: number;
      evictionCount: number;
      rejectedAdmissionCount: number;
      oversubscribed: boolean;
      autoSaveInFlight: boolean;
      autoSaveFailureCount: number;
      nextRetryActiveTimeMs: number;
      lastSaveError: string | null;
    } | null;
  };
  generatorVersion: number;
  renderPipeline: {
    drawUnit: 'chunk-render-category';
    batchMode: 'category';
    vertexLayout: 'float16-uv-uint16-index';
    shaderMode: 'voxel-array-chunks';
    backend: 'webgl2' | 'webgpu';
  };
  experiments: {
    requested: { renderer: 'webgl2' | 'webgpu'; wasm: boolean; simd: boolean };
    kernels: readonly string[];
    renderer: {
      requestedRenderer: 'webgl2' | 'webgpu';
      effectiveRenderer: 'webgl2' | 'webgpu';
      rendererStatus: 'matched' | 'fallback';
    } | null;
    workers: readonly {
      epoch: string;
      lane: 'fluid' | 'general';
      index: number;
      status: 'off' | 'matched' | 'scalar-fallback' | 'typescript-fallback';
      requestedArtifact: 'simd' | 'scalar' | 'off';
      effectiveArtifact: 'simd' | 'scalar' | 'typescript' | 'off';
      selected: readonly string[];
      reason?: string;
      artifactSha256?: string;
    }[];
  };
  serverRevision: number;
  voxelAtOrigin: number;
  serverPlayerPosition: [number, number, number];
  serverPlayerVelocity: [number, number, number];
  prediction: {
    pendingFrames: number;
    lastResetReason: string | null;
    resetCounts: Readonly<Record<string, number>>;
    presentationOffset: Readonly<{ x: number; y: number; z: number }>;
  };
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
    chunkVisible: {
      count: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      maxMs: number;
    };
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
  fluidFeedback: {
    count: number;
    pending: boolean;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    samples: Array<{
      editToCommitMs: number;
      commitToWorkerStartMs: number;
      workerMs: number;
      workerToAttachMs: number;
      attachToVisibleMs: number;
      totalMs: number;
      mergedRequests: number;
      supersededInFlight: number;
    }>;
  };
  ui: {
    runtime: 'svelte5';
    shellPublishCount: number;
    hudPublishCount: number;
    interactionPublishCount: number;
    debugProjectionCount: number;
    debugPublishCount: number;
    staleUpdateCount: number;
    coalescedUpdateCount: number;
    domCommitCount: number;
    projectionDurationMs: number;
    publishDurationMs: number;
    domCommitDurationMs: number;
    debugProjectionRate: number;
    totalPublishRate: number;
  };
  gameplay: {
    entityCount: number;
    worldItemCount: number;
    creatureCount: number;
    npcCount: number;
    nearbyVisitedBucketCount: number;
    nearbyCandidateCount: number;
    nearbyReturnedCount: number;
    inventoryOperationCount: number;
    gameplayEventCount: number;
    snapshotBytes: number;
    retainedActorCount: number;
    activeActorCount: number;
    behaviorEvaluationCount: number;
    navigationPlanCount: number;
    navigationExpandedNodeCount: number;
    pathRecomputeCount: number;
    actionCompletionCount: number;
    actionFailureCount: number;
    actionInterruptionCount: number;
    perceptionLineOfSightCheckCount: number;
    simulationTime: number;
    presentedEntityCount: number;
  };
  breakingOverlay: { position: [number, number, number]; stage: number } | null;
  viewmodel: { isolatedLayer: boolean };
  visualEffects: {
    activeLocalLights: number;
    shadowedLocalLights: number;
    localLightLimit: number;
    localShadowLimit: number;
    sunShadows: boolean;
    sunShadowResolution: number;
    reflectionEnabled: boolean;
    reflectionActive: boolean;
    reflectionResolution: number;
    reflectionFrameInterval: number;
    reflectionRenderCount: number;
    waterPlaneY: number | null;
    postProcessing: boolean;
    shadowUpdateCount: number;
    shadowStableFrameCount: number;
  };
  water: {
    bodyFraction: number;
    wading: boolean;
    swimming: boolean;
    cameraSubmerged: boolean;
    cameraDepth: number;
    waterSurfaceY: number | null;
    underwaterBlend: number;
  };
};

type HarnessWindow = Window & {
  __seedlandsHarness?: {
    snapshot: () => HarnessSnapshot;
    beginPerformanceScenario: (name: string) => string;
    setStreamingVariant: (variant: 'main-snapshot' | 'worker-first') => void;
    removeVoxelAt: (x: number, y: number, z: number) => Promise<unknown>;
    fillWorld: (command: {
      from: [number, number, number];
      to: [number, number, number];
      voxel: number;
    }) => Promise<unknown>;
    movePlayerTo: (x: number, y: number, z: number) => Promise<unknown>;
    prepareFlatMovement: () => Promise<unknown>;
    prepareCenterExcavation: () => Promise<unknown>;
    prepareStepDown: () => Promise<unknown>;
    setWorldTime: (hour: number) => Promise<unknown>;
    setTimePaused: (paused: boolean) => void;
    setTimeSpeed: (speed: number) => void;
    setView: (yaw: number, pitch: number) => void;
    setSpectatorPosition: (x: number, y: number, z: number) => void;
    executeGameplayCommand: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
    advanceGameplay: (seconds: number) => void;
    setVoxelAt: (x: number, y: number, z: number, voxel: number) => Promise<unknown>;
    beginFluidFeedbackSample?: () => void;
    setWaterTransitionHold?: (held: boolean) => void;
    flushSave: () => Promise<void>;
    playerDamageFeedback: () => { pitch: number; yaw: number; roll: number; active: boolean };
  };
};

export async function startHarnessWorld(page: Page, seed: string, query = ''): Promise<void> {
  await page.goto(`./?harness=1${query}`, { waitUntil: 'networkidle' });
  await page.locator('#seed').fill(seed);
  await page.getByRole('button', { name: '进入世界' }).click();
  const continueDespiteWarning = page.getByRole('button', { name: '仍然进入' });
  if (await continueDespiteWarning.isVisible()) await continueDespiteWarning.click();
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
    const matchingSnapshot = await page.waitForFunction(
      (predicateSource) => {
        const harness = (window as HarnessWindow).__seedlandsHarness;
        if (!harness) return false;
        const current = harness.snapshot();
        const matches = new Function('snapshot', `return (${predicateSource})(snapshot);`) as (
          snapshot: HarnessSnapshot,
        ) => boolean;
        return matches(current) ? structuredClone(current) : false;
      },
      predicate.toString(),
      { timeout: 15_000 },
    );
    try {
      return (await matchingSnapshot.jsonValue()) as HarnessSnapshot;
    } finally {
      await matchingSnapshot.dispose();
    }
  } catch (error) {
    throw new Error(`Harness state did not satisfy the expected condition: ${JSON.stringify(await snapshot(page))}`, {
      cause: error,
    });
  }
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
    const matchingSnapshot = await page.waitForFunction(
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
        return moved && atExpectedHeight ? structuredClone(current) : false;
      },
      expectation,
      { timeout: 15_000 },
    );
    try {
      return (await matchingSnapshot.jsonValue()) as HarnessSnapshot;
    } finally {
      await matchingSnapshot.dispose();
    }
  } catch (error) {
    throw new Error(`Player movement did not satisfy the expected condition: ${JSON.stringify(await snapshot(page))}`, {
      cause: error,
    });
  }
}

export async function lockPointer(page: Page, actionTimeoutMs?: number): Promise<Locator> {
  await page.bringToFront();
  const canvas = page.locator('#game');
  const limits = actionTimeoutMs === undefined ? {} : { timeout: actionTimeoutMs };
  const box = await canvas.boundingBox(limits);
  if (!box) throw new Error('Game canvas has no visible bounding box.');
  await canvas.click({ ...limits, position: { x: box.width / 2, y: box.height / 2 } });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game', undefined, { timeout: 5_000 });
  return canvas;
}

export async function clickCanvasCenter(page: Page, button: 'left' | 'right'): Promise<void> {
  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas has no visible bounding box.');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button,
  });
}

export async function removeHarnessVoxel(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate(
    ([targetX, targetY, targetZ]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands harness edit entry is unavailable.');
      return harness.removeVoxelAt(targetX, targetY, targetZ);
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
      return harness.fillWorld({
        from: fillFrom,
        to: fillTo,
        voxel: fillVoxel,
      });
    },
    { from, to, voxel },
  );
}

export async function moveHarnessPlayer(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate(
    ([targetX, targetY, targetZ]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands harness movement entry is unavailable.');
      return harness.movePlayerTo(targetX, targetY, targetZ);
    },
    [x, y, z],
  );
}

export async function prepareFlatMovement(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as HarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Seedlands flat-movement fixture is unavailable.');
    return harness.prepareFlatMovement();
  });
  await waitForSnapshot(
    page,
    (current) =>
      current.onGround &&
      !current.colliding &&
      Math.abs(current.player[0] - 0.5) < 0.001 &&
      Math.abs(current.player[1] - 58.6) < 0.001 &&
      Math.abs(current.serverPlayerPosition[1] - 58.6) < 0.001 &&
      Math.abs(current.player[2] - 0.5) < 0.001,
  );
}

export async function prepareCenterExcavation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as HarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Seedlands center-excavation fixture is unavailable.');
    return harness.prepareCenterExcavation();
  });
  await waitForSnapshot(
    page,
    (current) =>
      current.onGround &&
      !current.colliding &&
      Math.abs(current.player[0] - 0) < 0.001 &&
      Math.abs(current.player[1] - 58.6) < 0.001 &&
      Math.abs(current.serverPlayerPosition[1] - 58.6) < 0.001 &&
      Math.abs(current.player[2] - 0) < 0.001,
  );
}

export async function prepareStepDown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as HarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Seedlands step-down fixture is unavailable.');
    return harness.prepareStepDown();
  });
  await waitForSnapshot(
    page,
    (current) =>
      current.onGround &&
      !current.colliding &&
      Math.abs(current.player[0] - 0.5) < 0.001 &&
      Math.abs(current.player[1] - 58.6) < 0.001 &&
      Math.abs(current.serverPlayerPosition[1] - 58.6) < 0.001 &&
      Math.abs(current.player[2] - 0.5) < 0.001,
  );
}

export async function setHarnessWorldTime(page: Page, hour: number, paused = true): Promise<void> {
  await page.evaluate(
    async ([targetHour, shouldPause]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('Seedlands environment controls are unavailable.');
      await harness.setWorldTime(targetHour);
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
