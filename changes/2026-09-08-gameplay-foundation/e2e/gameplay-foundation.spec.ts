import { expect, test, type Page } from '@playwright/test';
import {
  lockPointer,
  startHarnessWorld,
  prepareFlatMovement,
  setHarnessView,
  snapshot,
} from '../../../tests/e2e/support/harness';
import type { ServerCommand } from '../../../packages/game-core/src/server/commands/command-contract';

type CommandResult = { success: boolean; data?: Record<string, unknown> };
const command = (page: Page, input: ServerCommand) =>
  page.evaluate((value) => window.__seedlandsHarness!.executeGameplayCommand(value) as Promise<CommandResult>, input);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __inputEvidence?: unknown[] };
    target.__inputEvidence = [];
    for (const type of [
      'mousedown',
      'mouseup',
      'pointerlockchange',
      'blur',
      'focus',
      'visibilitychange',
      'mousemove',
    ]) {
      window.addEventListener(
        type,
        (event) => {
          if (type === 'mousemove' && event instanceof MouseEvent && !event.movementX && !event.movementY) return;
          target.__inputEvidence?.push({
            type,
            time: Math.round(performance.now()),
            trusted: event.isTrusted,
            buttons: event instanceof MouseEvent ? event.buttons : null,
            movement: event instanceof MouseEvent ? [event.movementX, event.movementY] : null,
            locked: document.pointerLockElement?.id ?? null,
            focus: document.hasFocus(),
            visibility: document.visibilityState,
          });
          if ((target.__inputEvidence?.length ?? 0) > 60) target.__inputEvidence?.shift();
        },
        true,
      );
    }
  });
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const evidence = await page.evaluate(async () => {
    const current = window.__seedlandsHarness?.snapshot();
    const moduleUrl = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname.endsWith('/playcanvas.js'))?.name;
    type NodeView = {
      name: string;
      forward: { x: number; y: number; z: number };
      getPosition(): { x: number; y: number; z: number };
      getEulerAngles(): { x: number; y: number; z: number };
    };
    const runtime = moduleUrl
      ? ((await import(moduleUrl)) as {
          Application: {
            getApplication(id: string): { root: { findComponents(type: string): { entity: NodeView }[] } } | undefined;
          };
        })
      : null;
    const cameras = runtime?.Application.getApplication('game')
      ?.root.findComponents('camera')
      .map(({ entity }) => ({
        name: entity.name,
        position: entity.getPosition(),
        angles: entity.getEulerAngles(),
        forward: entity.forward,
      }));
    return {
      cameras,
      localVoxel: window.__seedlandsHarness?.getVoxelAt?.(0, 58, -2),
      input: (window as Window & { __inputEvidence?: unknown[] }).__inputEvidence,
      combat: (window as Window & { __combatEvidence?: string[] }).__combatEvidence,
      target: document.querySelector('#target-card')?.textContent,
      player: current?.player,
      attempts: current?.interactionAttempts,
      tick: current?.authority.physicsTick,
      state: await window.__seedlandsHarness?.executeGameplayCommand({ type: 'query-player-state' }),
    };
  });
  console.log('GAMEPLAY_INPUT_EVIDENCE', JSON.stringify(evidence));
});

async function inventory(page: Page) {
  await page.keyboard.press('KeyE');
  const panel = page.getByRole('dialog', { name: '背包与合成' });
  await expect(panel).toBeVisible();
  return panel;
}

async function closeInventory(page: Page) {
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await lockGameplayPointer(page);
}

