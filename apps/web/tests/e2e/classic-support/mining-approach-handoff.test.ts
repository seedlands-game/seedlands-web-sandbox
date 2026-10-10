import type { Page } from '@playwright/test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lockPointer } from './mouse-input';
import { mineVoxel } from './harness';
import type { ClassicSnapshot } from './harness';
import type { Point } from './scenario';

// These are the two settled Browser64 observations around the original 100ms KeyS pulses.
// They are replayed as observations; this fixture does not simulate Authority physics.
const TARGET: Point = [38, 31, 0];
const START = [39.10158157348633, 33.60000228881836, 0.4862043261528015] as const;
const SAFE_AFTER_FIRST = [36.24327850341797, 32.599998474121094, 0.4921601712703705] as const;
const OUT_OF_RANGE_AFTER_SECOND = [33.54338073730469, 32.599998474121094, 0.5105381011962891] as const;
const SAFE_HANDOFF = new Error('aim reached after the first settled mining approach pulse');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function observed(
  player: readonly [number, number, number],
  physicsTick: number,
  acknowledgedInputSequence: number,
  serverPlayerPosition: readonly [number, number, number] = player,
): ClassicSnapshot {
  return {
    frameMs: 16.67,
    player,
    serverPlayerPosition,
    serverPlayerVelocity: [0, 0, 0],
    viewAngles: [270, -29.39],
    streamCenter: [0, 0],
    loadedChunks: 57,
    renderedChunks: 42,
    onGround: true,
    colliding: false,
    interactionAttempts: 0,
    mutationCount: 0,
    worldRevision: 9,
    remeshSchedulingCount: 0,
    lastCommitMeshChunkCount: 0,
    storageBytes: 0,
    runtime: 'authority-worker',
    workers: { authority: 1, logic: 0, persistence: 0, fluid: 0, general: 0 },
    // Synthetic post-release protocol metadata; not an original Browser64 field.
    nativeMovementInput: {
      epoch: 'browser64-protocol-fixture',
      release: { code: 'KeyS', sequence: acknowledgedInputSequence, neutral: true },
    },
    authority: {
      physicsTick,
      acknowledgedInputSequence,
      commitSequence: 123_250,
      residency: { evictionCount: 0, residentCount: 57, dirtyCount: 0 },
    },
    generatorVersion: 1,
    renderPipeline: { backend: 'webgl2' },
    experiments: {
      requested: { renderer: 'webgl2', wasm: true, simd: true },
      renderer: { effectiveRenderer: 'webgl2' },
      workers: [],
    },
    compute: { submittedTasks: 0, completedTasks: 0, failedTasks: 0, staleResults: 0, submittedBytes: 0 },
    performance: {
      scenarioId: 'browser64-mining-approach-handoff-observation',
      frame: { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, longFrameCount: 0 },
      chunkVisible: { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 },
      completedChunkTraces: 0,
      traceEventCount: 0,
      uploadQueueDepth: 0,
      estimatedMeshBytes: 0,
    },
    gameplay: {
      npcCount: 10,
      worldItemCount: 0,
      inventoryOperationCount: 0,
      actionCompletionCount: 0,
      behaviorEvaluationCount: 0,
      presentedEntityCount: 10,
    },
    visualEffects: {
      blockLightReady: false,
      blockLightSourceRevision: null,
      blockLightRebuildCount: 92,
      shadowUpdateCount: 0,
      shadowStableFrameCount: 0,
    },
  };
}

