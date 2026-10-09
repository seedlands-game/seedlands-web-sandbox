import type { Page } from '@playwright/test';
import { expect, it } from 'vitest';
import { walkEquipmentRoute } from './equipment-journey-support';
import { lockPointer } from './mouse-input';
import {
  matchesEquipmentRouteArrival,
  shouldYieldEquipmentRoutePulse,
  type EquipmentRouteSnapshot,
} from './equipment-resource-route';
import { reachedRouteTarget } from './route-progress';
import type { Point, RoutePoint } from './scenario';
import type { ClassicSnapshot } from './harness';

const TARGET: RoutePoint = [78.5, -0.5];
const INITIAL = [78.4337, 32.6, -0.4564] as const;
const OVERSHOT = [78.5587, 32.6, -0.5803] as const;
const ARRIVAL = [78.5, 32.6, -0.5] as const;
const SECOND_PULSE_SENTINEL = new Error('old equipment walk repeated KeyW after a settled overshoot');

const routeSnapshot = (
  player: Point,
  physicsTick: number,
  acknowledgedInputSequence: number,
  serverPlayerPosition: Point = player,
): ClassicSnapshot => ({
  frameMs: 0,
  player,
  serverPlayerPosition,
  serverPlayerVelocity: [0, 0, 0],
  viewAngles: [0, -29.39],
  streamCenter: [0, 0],
  loadedChunks: 1,
  renderedChunks: 1,
  onGround: true,
  colliding: false,
  interactionAttempts: 0,
  mutationCount: 0,
  worldRevision: 0,
  remeshSchedulingCount: 0,
  lastCommitMeshChunkCount: 0,
  storageBytes: 0,
  runtime: 'authority-worker',
  workers: { authority: 1, logic: 0, persistence: 0, fluid: 0, general: 0 },
  authority: {
    physicsTick,
    acknowledgedInputSequence,
    commitSequence: 0,
    residency: null,
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
    scenarioId: 'route-pulse-test',
    frame: { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, longFrameCount: 0 },
    chunkVisible: { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 },
    completedChunkTraces: 0,
    traceEventCount: 0,
    uploadQueueDepth: 0,
    estimatedMeshBytes: 0,
  },
  gameplay: {
    npcCount: 0,
    worldItemCount: 0,
    inventoryOperationCount: 0,
    actionCompletionCount: 0,
    behaviorEvaluationCount: 0,
    presentedEntityCount: 0,
  },
  visualEffects: {
    blockLightReady: true,
    blockLightSourceRevision: 0,
    blockLightRebuildCount: 0,
    shadowUpdateCount: 0,
    shadowStableFrameCount: 0,
  },
});

function routePage() {
  const initial = routeSnapshot(INITIAL, 16748, 9980);
  let current = initial;
  let firstPulse: ClassicSnapshot | null = null;
  let yaw = -57.5;
  let mouseX = 50_000;
  let yawAtFirstPulse: number | null = null;
  let yawAtSecondPulse: number | null = null;
  let animationFrameWaits = 0;
  const keyDowns: string[] = [];
  const keyUps: string[] = [];
  const mouseYawChanges: number[] = [];

  let pointerLocked = false;
  const page = {
    locator: (selector: string) => ({
      isVisible: async () => {
        if (selector !== '#debug') throw new Error(`Unexpected visibility lookup: ${selector}`);
        return false;
      },
      boundingBox: async () => {
        if (selector !== '#game') throw new Error(`Unexpected bounds lookup: ${selector}`);
        return { x: 0, y: 0, width: 100_000, height: 10_000 };
      },
      click: async () => {
        pointerLocked = true;
      },
    }),
    waitForFunction: async () => undefined,
    mouse: {
      move: async (x: number) => {
        const before = yaw;
        yaw -= (x - mouseX) * 0.13;
        mouseX = x;
        if (yaw !== before) mouseYawChanges.push(yaw);
      },
    },
    keyboard: {
      down: async (key: string) => {
        keyDowns.push(key);
        if (keyDowns.length === 1) {
          yawAtFirstPulse = yaw;
          current = routeSnapshot(
            OVERSHOT,
            current.authority.physicsTick + 6,
            current.authority.acknowledgedInputSequence + 6,
          );
          firstPulse = current;
          return;
        }
        yawAtSecondPulse = yaw;
        if (key === 'KeyW') throw SECOND_PULSE_SENTINEL;
        current = routeSnapshot(
          ARRIVAL,
          current.authority.physicsTick + 6,
          current.authority.acknowledgedInputSequence + 6,
        );
      },
      up: async (key: string) => {
        keyUps.push(key);
      },
    },
    evaluate: async (callback: (...args: unknown[]) => unknown) => {
      const source = String(callback);
      if (source.includes('pointerLockElement')) return pointerLocked;
      if (source.includes('requestAnimationFrame')) animationFrameWaits += 1;
      if (source.includes('routeSnapshot()'))
        return structuredClone({
          player: current.player,
          serverPlayerPosition: current.serverPlayerPosition,
          serverPlayerVelocity: current.serverPlayerVelocity,
          viewAngles: [yaw, current.viewAngles[1]] as const,
          onGround: current.onGround,
          colliding: current.colliding,
          authority: {
            physicsTick: current.authority.physicsTick,
            acknowledgedInputSequence: current.authority.acknowledgedInputSequence,
          },
        });
      if (!source.includes('snapshot()')) throw new Error('Unexpected evaluate callback in equipment route fake.');
      return structuredClone({ ...current, viewAngles: [yaw, current.viewAngles[1]] as const });
    },
  } as unknown as Page;

  return {
    page,
    initial,
    keyDowns,
    keyUps,
    firstPulse: () => firstPulse,
    yawAtFirstPulse: () => yawAtFirstPulse,
    yawAtSecondPulse: () => yawAtSecondPulse,
    mouseYawChanges,
    animationFrameWaits: () => animationFrameWaits,
  };
}

