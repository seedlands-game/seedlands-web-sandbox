import { expect, type Locator, type Page } from '@playwright/test';
import type { ClassicScenario, Point, RoutePoint } from './scenario';

export type InventoryItem = Readonly<{ itemId: string; count: number; instance?: Readonly<{ durability?: number }> }>;
export type PlayerState = Readonly<{
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
export type ClassicSnapshot = Readonly<{
  player: Point;
  streamCenter: readonly [number, number];
  loadedChunks: number;
  renderedChunks: number;
  onGround: boolean;
  colliding: boolean;
  mutationCount: number;
  worldRevision: number;
  remeshSchedulingCount: number;
  lastCommitMeshChunkCount: number;
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

type HarnessResult<T> = Readonly<
  | { ok: true; data: T; frontier: Readonly<Record<string, unknown>> }
  | { ok: false; error: Readonly<{ code: string; message: string }> }
>;

export type HarnessApi = {
  snapshot(): ClassicSnapshot;
  setView(yaw: number, pitch: number): void;
  setTimePaused(paused: boolean): void;
  setTimeSpeed(speed: number): void;
  setWorldTime(hour: number): Promise<void>;
  fillWorld(command: { from: Point; to: Point; voxel: number }): Promise<unknown>;
  setVoxelAt(x: number, y: number, z: number, voxel: number): Promise<void>;
  getVoxelAt?(x: number, y: number, z: number): number | null;
  flushSave(): Promise<void>;
  beginPerformanceScenario(name: string): string;
  exportPerformanceTrace(): ChromeTrace;
  world: {
    identity(): Promise<HarnessResult<Record<string, unknown>>>;
    inspect(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    command(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    clock(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    logic(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    character(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    trace(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
    checkpoint(command: Record<string, unknown>): Promise<HarnessResult<Record<string, unknown>>>;
  };
};

export type ClassicWindow = Window & { __seedlandsHarness?: HarnessApi };

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
  await expect
    .poll(
      async () => {
        const current = await snapshot(page);
        return current ? predicate(current) : false;
      },
      { timeout, intervals: [16, 32, 64, 100] },
    )
    .toBe(true);
  const current = await snapshot(page);
  if (!current) throw new Error('Classic Harness snapshot disappeared after satisfying its condition.');
  return current;
}

export async function startClassicWorld(page: Page, scenario: ClassicScenario): Promise<void> {
  const query = new URLSearchParams({
    harness: '1',
    playbook: 'classic',
    renderer: scenario.runtime.renderer,
    wasm: scenario.runtime.wasm ? 'on' : 'off',
    simd: scenario.runtime.simd ? 'on' : 'off',
  });
  await page.goto(`./?${query.toString()}`, { waitUntil: 'networkidle' });
  const playbook = page.locator('#playbook');
  if (await playbook.count()) {
    await playbook.selectOption('classic');
    await expect(playbook).toHaveValue('classic');
  }
  await page.locator('#quality').selectOption(scenario.quality);
  await page.locator('#seed').fill(scenario.seed);
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  const warning = page.getByRole('button', { name: '仍然进入', exact: true });
  if (await warning.isVisible()) await warning.click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await waitForSnapshot(page, (value) => value.loadedChunks > 0 && value.workers.authority === 1, 30_000);
}

export const performanceTrace = (page: Page): Promise<ChromeTrace> =>
  page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.exportPerformanceTrace());

export async function prepareInitialState(
  page: Page,
  scenario: ClassicScenario,
): Promise<{
  npcId: string;
  hostileId: string;
  identity: Record<string, unknown>;
}> {
  return page.evaluate(async (scenario) => {
    const unwrap = <T>(result: HarnessResult<T>, operation: string): T => {
      if (!result.ok) throw new Error(`${operation}: ${result.error.code}: ${result.error.message}`);
      return result.data;
    };
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness;
    if (!harness) throw new Error('Classic Harness is unavailable.');
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
    await harness.fillWorld(scenario.initialState.floor);
    await harness.fillWorld(scenario.initialState.air);
    for (const resource of scenario.initialState.resourceVoxels)
      await harness.setVoxelAt(...resource.position, resource.voxel);
    unwrap(
      await harness.world.command({ type: 'teleport', position: scenario.initialState.player }),
      'initial player position',
    );
    await harness.setWorldTime(scenario.initialState.worldTime);
    for (let remaining = scenario.initialState.hungerAdvanceMs; remaining > 0; remaining -= 60_000)
      unwrap(await harness.world.clock({ kind: 'advance', elapsedMs: Math.min(remaining, 60_000) }), 'hunger setup');
    const hostile = unwrap(
      await harness.world.command({
        type: 'spawn-creature',
        id: scenario.initialState.hostile.id,
        position: scenario.initialState.hostile.position,
      }),
      'hostile setup',
    ) as { data?: { entity?: { id?: string } } };
    unwrap(
      await harness.world.command({ type: 'spawn-world-item', ...scenario.initialState.npc.food }),
      'NPC food setup',
    );
    const npc = unwrap(
      await harness.world.character({
        kind: 'create',
        creationRequestId: scenario.initialState.npc.creationRequestId,
        profile: { name: scenario.initialState.npc.name, personality: scenario.initialState.npc.personality },
        position: scenario.initialState.npc.position,
        homePosition: scenario.initialState.npc.homePosition,
      }),
      'NPC setup',
    ) as { kind?: string; character?: { entityId?: string } };
    if (npc.kind !== 'created' || !npc.character?.entityId) throw new Error('Classic NPC setup returned no character.');
    const hostileId = hostile.data?.entity?.id;
    if (!hostileId) throw new Error('Classic hostile setup returned no entity.');
    harness.setView(scenario.initialState.view.yaw, scenario.initialState.view.pitch);
    await harness.flushSave();
    unwrap(await harness.world.clock({ kind: 'run' }), 'run');
    const identity = unwrap(await harness.world.identity(), 'identity');
    return { npcId: npc.character.entityId, hostileId, identity };
  }, scenario);
}

export async function lockPointer(page: Page): Promise<Locator> {
  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Classic canvas is not visible.');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game');
  mousePositions.set(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return canvas;
}

const mousePositions = new WeakMap<Page, { x: number; y: number }>();

export async function moveMouseBy(page: Page, dx: number, dy: number): Promise<void> {
  let current = mousePositions.get(page);
  if (!current) throw new Error('Real mouse movement requires a Pointer Lock baseline.');
  const box = await page.locator('#game').boundingBox();
  if (!box) throw new Error('Classic canvas disappeared before a real mouse movement.');
  const candidate = { x: current.x + dx, y: current.y + dy };
  const insideSafeArea =
    candidate.x >= box.x + 64 &&
    candidate.x <= box.x + box.width - 64 &&
    candidate.y >= box.y + 64 &&
    candidate.y <= box.y + box.height - 64;
  if (!insideSafeArea) {
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => document.pointerLockElement === null);
    const resume = page.getByRole('button', { name: '继续游戏', exact: true });
    if (await resume.isVisible()) await resume.click();
    await lockPointer(page);
    current = mousePositions.get(page)!;
  }
  const next = { x: current.x + dx, y: current.y + dy };
  await page.mouse.move(next.x, next.y);
  mousePositions.set(page, next);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

export async function clickCanvasCenter(page: Page, button: 'left' | 'right'): Promise<void> {
  const box = await page.locator('#game').boundingBox();
  if (!box) throw new Error('Classic canvas disappeared before a real mouse action.');
  const position = mousePositions.get(page) ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(position.x, position.y, { button });
  mousePositions.set(page, position);
}

export async function walkTo(
  page: Page,
  target: RoutePoint,
  options: Readonly<{ key?: 'KeyW' | 'KeyS'; jump?: boolean; tolerance?: number; timeout?: number }> = {},
): Promise<ClassicSnapshot> {
  const key = options.key ?? 'KeyW';
  let sequenceBeforeRelease = 0;
  await page.keyboard.down(key);
  if (options.jump) await page.keyboard.down('Space');
  try {
    await expect
      .poll(
        async () => {
          const current = await snapshot(page);
          return current ? Math.hypot(current.player[0] - target[0], current.player[2] - target[1]) : Infinity;
        },
        { timeout: options.timeout ?? 45_000, intervals: [100] },
      )
      .toBeLessThan(options.tolerance ?? 0.65);
    sequenceBeforeRelease = (await snapshot(page))?.authority.acknowledgedInputSequence ?? 0;
  } finally {
    await page.keyboard.up(key);
    if (options.jump) await page.keyboard.up('Space');
  }
  return waitForSnapshot(
    page,
    (value) => value.authority.acknowledgedInputSequence > sequenceBeforeRelease && value.onGround && !value.colliding,
    20_000,
  );
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
    const moveDown = validPoint
      ? point[1]! > target[1] || (point[1] === target[1] && point[0]! > target[0])
      : attempt < 60;
    await moveMouseBy(page, 0, moveDown ? (validPoint ? 6 : 12) : validPoint ? -6 : -12);
  }
  throw new Error(`Real mouse input could not aim at ${target.join(',')}; last targets=${JSON.stringify(history)}.`);
}

export async function mineVoxel(page: Page, target: Point): Promise<void> {
  await adjustPitchToTarget(page, target);
  await page.mouse.down({ button: 'left' });
  try {
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

type EntityProjection = Readonly<{ id: string; health: number }>;

const entity = (page: Page, entityId: string): Promise<EntityProjection | null> =>
  page.evaluate(async (entityId) => {
    const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.command({
      type: 'query-entity',
      entityId,
    });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const payload = result.data as { success?: boolean; data?: { entity?: EntityProjection | null } };
    if (!payload.success) throw new Error('Entity query failed.');
    return payload.data?.entity ?? null;
  }, entityId);

export async function attackWithRealMouse(page: Page, entityId: string): Promise<void> {
  const initial = await entity(page, entityId);
  if (!initial) throw new Error('Classic hostile disappeared before combat.');
  expect(initial.health).toBe(12);
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
    await expect.poll(() => entity(page, entityId)).toBeNull();
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