async function lockGameplayPointer(page: Page) {
  await lockPointer(page);
  // Linux Headless 将锁定指针置于原点；同步自动化坐标，避免按键时从画布中心产生虚假视角位移。
  await page.mouse.move(0, 0);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

// 慢速 runner 按真实库存终态停止移动；不以固定墙钟推断已走到掉落物。
async function itemCount(page: Page, itemId: string) {
  const inventory = await command(page, { type: 'query-inventory' });
  const slots = (inventory.data?.inventory as { slots: { itemId: string; count: number }[] }).slots;
  return slots.reduce((count, slot) => count + (slot.itemId === itemId ? slot.count : 0), 0);
}

async function walkToDrop(page: Page, itemId: string, baselineCount: number) {
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction(
      async ({ wanted, before }) => {
        const harness = window.__seedlandsHarness!;
        const inventory = (await harness.executeGameplayCommand({ type: 'query-inventory' })) as CommandResult;
        const slots = (inventory.data?.inventory as { slots: { itemId: string; count: number }[] } | undefined)?.slots;
        if (slots && slots.reduce((count, slot) => count + (slot.itemId === wanted ? slot.count : 0), 0) > before)
          return true;
        const nearby = (await harness.executeGameplayCommand({ type: 'query-nearby', radius: 16 })) as CommandResult;
        const entities = nearby.data?.entities as
          { type: string; stack?: { itemId: string }; position: [number, number, number] }[] | undefined;
        const drop = entities?.find((entity) => entity.type === 'world-item' && entity.stack?.itemId === wanted);
        if (drop) {
          const player = harness.snapshot().player;
          harness.setView((Math.atan2(player[0] - drop.position[0], player[2] - drop.position[2]) * 180) / Math.PI, 0);
        }
        return false;
      },
      { wanted: itemId, before: baselineCount },
      { timeout: 15_000, polling: 100 },
    );
  } finally {
    await page.keyboard.up('KeyW');
  }
}