it('hands a settled equipment-route overshoot to the outer route and returns on the reverse pulse', async () => {
  const driver = routePage();
  await lockPointer(driver.page);

  let result: EquipmentRouteSnapshot | null = null;
  let rejection: unknown;
  try {
    result = await walkEquipmentRoute(driver.page, TARGET);
  } catch (error) {
    rejection = error;
  }

  const firstPulse = driver.firstPulse();
  expect(firstPulse).not.toBeNull();
  expect(firstPulse!.player).toEqual(OVERSHOT);
  expect(firstPulse!.serverPlayerPosition).toEqual(OVERSHOT);
  expect(firstPulse!.authority.physicsTick).toBeGreaterThan(driver.initial.authority.physicsTick);
  expect(firstPulse!.authority.acknowledgedInputSequence).toBeGreaterThan(
    driver.initial.authority.acknowledgedInputSequence,
  );
  expect(reachedRouteTarget(firstPulse!.player, TARGET, 'KeyW', 0.06, 0.08)).toBe(false);
  expect(matchesEquipmentRouteArrival(driver.initial, firstPulse!, TARGET, 'KeyW')).toBe(false);

  expect(driver.keyDowns).toEqual(['KeyW', 'KeyS']);
  expect(rejection).toBeUndefined();
  expect(driver.keyUps).toEqual(['KeyW', 'KeyS']);
  expect(driver.mouseYawChanges.length).toBeGreaterThan(0);
  expect(driver.yawAtSecondPulse()).not.toBe(driver.yawAtFirstPulse());
  expect(result).not.toBeNull();
  expect(result!.player).toEqual(ARRIVAL);
  expect(result!.serverPlayerPosition).toEqual(ARRIVAL);
  expect(matchesEquipmentRouteArrival(firstPulse!, result!, TARGET, 'KeyS')).toBe(true);
  expect(driver.animationFrameWaits()).toBe(0);
});

it('yields only when both settled positions cross the requested direction inside the x neighborhood', () => {
  const settledOvershoot = routeSnapshot(OVERSHOT, 10, 20);
  expect(shouldYieldEquipmentRoutePulse(settledOvershoot, TARGET, 'KeyW')).toBe(true);

  const outsideXNeighborhood = routeSnapshot([79, 32.6, -0.5], 10, 20);
  expect(shouldYieldEquipmentRoutePulse(outsideXNeighborhood, TARGET, 'KeyW')).toBe(false);

  const presentationOnlyCrossed = routeSnapshot(OVERSHOT, 10, 20, [78.49, 32.6, -0.5803]);
  expect(shouldYieldEquipmentRoutePulse(presentationOnlyCrossed, TARGET, 'KeyW')).toBe(false);

  const notCrossed = routeSnapshot([78.49, 32.6, -0.5], 10, 20);
  expect(shouldYieldEquipmentRoutePulse(notCrossed, TARGET, 'KeyW')).toBe(false);
});
