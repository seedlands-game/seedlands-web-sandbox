import type { Page } from '@playwright/test';
import { vi } from 'vitest';
import { bodyConfigFor, stepBody, type BodyState, type PhysicsWorld } from '@seedlands/stdlib/physics';
import type { ClassicSnapshot } from './harness';

export const EQUIPMENT_ROUTE_TARGET = [78.5, -0.5] as const;
export const EQUIPMENT_ROUTE_LONG_START = [98.5, 32.6, -0.5] as const;
export const EQUIPMENT_ROUTE_NEAR_START = [79.2, 32.6, -0.5] as const;
export const ROUTE_SNAPSHOT_DELAY_MS = 250;
const FRAME_MS = 1000 / 60;
const FLOOR: PhysicsWorld = {
  querySolids: () => [
    {
      id: 'modeled-clear-corridor-floor',
      aabb: {
        min: { x: -10, y: 31.6, z: -10 },
        max: { x: 120, y: 32.6, z: 10 },
      },
    },
  ],
};

export type EquipmentRoutePhysicsModel = ReturnType<typeof makeEquipmentRoutePhysicsModel>;

export function makeEquipmentRoutePhysicsModel(
  start: readonly [number, number, number],
  options: Readonly<{ keyboardReplyDelayMs?: number }> = {},
) {
  const keyboardReplyDelayMs = options.keyboardReplyDelayMs ?? 0;
  let state: BodyState = {
    position: { x: start[0], y: start[1], z: start[2] },
    velocity: { x: 0, y: 0, z: 0 },
  };
  let yaw = 270;
  let key: string | null = null;
  let physicsTick = 0;
  let acknowledgedInputSequence = 100;
  const keyDowns: string[] = [];
  const keyUps: string[] = [];
  const pulseDurations: number[] = [];
  const pulseEndPositions: Array<readonly [number, number, number]> = [];
  const pressedAt = new Map<string, number>();
  const interval = setInterval(() => {
    const radians = (yaw * Math.PI) / 180;
    const forward = { x: -Math.sin(radians), z: -Math.cos(radians) };
    const sign = key === 'KeyW' ? 1 : key === 'KeyS' ? -1 : 0;
    const result = stepBody({
      state,
      config: bodyConfigFor('player'),
      input: { wish: { x: forward.x * sign, z: forward.z * sign }, jumpPressed: false, verticalIntent: 0 },
      world: FLOOR,
      dt: FRAME_MS / 1000,
    });
    state = result.state;
    physicsTick += 1;
  }, FRAME_MS);

  const snapshot = () => {
    const player = [state.position.x, state.position.y, state.position.z] as const;
    const serverPlayerVelocity = [state.velocity.x, state.velocity.y, state.velocity.z] as const;
    return {
      frameMs: FRAME_MS,
      player,
      serverPlayerPosition: player,
      serverPlayerVelocity,
      viewAngles: [yaw, -29.39] as const,
      streamCenter: [0, 0] as const,
      loadedChunks: 1,
      renderedChunks: 1,
      onGround: Math.abs(state.position.y - 32.6) < 1e-6,
      colliding: false,
      interactionAttempts: 0,
      mutationCount: 0,
      worldRevision: 0,
      remeshSchedulingCount: 0,
      lastCommitMeshChunkCount: 0,
      storageBytes: 0,
      runtime: 'authority-worker' as const,
      workers: { authority: 1, logic: 0, persistence: 0, fluid: 0, general: 0 },
      authority: {
        physicsTick,
        acknowledgedInputSequence,
        commitSequence: 0,
        residency: null,
      },
      generatorVersion: 1,
      renderPipeline: { backend: 'webgl2' as const },
      experiments: {
        requested: { renderer: 'webgl2' as const, wasm: true, simd: true },
        renderer: { effectiveRenderer: 'webgl2' as const },
        workers: [],
      },
      compute: { submittedTasks: 0, completedTasks: 0, failedTasks: 0, staleResults: 0, submittedBytes: 0 },
      performance: {
        scenarioId: 'modeled-equipment-route',
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
    } satisfies ClassicSnapshot;
  };

  const beginKey = (nextKey: string) => {
    if (nextKey !== 'KeyW' && nextKey !== 'KeyS') return false;
    key = nextKey;
    keyDowns.push(nextKey);
    pressedAt.set(nextKey, Date.now());
    acknowledgedInputSequence += 1;
    return true;
  };
  const endKey = (nextKey: string) => {
    if (nextKey !== 'KeyW' && nextKey !== 'KeyS') return false;
    key = null;
    keyUps.push(nextKey);
    const downAt = pressedAt.get(nextKey);
    if (downAt !== undefined) {
      pulseDurations.push(Date.now() - downAt);
      pulseEndPositions.push([state.position.x, state.position.y, state.position.z]);
    }
    acknowledgedInputSequence += 1;
    return true;
  };
  const delayReply = async () => {
    if (keyboardReplyDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, keyboardReplyDelayMs));
  };

  let pointerLocked = false;
  let mouseX = 50_000;
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
        yaw -= (x - mouseX) * 0.13;
        mouseX = x;
      },
    },
    keyboard: {
      down: async (nextKey: string) => {
        if (beginKey(nextKey)) await delayReply();
      },
      up: async (nextKey: string) => {
        if (endKey(nextKey)) await delayReply();
      },
      press: async (nextKey: string, pressOptions?: Readonly<{ delay?: number }>) => {
        if (!beginKey(nextKey)) return;
        const pulseMs = pressOptions?.delay ?? 0;
        if (pulseMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, pulseMs));
        endKey(nextKey);
        await delayReply();
      },
    },
    evaluate: async (callback: (...args: unknown[]) => unknown) => {
      const source = String(callback);
      if (source.includes('pointerLockElement')) return pointerLocked;
      if (!source.includes('snapshot()')) throw new Error('Unexpected evaluate callback in route physics fake.');
      // Every read uses the same fixed virtual observation delay; this is an explicit protocol model.
      await new Promise<void>((resolve) => setTimeout(resolve, ROUTE_SNAPSHOT_DELAY_MS));
      return structuredClone(snapshot());
    },
  } as unknown as Page;

  return {
    page,
    keyDowns,
    keyUps,
    pulseDurations,
    pulseEndPositions,
    snapshot,
    dispose: () => clearInterval(interval),
  };
}

export async function pumpUntilSettled<T>(promise: Promise<T>, maximumVirtualMs: number): Promise<T> {
  const completion: { result: { value: T } | { error: unknown } | null } = { result: null };
  void promise.then(
    (value) => (completion.result = { value }),
    (error: unknown) => (completion.result = { error }),
  );
  for (let elapsed = 0; elapsed <= maximumVirtualMs && completion.result === null; elapsed += 16)
    await vi.advanceTimersByTimeAsync(16);
  if (!completion.result) throw new Error(`Route did not settle within ${maximumVirtualMs} virtual milliseconds.`);
  if ('error' in completion.result) throw completion.result.error;
  return completion.result.value;
}
