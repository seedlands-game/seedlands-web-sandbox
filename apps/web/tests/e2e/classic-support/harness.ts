import { expect, type Page } from '@playwright/test';
import { reachedRouteTarget } from './route-progress';
import type { ClassicScenario, Point, RoutePoint } from './scenario';
import {
  correctMouseToRoute,
  correctMouseUntilEntityAimed,
  mouseCorrectionToVoxel,
  voxelInteractionDistance,
} from './target-aim';
import { queryEntity } from './combat-entity';
import { prepareFixtureChunks, type HarnessResult, type WorldCommitProjection } from './world-commit';
import { ensurePointerLock, lockPointer, moveMouseBy } from './mouse-input';
import type { VoxelGeometryDefinitionV1 } from '@seedlands/stdlib/mod-api';
import type { FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import type { HarnessMediaSnapshot, RenderedMaterialMeshSummary } from '../../../src/app/app-contracts';
import type { GlobalAudio } from '../../../src/app/audio/global-audio';
export { clickCanvasCenter, lockPointer, moveMouseBy } from './mouse-input';

export type InventoryItem = Readonly<{ itemId: string; count: number; instance?: Readonly<{ durability?: number }> }>;
export type PlayerState = Readonly<{
  hotbarSize: number;
  selectedSlot: number;
  hunger: number;
  health: number;
  inventory: readonly (InventoryItem | null)[];
}>;
export type CharacterEvent = Readonly<{
  cursor: number;
  type: string;
  nodeId?: string;
  actionId?: string;
  episode?: number;
  position?: Point;
}>;
export type CharacterObservation = Readonly<{
  character: Readonly<{ entityId: string; lifecycle: string; eventCursor: number }>;
  self: Readonly<{ position: Point }>;
  events: readonly CharacterEvent[];
  cursor: number;
  gap?: boolean;
}>;
// prettier-ignore
export type ClassicSnapshot = Readonly<{
  player: Point;
  viewAngles: readonly [number, number];
  streamCenter: readonly [number, number];
  loadedChunks: number; renderedChunks: number;
  onGround: boolean; colliding: boolean;
  interactionAttempts: number;
  mutationCount: number; worldRevision: number;
  remeshSchedulingCount: number; lastCommitMeshChunkCount: number;
  storageBytes: number;
  runtime: 'authority-worker';
  workers: Readonly<{ authority: number; logic: number; persistence: number; fluid: number; general: number }>;
  authority: Readonly<{
    physicsTick: number;
    acknowledgedInputSequence: number;
    commitSequence: number;
    residency: Readonly<{ evictionCount: number; residentCount: number; dirtyCount: number }> | null;
  }>;
  generatorVersion: number;
  renderPipeline: Readonly<{ backend: 'webgl2' | 'webgpu' }>;
  experiments: Readonly<{
    requested: Readonly<{ renderer: string; wasm: boolean; simd: boolean }>;
    renderer: Readonly<{ effectiveRenderer: string }> | null;
    workers: readonly Readonly<{
      lane: 'fluid' | 'general';
      status: string;
      effectiveArtifact: string;
      artifactSha256?: string;
    }>[];
  }>;
  compute: Readonly<{
    submittedTasks: number;
    completedTasks: number;
    failedTasks: number;
    staleResults: number;
    submittedBytes: number;
    workerActivity?: readonly Readonly<{
      lane: 'fluid' | 'general';
      completedTasks: number;
      kernel: Readonly<{ calls: number; failures: number; memoryBytes: number; failed: boolean }> | null;
    }>[];
  }>;
  performance: Readonly<{
    scenarioId: string;
    frame: Readonly<{ count: number; p50Ms: number; p95Ms: number; p99Ms: number; longFrameCount: number }>;
    chunkVisible: Readonly<{ count: number; p50Ms: number; p95Ms: number; p99Ms: number }>;
    completedChunkTraces: number;
    traceEventCount: number;
    uploadQueueDepth: number;
    estimatedMeshBytes: number;
  }>;
  gameplay: Readonly<{
    npcCount: number;
    worldItemCount: number;
    inventoryOperationCount: number;
    actionCompletionCount: number;
    behaviorEvaluationCount: number;
    presentedEntityCount: number;
  }>;
  visualEffects: Readonly<{
    blockLightReady: boolean;
    blockLightSourceRevision: number | null;
    blockLightRebuildCount: number;
    shadowUpdateCount: number;
    shadowStableFrameCount: number;
  }>;
}>;

export type ChromeTrace = Readonly<{
  traceEvents: readonly Readonly<{
    name: string;
    cat: string;
    ph: 'X';
    ts: number;
    dur: number;
    pid: string;
    tid: string;
    args?: Readonly<Record<string, string | number> & { traceId?: string; traceName?: string }>;
  }>[];
}>;

export type HarnessApi = {
  snapshot(): ClassicSnapshot;
  presentedEntityPosition(entityId: string): Point | null;
  aimedEntityId(): string | null;
  aimedVoxelTarget(): Readonly<{ position: Point; adjacent: Point | null }> | null;
  setView(yaw: number, pitch: number): void;
  setTimePaused(paused: boolean): void;
  setTimeSpeed(speed: number): void;
  setWorldTime(hour: number): Promise<void>;
  fillWorld(command: { from: Point; to: Point; voxel: number }): Promise<WorldCommitProjection | undefined>;
  setVoxelAt(x: number, y: number, z: number, voxel: number): Promise<WorldCommitProjection | undefined>;
  getVoxelAt?(x: number, y: number, z: number): number | null;
  getChunkRevision?(cx: number, cy: number, cz: number): number | null;
  getRenderedChunkRevision?(cx: number, cy: number, cz: number): number | null;
  getFluidCell?(x: number, y: number, z: number): Readonly<{ level: number; source: boolean }> | null;
  getVoxelGeometry(voxel: number): VoxelGeometryDefinitionV1 | null;
  getRenderedMaterialMesh(cx: number, cy: number, cz: number, material: FaceMaterialId): RenderedMaterialMeshSummary | null; // prettier-ignore
  mediaSnapshot(): HarnessMediaSnapshot;
  flushSave(): Promise<void>;
  beginPerformanceScenario(name: string): string;
  exportPerformanceTrace(): ChromeTrace;
  world: {
    identity(): Promise<HarnessResult<Record<string, unknown>>>;
    prepare(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    inspect(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    command(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    clock(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    logic(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    character(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    trace(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    checkpoint(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
  };
};

export type ClassicWindow = Window & {
  __seedlandsHarness?: HarnessApi;
  __seedlandsAudio?: { snapshot(): ReturnType<GlobalAudio['snapshot']> };
};

export const snapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness?.snapshot() ?? null);

export const voxelAt = (page: Page, target: Point) =>
  page.evaluate(
    (target) => (window as unknown as ClassicWindow).__seedlandsHarness?.getVoxelAt?.(...target) ?? null,
    target,
  );

export async function waitForSnapshot(
  page: Page,
  predicate: (value: ClassicSnapshot) => boolean,
  timeout = 20_000,
): Promise<ClassicSnapshot> {
  let matched: ClassicSnapshot | null = null;
  await expect
    .poll(
      async () => {
        const current = await snapshot(page);
        if (!current || !predicate(current)) return false;
        matched = structuredClone(current);
        return true;
      },
      { timeout, intervals: [16, 32, 64, 100] },
    )
    .toBe(true);
  return matched!;
}

export const performanceTrace = (page: Page): Promise<ChromeTrace> => page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.exportPerformanceTrace()); // prettier-ignore

export async function prepareInitialState(
  page: Page,
  scenario: ClassicScenario,
): Promise<{
  hostileId: string;
  identity: Record<string, unknown>;
}> {
  await prepareFixtureChunks(page, scenario);
  return page.evaluate(async (scenario) => {
    const unwrap = <T>(result: HarnessResult<T>, operation: string): T => {
      if (!result.ok) throw new Error(`${operation}: ${result.error.code}: ${result.error.message}`);
      return result.data;
    };
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness;
    if (!harness) throw new Error('Classic Harness is unavailable.');
    const requireWorldEdit = (result: WorldCommitProjection | undefined, operation: string) => {
      if (!result) throw new Error(`${operation} failed: unavailable.`);
      if (result.reason) throw new Error(`${operation} failed: ${result.reason}.`);
    };
    unwrap(await harness.world.clock({ kind: 'pause' }), 'pause');
    const nearby = unwrap(await harness.world.command({ type: 'query-nearby', radius: 512 }), 'query-nearby');
    const entities = (
      (nearby as { data?: { entities?: Array<{ id: string; type: string }> } }).data?.entities ?? []
    ).filter(({ type }) => type !== 'player');
    for (const entity of entities)
      unwrap(await harness.world.command({ type: 'despawn-entity', entityId: entity.id }), `despawn ${entity.id}`);
    const playerState = unwrap(await harness.world.command({ type: 'query-player-state' }), 'query player state') as {
      data?: { player?: { inventory?: Array<{ itemId: string; count: number } | null> } };
    };
    for (const item of playerState.data?.player?.inventory ?? []) {
      if (item)
        unwrap(
          await harness.world.command({ type: 'remove-item', itemId: item.itemId, count: item.count }),
          `remove initial ${item.itemId}`,
        );
    }
    requireWorldEdit(await harness.fillWorld(scenario.initialState.floor), 'fixture floor');
    requireWorldEdit(await harness.fillWorld(scenario.initialState.air), 'fixture air');
    for (const resource of scenario.initialState.resourceVoxels)
      requireWorldEdit(await harness.setVoxelAt(...resource.position, resource.voxel), `fixture ${resource.itemId}`);
    unwrap(
      await harness.world.command({ type: 'teleport', position: scenario.initialState.player }),
      'initial player position',
    );
    await harness.setWorldTime(scenario.initialState.worldTime);
    for (let remaining = scenario.initialState.hungerAdvanceMs; remaining > 0; remaining -= 60_000)
      unwrap(await harness.world.clock({ kind: 'advance', elapsedMs: Math.min(remaining, 60_000) }), 'hunger setup');
    unwrap(await harness.world.command({ type: 'apply-damage', amount: 6 }), 'initial injured player');
    const hostile = unwrap(
      await harness.world.command({
        type: 'spawn-creature',
        id: scenario.initialState.hostile.id,
        position: scenario.initialState.hostile.position,
      }),
      'hostile setup',
    ) as { data?: { entity?: { id?: string } } };
    const hostileId = hostile.data?.entity?.id;
    if (!hostileId) throw new Error('Classic hostile setup returned no entity.');
    harness.setView(scenario.initialState.view.yaw, scenario.initialState.view.pitch);
    await harness.flushSave();
    unwrap(await harness.world.clock({ kind: 'run' }), 'run');
    const identity = unwrap(await harness.world.identity(), 'identity');
    return { hostileId, identity };
  }, scenario);
}

export async function walkTo(
  page: Page,
  target: RoutePoint,
  options: Readonly<{
    key?: 'KeyW' | 'KeyS';
    jump?: boolean;
    tolerance?: number;
    corridorTolerance?: number;
    timeout?: number;
    pulseMs?: number;
  }> = {},
): Promise<ClassicSnapshot> {
  const key = options.key ?? 'KeyW';
  const tolerance = options.tolerance ?? 0.65;
  const corridorTolerance = options.corridorTolerance ?? 1.5;
  const deadline = Date.now() + (options.timeout ?? 45_000);
  let current = await snapshot(page);
  if (!current) throw new Error('Classic snapshot is unavailable before route movement.');
  while (!reachedRouteTarget(current.player, target, key, tolerance, corridorTolerance)) {
    if (Date.now() >= deadline) throw new Error(`Real input route timed out before ${target.join(',')}.`);
    await correctMouseToRoute({
      target,
      direction: key,
      observe: () => snapshot(page),
      move: (dx, dy) => moveMouseBy(page, dx, dy),
    });
    const segmentStart = current;
    const sequenceBeforeInput = current.authority.acknowledgedInputSequence;
    await page.keyboard.down(key);
    if (options.jump) await page.keyboard.down('Space');
    try {
      // This timer bounds the duration of a real input pulse. Readiness is verified below from Authority state.
      await new Promise<void>((resolve) => setTimeout(resolve, options.pulseMs ?? 300));
    } finally {
      await page.keyboard.up(key);
      if (options.jump) await page.keyboard.up('Space');
    }
    current = await waitForSnapshot(
      page,
      (value) => value.authority.acknowledgedInputSequence > sequenceBeforeInput && value.onGround && !value.colliding,
      20_000,
    );
    if (current.player[1] < segmentStart.player[1] - 2)
      throw new Error(`Real input route left its supported surface before ${target.join(',')}.`);
  }
  return current;
}

export async function adjustPitchToTarget(page: Page, target: Point): Promise<void> {
  const history: Array<string | null> = [];
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const observed = await page.evaluate(
      () => document.querySelector('#target-card')?.getAttribute('data-target') ?? null,
    );
    history.push(observed);
    if (history.length > 12) history.shift();
    if (observed === target.join(',')) return;
    const point = observed?.split(',').map(Number);
    const validPoint = point && point.length === 3 && point.every((value) => Number.isFinite(value));
    if (validPoint) {
      const moveDown = point[1]! > target[1] || (point[1] === target[1] && point[0]! > target[0]);
      await moveMouseBy(page, 0, moveDown ? 6 : -6);
      continue;
    }
    const current = await snapshot(page);
    if (!current) continue;
    const correction = mouseCorrectionToVoxel(current.player, current.viewAngles, target);
    await moveMouseBy(page, correction.dx, correction.dy);
  }
  throw new Error(`Real mouse input could not aim at ${target.join(',')}; last targets=${JSON.stringify(history)}.`);
}

export async function mineVoxel(page: Page, target: Point): Promise<void> {
  let current = await snapshot(page);
  if (!current) throw new Error('Classic snapshot is unavailable before mining.');
  const distance = voxelInteractionDistance(current.player, target);
  if (distance < 2.5 || distance > 4.5) {
    const approach: RoutePoint = [target[0] - 2.8, target[2] + 0.5];
    await walkTo(page, approach, {
      key: current.player[0] <= approach[0] ? 'KeyW' : 'KeyS',
      tolerance: 0.45,
      timeout: 15_000,
      pulseMs: 100,
    });
    current = await snapshot(page);
    if (!current || voxelInteractionDistance(current.player, target) > 5)
      throw new Error(`Mining target ${target.join(',')} remains out of range.`);
  }
  await ensurePointerLock(page);
  await adjustPitchToTarget(page, target);
  const attemptsBefore = (await snapshot(page))?.interactionAttempts ?? 0;
  await page.mouse.down({ button: 'left' });
  try {
    await waitForSnapshot(page, (value) => value.interactionAttempts > attemptsBefore, 8_000);
    try {
      await expect
        .poll(
          () =>
            page.evaluate(
              (target) => (window as unknown as ClassicWindow).__seedlandsHarness?.getVoxelAt?.(...target),
              target,
            ),
          {
            timeout: 8_000,
            intervals: [16, 32, 64],
          },
        )
        .toBe(0);
    } catch (error) {
      const diagnostic = await page.evaluate(async () => {
        const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
        const [player, action] = await Promise.all([
          harness.world.command({ type: 'query-player-state' }),
          harness.world.command({ type: 'query-action' }),
        ]);
        return {
          target: document.querySelector('#target-card')?.getAttribute('data-target') ?? null,
          feedback: document.querySelector('[role="status"][aria-label="交互反馈"]')?.textContent ?? null,
          player,
          action,
        };
      });
      throw new Error(`Real mouse mining failed: ${JSON.stringify(diagnostic)}`, { cause: error });
    }
  } finally {
    await page.mouse.up({ button: 'left' });
  }
}

export const inventory = async (page: Page) => {
  await page.keyboard.press('KeyE');
  const panel = page.getByRole('dialog', { name: '背包与合成' });
  await expect(panel).toBeVisible();
  return panel;
};

export async function closeInventory(page: Page): Promise<void> {
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  await lockPointer(page);
}

export async function playerState(page: Page): Promise<PlayerState> {
  return page.evaluate(async () => {
    const unwrap = <T>(result: HarnessResult<T>, operation: string): T => {
      if (!result.ok) throw new Error(`${operation}: ${result.error.code}: ${result.error.message}`);
      return result.data;
    };
    const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.command({
      type: 'query-player-state',
    });
    const data = unwrap(result, 'player state') as { data?: { player?: PlayerState } };
    if (!data.data?.player) throw new Error('Player state is unavailable.');
    return data.data.player;
  });
}

export async function attackWithRealMouse(page: Page, entityId: string): Promise<void> {
  const initial = await queryEntity(page, entityId);
  if (!initial) throw new Error('Classic hostile disappeared before combat.');
  expect(initial.health).toBe(12);
  await correctMouseUntilEntityAimed({
    entityId,
    observe: () =>
      page.evaluate((entityId) => {
        const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
        const entityPosition = harness.presentedEntityPosition(entityId);
        const current = harness.snapshot();
        return entityPosition
          ? {
              aimedEntityId: harness.aimedEntityId(),
              entityPosition,
              player: current.player,
              viewAngles: current.viewAngles,
            }
          : null;
      }, entityId),
    move: (dx, dy) => moveMouseBy(page, dx, dy),
  });
  await ensurePointerLock(page);
  await page.evaluate(() => {
    const target = window as Window & {
      __classicCombatEvidence?: string[];
      __classicCombatObserver?: MutationObserver;
    };
    target.__classicCombatEvidence = [];
    const observer = new MutationObserver(() => {
      const text = `${document.querySelector('#combat-status')?.textContent} ${document.querySelector('[aria-label="交互反馈"]')?.textContent}`;
      if (target.__classicCombatEvidence?.at(-1) !== text) target.__classicCombatEvidence?.push(text);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    target.__classicCombatObserver = observer;
  });
  await page.mouse.down();
  try {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const evidence = (window as Window & { __classicCombatEvidence?: string[] }).__classicCombatEvidence ?? [];
          return {
            buffered: evidence.some((text) => text.includes('已衔接下一击')),
            secondStep: evidence.some((text) => text.includes('第 2 击')),
            secondDamage: evidence.some((text) => text.includes('7 点伤害')),
          };
        }),
      )
      .toEqual({ buffered: true, secondStep: true, secondDamage: true });
    await expect.poll(() => queryEntity(page, entityId)).toBeNull();
  } finally {
    await page.mouse.up();
    await page.evaluate(() =>
      (window as Window & { __classicCombatObserver?: MutationObserver }).__classicCombatObserver?.disconnect(),
    );
  }
}

export async function characterObservation(
  page: Page,
  entityId: string,
  sinceCursor = 0,
): Promise<CharacterObservation> {
  return page.evaluate(
    async ({ entityId, sinceCursor }) => {
      const unwrap = <T>(result: HarnessResult<T>, operation: string): T => {
        if (!result.ok) throw new Error(`${operation}: ${result.error.code}: ${result.error.message}`);
        return result.data;
      };
      const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.character({
        kind: 'observe',
        entityId,
        sinceCursor,
      });
      const data = unwrap(result, 'character observation') as { kind?: string; observation?: CharacterObservation };
      if (data.kind !== 'observation' || !data.observation) throw new Error('Character observation is unavailable.');
      return data.observation;
    },
    { entityId, sinceCursor },
  );
}

export const kernelCalls = (value: ClassicSnapshot) =>
  (value.compute.workerActivity ?? [])
    .filter(({ lane }) => lane === 'general')
    .reduce((total, worker) => total + (worker.kernel?.calls ?? 0), 0);
