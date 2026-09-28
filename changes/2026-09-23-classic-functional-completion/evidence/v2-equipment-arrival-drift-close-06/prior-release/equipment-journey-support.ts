import { expect, type Locator, type Page } from '@playwright/test';
import type { HarnessEquipmentSnapshot } from '../../../src/app/app-contracts';
import { aimAtVoxelWithRealMouse } from './aim';
import { expectPresentedDropOrPickup } from './drops';
import {
  clickCanvasCenter,
  closeInventory,
  inventory,
  mineVoxel,
  playerState,
  snapshot,
  voxelAt,
  waitForSnapshot,
  walkTo,
} from './harness';
import { itemCount } from './journey';
import { classicScenario, type V2EquipmentResource } from './scenario';
import {
  equipmentResourcePickup,
  followEquipmentRoute,
  equipmentWorkbenchCorridor,
  equipmentWorkbenchMiningApproach,
  EQUIPMENT_RESOURCE_WALK_OPTIONS,
  isEquipmentMiningReady,
  matchesEquipmentRouteArrival,
} from './equipment-resource-route';

export type EquipmentStepEvidence = Readonly<{ step: string; snapshot: HarnessEquipmentSnapshot }>;
export type V2EquipmentJourneyEvidence = Readonly<{
  phase:
    | 'started'
    | 'resources-placed'
    | 'wood'
    | 'wood-pickaxe'
    | 'stone'
    | 'stone-pickaxe'
    | 'iron'
    | 'crafted'
    | 'equipped'
    | 'ready-to-save';
  steps: readonly EquipmentStepEvidence[];
  snapshot: HarnessEquipmentSnapshot;
}>;
export type RecordEquipmentEvidence = (value: V2EquipmentJourneyEvidence) => void;

export const armorIds = Object.freeze({
  helmet: 'iron-helmet',
  chestplate: 'iron-chestplate',
  leggings: 'iron-leggings',
  boots: 'iron-boots',
});
const creativeNames = Object.freeze({ 'wood-block': '原木', 'stone-block': '石块', 'iron-block': '铁块' });

export const sameActor = (left: HarnessEquipmentSnapshot['actor'], right: HarnessEquipmentSnapshot['actor']) =>
  left.entityId === right.entityId && left.epoch === right.epoch && left.lifetime === right.lifetime;

const equipmentSnapshot = (page: Page): Promise<HarnessEquipmentSnapshot | null> =>
  page.evaluate(
    () => (window as unknown as import('./harness').ClassicWindow).__seedlandsHarness?.equipmentSnapshot() ?? null,
  );

export const requireEquipmentSnapshot = async (page: Page): Promise<HarnessEquipmentSnapshot> => {
  const current = await equipmentSnapshot(page);
  if (!current) throw new Error('Current Authority equipment snapshot is unavailable.');
  return current;
};

export async function waitForEquipmentSnapshot(
  page: Page,
  predicate: (value: HarnessEquipmentSnapshot) => boolean,
): Promise<HarnessEquipmentSnapshot> {
  let matched: HarnessEquipmentSnapshot | null = null;
  await expect
    .poll(async () => {
      const current = await equipmentSnapshot(page);
      if (!current || !predicate(current)) return false;
      matched = current;
      return true;
    })
    .toBe(true);
  return matched!;
}

export const itemTotal = (snapshot: HarnessEquipmentSnapshot, itemId: string) =>
  [...snapshot.slots, ...Object.values(snapshot.armor), snapshot.cursor.stack, ...snapshot.cursor.craftingGrid].reduce(
    (total, stack) => total + (stack?.itemId === itemId ? stack.count : 0),
    0,
  );

export const equipmentStep = (step: string, snapshot: HarnessEquipmentSnapshot): EquipmentStepEvidence => ({
  step,
  snapshot,
});

export function expectFullIronArmor(snapshot: HarnessEquipmentSnapshot): void {
  expect(snapshot.armorPoints).toBe(15);
  for (const [slot, itemId] of Object.entries(armorIds) as Array<[keyof typeof armorIds, string]>)
    expect(snapshot.armor[slot]).toEqual({ itemId, count: 1, instance: { durability: 165 } });
}

export const inventoryState = (snapshot: HarnessEquipmentSnapshot) => ({
  runtimeEpoch: snapshot.runtimeEpoch,
  actor: snapshot.actor,
  inventoryRevision: snapshot.inventoryRevision,
  slots: snapshot.slots,
  armor: snapshot.armor,
  cursor: snapshot.cursor,
});