function browser64ObservationPage(
  options: {
    firstServerPosition?: readonly [number, number, number];
    driftAfterFirst?: boolean;
    startPosition?: readonly [number, number, number];
    rejectCanvasClick?: Error;
  } = {},
) {
  const start = observed(options.startPosition ?? START, 18_645, 2_347);
  const afterFirst = observed(SAFE_AFTER_FIRST, 18_996, 2_379, options.firstServerPosition);
  const afterSecond = observed(OUT_OF_RANGE_AFTER_SECOND, 19_718, 2_435);
  let current = start;
  let pressIndex = 0;
  let heldAt = 0;
  let postFirstSnapshotReads = 0;
  let pointerLocked = false;
  let mouseX = 0;
  let yaw = 270;
  const pulses: Array<{ key: string; delay: number | undefined }> = [];
  const mouseMoves: Array<readonly [number, number]> = [];
  const leftMouseDown = vi.fn();
  const page = {
    locator: (selector: string) => ({
      isVisible: async () => {
        if (selector !== '#debug') throw new Error(`Unexpected visibility query: ${selector}`);
        return false;
      },
      boundingBox: async () => {
        if (selector !== '#game') throw new Error(`Unexpected bounds query: ${selector}`);
        return { x: 0, y: 0, width: 1000, height: 800 };
      },
      click: async () => {
        if (options.rejectCanvasClick) throw options.rejectCanvasClick;
        pointerLocked = true;
      },
    }),
    waitForFunction: async () => undefined,
    mouse: {
      move: async (x: number, y: number) => {
        yaw -= (x - mouseX) * 0.13;
        mouseX = x;
        current = { ...current, viewAngles: [yaw, current.viewAngles[1]] };
        mouseMoves.push([x, y]);
      },
      down: leftMouseDown,
      up: vi.fn(),
    },
    keyboard: {
      down: async (key: string) => {
        expect(key).toBe('KeyS');
        heldAt = Date.now();
      },
      up: async (key: string) => {
        expect(key).toBe('KeyS');
        pulses.push({ key, delay: Date.now() - heldAt });
        current = pressIndex++ === 0 ? afterFirst : afterSecond;
      },
    },
    evaluate: async (callback: (argument?: unknown) => unknown, argument?: unknown) => {
      vi.stubGlobal('window', {
        __seedlandsHarness: {
          snapshot: () => {
            if (pressIndex === 1 && options.driftAfterFirst && postFirstSnapshotReads++ >= 1) return afterSecond;
            return current;
          },
        },
      });
      vi.stubGlobal('document', { pointerLockElement: pointerLocked ? { id: 'game' } : null });
      return callback(argument);
    },
  } as unknown as Page;
  return { page, pulses, mouseMoves, leftMouseDown, start, afterFirst, afterSecond };
}

it('hands off mining approach at the first settled snapshot inside the original safe distance band', async () => {
  const driver = browser64ObservationPage();
  await lockPointer(driver.page);
  const aim = vi.fn(async () => {
    throw SAFE_HANDOFF;
  });

  const rejected = expect(mineVoxel(driver.page, TARGET, aim)).rejects.toBe(SAFE_HANDOFF);
  await vi.runAllTimersAsync();
  await rejected;

  expect(driver.pulses).toEqual([{ key: 'KeyS', delay: 100 }]);
  expect(driver.afterFirst.onGround).toBe(true);
  expect(driver.afterFirst.colliding).toBe(false);
  expect(driver.afterFirst.authority.acknowledgedInputSequence).toBeGreaterThan(
    driver.start.authority.acknowledgedInputSequence,
  );
  expect(driver.afterFirst.authority.physicsTick).toBeGreaterThan(driver.start.authority.physicsTick);
  expect(driver.afterSecond.player).toEqual(OUT_OF_RANGE_AFTER_SECOND);
  expect(aim).toHaveBeenCalledOnce();
  expect(driver.leftMouseDown).not.toHaveBeenCalled();
  expect(driver.mouseMoves.length).toBeGreaterThan(0);
});

it('does not hand off when the settled Authority endpoint is just inside the unsafe range boundary', async () => {
  const driver = browser64ObservationPage({ firstServerPosition: [36.28, 32.599998474121094, 0.4921601712703705] });
  await lockPointer(driver.page);
  const aim = vi.fn(async () => undefined);

  const rejected = expect(mineVoxel(driver.page, TARGET, aim)).rejects.toThrow(/remains out of range/i);
  await vi.runAllTimersAsync();
  await rejected;

  expect(driver.pulses).toEqual([
    { key: 'KeyS', delay: 100 },
    { key: 'KeyS', delay: 100 },
  ]);
  expect(aim).not.toHaveBeenCalled();
  expect(driver.leftMouseDown).not.toHaveBeenCalled();
});

it('uses the fresh range guard if a settled handoff snapshot drifts beyond five units', async () => {
  const driver = browser64ObservationPage({ driftAfterFirst: true });
  await lockPointer(driver.page);
  const aim = vi.fn(async () => undefined);

  const rejected = expect(mineVoxel(driver.page, TARGET, aim)).rejects.toThrow(/remains out of range/i);
  await vi.runAllTimersAsync();
  await rejected;

  expect(driver.pulses).toEqual([{ key: 'KeyS', delay: 100 }]);
  expect(aim).not.toHaveBeenCalled();
  expect(driver.leftMouseDown).not.toHaveBeenCalled();
});

it('propagates the real pointer-lock failure before aiming or mining', async () => {
  const pointerLockFailure = new Error('pointer lock was rejected');
  const driver = browser64ObservationPage({ startPosition: SAFE_AFTER_FIRST, rejectCanvasClick: pointerLockFailure });
  const aim = vi.fn(async () => undefined);

  await expect(mineVoxel(driver.page, TARGET, aim)).rejects.toBe(pointerLockFailure);

  expect(driver.pulses).toHaveLength(0);
  expect(aim).not.toHaveBeenCalled();
  expect(driver.leftMouseDown).not.toHaveBeenCalled();
});