test('木剑通过真实采集合成与输入战斗，拾取后保存重进', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'wood-sword-journey');
  const woodBefore = await itemCount(page, 'wood-block');
  let panel = await inventory(page);
  await expect(panel.getByRole('button', { name: '缺少材料 木剑', exact: true })).toBeDisabled();
  await closeInventory(page);
  // 确定性地摆放资源与平地；采集、制作、装备和攻击仍走真实玩家输入。
  await prepareFlatMovement(page);
  await page.evaluate(async () => {
    await window.__seedlandsHarness!.setVoxelAt(0, 58, -2, 4);
  });
  await setHarnessView(page, 0, 0);
  await expect(page.locator('#target-card[data-voxel="4"]')).toBeVisible();
  await page.mouse.down();
  await expect
    .poll(async () => command(page, { type: 'inspect-voxel', position: [0, 58, -2] }))
    .toMatchObject({
      success: true,
      data: { voxel: 0 },
    });
  await page.mouse.up();
  await walkToDrop(page, 'wood-block', woodBefore);
  panel = await inventory(page);
  await expect(panel.getByRole('gridcell', { name: '原木 × 1', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木剑', exact: true }).click();
  await panel.getByRole('gridcell', { name: '木剑 × 1', exact: true }).click();
  const activeHotbarSlot = panel.getByRole('gridcell', { selected: true });
  await activeHotbarSlot.click();
  await expect(activeHotbarSlot).toHaveAttribute('data-item', 'wood-sword');
  await closeInventory(page);
  await expect(page.getByRole('img', { name: '手持 木剑', exact: true })).toBeAttached();
  await expect(page.locator('#combat-status')).toContainText('就绪');
  if (!process.env.CI) await page.screenshot({ path: info.outputPath('wood-sword-equipped.png') });
  const stoneBefore = await itemCount(page, 'stone-block');
  const playerBeforeCombat = (await snapshot(page))!.player;
  const created = await command(page, {
    type: 'spawn-actor',
    archetype: 'night-stalker',
    position: [playerBeforeCombat[0], 57, playerBeforeCombat[2] - 1.8],
  });
  expect(created.success).toBe(true);
  const enemyId = (created.data?.entity as { id: string }).id;
  const enemy = page.locator(`[data-entity-id="${enemyId}"]`);
  for (let attempt = 0; attempt < 8; attempt++) {
    const queried = await command(page, { type: 'query-entity', entityId: enemyId });
    const entity = queried.data?.entity as { position: [number, number, number]; health: number } | null;
    if (!entity) break;
    const state = (await snapshot(page))!;
    const dx = entity.position[0] - state.player[0];
    const dy = entity.position[1] + 0.9 - state.player[1];
    const dz = entity.position[2] - state.player[2];
    await setHarnessView(
      page,
      (Math.atan2(-dx, -dz) * 180) / Math.PI,
      (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
    );
    await page.mouse.click(0, 0);
    if (attempt === 0) {
      if (!process.env.CI) await page.screenshot({ path: info.outputPath('wood-sword-windup.png') });
      await page.waitForTimeout(220);
      await page.mouse.click(0, 0); // 在权威窗口提交一次第二段输入。
      if (!process.env.CI) await page.screenshot({ path: info.outputPath('wood-sword-followup.png') });
    }
    await page.waitForTimeout(650); // 真实动作恢复；终态用权威实体和库存读回断言。
  }
  await expect
    .poll(async () => command(page, { type: 'query-entity', entityId: enemyId }))
    .toMatchObject({
      success: true,
      data: { entity: null },
    });
  await expect(page.getByRole('button', { name: '复活', exact: true })).toBeHidden();
  await walkToDrop(page, 'stone-block', stoneBefore);
  panel = await inventory(page);
  await expect(panel.getByRole('gridcell', { name: '石块 × 1', exact: true })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '木剑 × 1', exact: true })).toBeVisible();
  await page.evaluate(() => window.__seedlandsHarness!.flushSave());
  if (!process.env.CI) await page.screenshot({ path: info.outputPath('wood-sword-loot.png') });
  await startHarnessWorld(page, 'wood-sword-journey');
  panel = await inventory(page);
  await expect(panel.getByRole('gridcell', { name: '木剑 × 1', exact: true })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '石块 × 1', exact: true })).toBeVisible();
  await expect(enemy).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('真实连续攻击输入进入第二段连招，HUD仅按权威结果显示命中', async ({ page }, info) => {
  await startHarnessWorld(page, 'wood-sword-combo');
  await prepareFlatMovement(page);
  await command(page, { type: 'give-item', itemId: 'wood-sword', count: 1 });
  await lockGameplayPointer(page);
  await setHarnessView(page, 0, -8);
  // 主动靠近玩家的目标避免在慢速 CI 的工具往返期间自行游荡出准星。
  const created = await command(page, { type: 'spawn-actor', archetype: 'night-stalker', position: [0.5, 57, -2] });
  expect(created.success).toBe(true);
  const entityId = (created.data?.entity as { id: string }).id;
  await expect(page.locator(`[data-entity-id="${entityId}"]`)).toBeAttached();
  // DOM 观察在输入之前安装，保留短暂阶段；断言不依赖 Node 轮询恰好命中数百毫秒窗口。
  await page.evaluate(() => {
    const target = window as Window & { __combatEvidence?: string[]; __combatObserver?: MutationObserver };
    target.__combatEvidence = [];
    const observer = new MutationObserver(() => {
      const text = `${document.querySelector('#combat-status')?.textContent} ${document.querySelector('[aria-label="交互反馈"]')?.textContent}`;
      if (target.__combatEvidence?.at(-1) !== text) {
        target.__combatEvidence?.push(text);
        if ((target.__combatEvidence?.length ?? 0) > 128) target.__combatEvidence?.shift();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    target.__combatObserver = observer;
  });
  await page.mouse.down();
  try {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const evidence = (window as Window & { __combatEvidence?: string[] }).__combatEvidence ?? [];
          return {
            secondStep: evidence.some((text) => text.includes('第 2 击')),
            sevenDamage: evidence.some((text) => text.includes('7 点伤害')),
          };
        }),
      )
      .toEqual({ secondStep: true, sevenDamage: true });
    await page.screenshot({ path: info.outputPath('wood-sword-combo-result.png') });
  } finally {
    await page.mouse.up();
    await page.evaluate(() =>
      (window as Window & { __combatObserver?: MutationObserver }).__combatObserver?.disconnect(),
    );
  }
});