export async function committedPointer(
  page: Page,
  action: () => Promise<void>,
  predicate: (value: HarnessEquipmentSnapshot) => boolean,
): Promise<HarnessEquipmentSnapshot> {
  const before = await requireEquipmentSnapshot(page);
  await action();
  return waitForEquipmentSnapshot(
    page,
    (value) =>
      value.runtimeEpoch === before.runtimeEpoch &&
      sameActor(value.actor, before.actor) &&
      value.inventoryRevision === before.inventoryRevision + 1 &&
      predicate(value),
  );
}

export const bagItem = (panel: Locator, itemId: string) =>
  panel.locator(`[data-inventory-address^="inventory:"][data-item="${itemId}"]`).first();
const bagAddress = (panel: Locator, slot: number) => panel.locator(`[data-inventory-address="inventory:${slot}"]`);
const stationAddress = (panel: Locator, slot: number) => panel.locator(`[data-inventory-address="station:${slot}"]`);
export const equipmentAddress = (panel: Locator, slot: keyof typeof armorIds) =>
  panel.locator(`[data-equipment-slot="${slot}"]`);

async function moveBagItemToFirstHotbar(page: Page, panel: Locator, itemId: string): Promise<void> {
  const source = bagItem(panel, itemId);
  await expect(source).toBeVisible();
  const sourceSlot = Number(await source.getAttribute('data-slot'));
  if (!Number.isSafeInteger(sourceSlot)) throw new Error(`Inventory slot for ${itemId} has no stable address.`);
  if (sourceSlot === 0) return;
  await committedPointer(
    page,
    async () => {
      await source.hover();
      await page.keyboard.press('Digit1');
    },
    (value) => value.slots[0]?.itemId === itemId,
  );
}

export async function expectEquipmentDom(
  page: Page,
  panel: Locator,
  snapshot: HarnessEquipmentSnapshot,
): Promise<void> {
  for (const [slot, itemId] of Object.entries(armorIds) as Array<[keyof typeof armorIds, string]>) {
    const cell = equipmentAddress(panel, slot);
    await expect(cell).toHaveAttribute('data-item', snapshot.armor[slot]?.itemId ?? 'empty');
    if (snapshot.armor[slot]?.itemId === itemId)
      await expect(cell).toHaveAttribute(
        'aria-label',
        new RegExp(`耐久 ${snapshot.armor[slot]!.instance!.durability}/165`),
      );
  }
  const cursor = snapshot.cursor.stack;
  if (cursor) {
    await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-item', cursor.itemId);
    await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', String(cursor.count));
  } else await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
}

async function selectCreativeItem(page: Page, itemId: keyof typeof creativeNames): Promise<void> {
  await page.keyboard.press('KeyE');
  const survival = page.getByRole('dialog', { name: '背包与合成' });
  if (await survival.isVisible()) await survival.getByRole('button', { name: '切换创造模式', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await expect(catalog).toBeVisible();
  const name = creativeNames[itemId];
  await catalog.locator('#creative-item-filter').fill(name);
  await catalog.getByRole('button', { name: new RegExp(`^将${name}放入创造快捷栏 `) }).click();
  await closeInventory(page);
  await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute('data-item', itemId);
}

async function switchToSurvival(page: Page): Promise<void> {
  await page.keyboard.press('KeyE');
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await expect(catalog).toBeVisible();
  await catalog.getByRole('button', { name: '切换生存模式', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
  await closeInventory(page);
}

async function walkEquipmentRoute(page: Page, target: readonly [number, number]) {
  return followEquipmentRoute(target, {
    now: Date.now,
    observe: () => snapshot(page),
    walk: (key, timeout) => walkTo(page, target, { key, timeout, ...EQUIPMENT_RESOURCE_WALK_OPTIONS }),
    waitForArrival: (baseline, key, timeout) =>
      waitForSnapshot(page, (current) => matchesEquipmentRouteArrival(baseline, current, target, key), timeout),
  });
}

async function walkToEquipmentWorkbench(page: Page) {
  const { workbench } = classicScenario.v2Equipment;
  await walkEquipmentRoute(page, equipmentWorkbenchCorridor(workbench.approach));
  return walkEquipmentRoute(page, workbench.approach);
}

async function placeWorkbench(page: Page): Promise<void> {
  const { workbench } = classicScenario.v2Equipment;
  const panel = await inventory(page);
  await moveBagItemToFirstHotbar(page, panel, 'workbench');
  await expect(panel.locator('[data-slot="0"]')).toHaveAttribute('data-item', 'workbench');
  await closeInventory(page);
  await page.keyboard.press('Digit1');
  await walkToEquipmentWorkbench(page);
  await aimAtVoxelWithRealMouse(page, workbench.support, workbench.target);
  await clickCanvasCenter(page, 'right');
  await expect.poll(() => voxelAt(page, workbench.target)).toBe(11);
}

async function placeResourceStrip(page: Page): Promise<void> {
  await walkEquipmentRoute(page, equipmentWorkbenchCorridor(classicScenario.v2Equipment.workbench.approach));
  for (const resource of classicScenario.v2Equipment.resourceStrip) {
    await walkEquipmentRoute(page, resource.approach);
    await selectCreativeItem(page, resource.itemId);
    await aimAtVoxelWithRealMouse(page, resource.support, resource.target);
    await clickCanvasCenter(page, 'right');
    await expect.poll(() => voxelAt(page, resource.target)).toBe(resource.voxel);
    const beforeSurvival = await snapshot(page);
    if (!beforeSurvival) throw new Error('Classic snapshot is unavailable before returning to survival.');
    await switchToSurvival(page);
    await waitForSnapshot(
      page,
      (value) =>
        value.authority.physicsTick > beforeSurvival.authority.physicsTick && value.onGround && !value.colliding,
    );
  }
}

async function mineResources(page: Page, resources: readonly V2EquipmentResource[]): Promise<void> {
  await walkEquipmentRoute(page, equipmentWorkbenchCorridor(classicScenario.v2Equipment.workbench.approach));
  for (const resource of resources) {
    const before = itemCount(await playerState(page), resource.dropItemId);
    const approach = await walkEquipmentRoute(page, resource.approach);
    if (!isEquipmentMiningReady(approach, resource.target))
      throw new Error(`Equipment resource approach is outside mining range for ${resource.target.join(',')}.`);
    await mineVoxel(page, resource.target);
    await expectPresentedDropOrPickup(page, resource.dropItemId, before);
    await walkEquipmentRoute(page, equipmentResourcePickup(resource));
    await expect.poll(async () => itemCount(await playerState(page), resource.dropItemId)).toBeGreaterThan(before);
    await walkEquipmentRoute(page, resource.approach);
  }
}

async function openWorkbench(page: Page): Promise<Locator> {
  const workbench = classicScenario.v2Equipment.workbench;
  await walkToEquipmentWorkbench(page);
  await aimAtVoxelWithRealMouse(page, workbench.target);
  await clickCanvasCenter(page, 'right');
  const panel = page.getByRole('dialog', { name: '工作台' });
  await expect(panel).toBeVisible();
  return panel;
}

async function placeOneEach(page: Page, panel: Locator, itemId: string, targetSlots: readonly number[]): Promise<void> {
  const source = bagItem(panel, itemId);
  await expect(source).toBeVisible();
  const sourceSlot = Number(await source.getAttribute('data-slot'));
  const sourceCount = Number(await source.getAttribute('data-count'));
  if (!Number.isSafeInteger(sourceSlot) || !Number.isSafeInteger(sourceCount) || sourceCount < targetSlots.length)
    throw new Error(`Insufficient ${itemId} for canonical equipment crafting.`);
  await committedPointer(
    page,
    () => source.click(),
    (value) => value.cursor.stack?.itemId === itemId,
  );
  for (const target of targetSlots)
    await committedPointer(
      page,
      () => stationAddress(panel, target).click({ button: 'right' }),
      (value) => value.cursor.stack === null || value.cursor.stack.itemId === itemId,
    );
  if (sourceCount > targetSlots.length)
    await committedPointer(
      page,
      () => bagAddress(panel, sourceSlot).click(),
      (value) => value.cursor.stack === null,
    );
}

async function placeWholeStack(page: Page, panel: Locator, itemId: string, targetSlot: number): Promise<void> {
  const source = bagItem(panel, itemId);
  await expect(source).toBeVisible();
  await committedPointer(
    page,
    () => source.click(),
    (value) => value.cursor.stack?.itemId === itemId,
  );
  await committedPointer(
    page,
    () => stationAddress(panel, targetSlot).click(),
    (value) => value.cursor.stack === null,
  );
}

async function takeCraftResult(page: Page, panel: Locator, itemId: string): Promise<void> {
  const result = panel.locator('[data-craft-result]');
  await expect(result).toHaveAttribute('data-item', itemId);
  await committedPointer(
    page,
    () => result.click({ modifiers: ['Shift'] }),
    (value) => value.slots.some((stack) => stack?.itemId === itemId),
  );
  await expect(result).toHaveAttribute('data-item', 'empty');
}

async function craftPickaxe(
  page: Page,
  materialId: 'plank' | 'cobblestone',
  outputId: 'wood-pickaxe' | 'stone-pickaxe',
): Promise<void> {
  const panel = await openWorkbench(page);
  await placeOneEach(page, panel, materialId, [0, 1, 2]);
  await placeOneEach(page, panel, 'stick', [4, 7]);
  await takeCraftResult(page, panel, outputId);
  await closeInventory(page);
  const inventoryPanel = await inventory(page);
  await moveBagItemToFirstHotbar(page, inventoryPanel, outputId);
  await expect(inventoryPanel.locator('[data-slot="0"]')).toHaveAttribute('data-item', outputId);
  await closeInventory(page);
  await page.keyboard.press('Digit1');
  expect((await playerState(page)).selectedSlot).toBe(0);
}

async function craftArmor(page: Page): Promise<void> {
  const panel = await openWorkbench(page);
  await placeWholeStack(page, panel, 'iron-block', 0);
  await takeCraftResult(page, panel, 'iron-ingot');
  for (const [itemId, count] of [
    ['iron-helmet', 5],
    ['iron-chestplate', 8],
    ['iron-leggings', 7],
    ['iron-boots', 4],
    ['iron-helmet', 5],
  ] as const) {
    await placeOneEach(
      page,
      panel,
      'iron-ingot',
      Array.from({ length: count }, (_, slot) => slot),
    );
    await takeCraftResult(page, panel, itemId);
  }
  await closeInventory(page);
}

export async function prepareCraftedIronArmor(
  page: Page,
  record: RecordEquipmentEvidence,
  steps: EquipmentStepEvidence[],
): Promise<HarnessEquipmentSnapshot> {
  const started = await requireEquipmentSnapshot(page);
  record({ phase: 'started', steps: [], snapshot: started });
  await placeWorkbench(page);
  await placeResourceStrip(page);
  let current = await requireEquipmentSnapshot(page);
  steps.push(equipmentStep('resources-placed', current));
  record({ phase: 'resources-placed', steps: [...steps], snapshot: current });

  const resources = classicScenario.v2Equipment.resourceStrip;
  await mineResources(
    page,
    resources.filter(({ itemId }) => itemId === 'wood-block'),
  );
  current = await requireEquipmentSnapshot(page);
  steps.push(equipmentStep('wood-collected', current));
  record({ phase: 'wood', steps: [...steps], snapshot: current });
  const panel = await openWorkbench(page);
  await placeWholeStack(page, panel, 'wood-block', 0);
  await takeCraftResult(page, panel, 'plank');
  await placeOneEach(page, panel, 'plank', [0, 1]);
  await takeCraftResult(page, panel, 'stick');
  await closeInventory(page);
  await craftPickaxe(page, 'plank', 'wood-pickaxe');
  current = await requireEquipmentSnapshot(page);
  steps.push(equipmentStep('wood-pickaxe-equipped', current));
  record({ phase: 'wood-pickaxe', steps: [...steps], snapshot: current });

  await mineResources(
    page,
    resources.filter(({ itemId }) => itemId === 'stone-block'),
  );
  current = await requireEquipmentSnapshot(page);
  steps.push(equipmentStep('stone-collected', current));
  record({ phase: 'stone', steps: [...steps], snapshot: current });
  await craftPickaxe(page, 'cobblestone', 'stone-pickaxe');
  current = await requireEquipmentSnapshot(page);
  steps.push(equipmentStep('stone-pickaxe-equipped', current));
  record({ phase: 'stone-pickaxe', steps: [...steps], snapshot: current });

  await mineResources(
    page,
    resources.filter(({ itemId }) => itemId === 'iron-block'),
  );
  current = await requireEquipmentSnapshot(page);
  steps.push(equipmentStep('iron-blocks-collected', current));
  record({ phase: 'iron', steps: [...steps], snapshot: current });
  await craftArmor(page);
  current = await requireEquipmentSnapshot(page);
  for (const itemId of Object.values(armorIds)) expect(itemTotal(current, itemId)).toBeGreaterThanOrEqual(1);
  expect(itemTotal(current, armorIds.helmet)).toBe(2);
  steps.push(equipmentStep('five-iron-armor-crafted', current));
  record({ phase: 'crafted', steps: [...steps], snapshot: current });
  return current;
}

export async function reclaimEquipmentWorkbench(page: Page): Promise<void> {
  const { workbench } = classicScenario.v2Equipment;
  const before = itemCount(await playerState(page), 'workbench');
  await walkToEquipmentWorkbench(page);
  const miningApproach = await walkEquipmentRoute(page, equipmentWorkbenchMiningApproach(workbench));
  if (!isEquipmentMiningReady(miningApproach, workbench.target))
    throw new Error(`Equipment workbench approach is outside mining range for ${workbench.target.join(',')}.`);
  await mineVoxel(page, workbench.target);
  await expectPresentedDropOrPickup(page, 'workbench', before);
  await walkEquipmentRoute(page, equipmentResourcePickup(workbench));
  await expect.poll(async () => itemCount(await playerState(page), 'workbench')).toBeGreaterThan(before);
  await expect.poll(() => voxelAt(page, workbench.target)).toBe(0);
}
