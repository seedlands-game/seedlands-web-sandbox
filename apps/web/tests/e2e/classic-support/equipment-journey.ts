import { expect, type Page } from '@playwright/test';
import type { HarnessEquipmentSnapshot } from '../../../src/app/app-contracts';
import { closeInventory, inventory, voxelAt } from './harness';
import { classicScenario } from './scenario';
import {
  armorIds,
  bagItem,
  committedPointer,
  equipmentAddress,
  equipmentStep,
  expectEquipmentDom,
  expectFullIronArmor,
  inventoryState,
  itemTotal,
  prepareCraftedIronArmor,
  reclaimEquipmentWorkbench,
  requireEquipmentSnapshot,
  sameActor,
  waitForEquipmentSnapshot,
  type EquipmentStepEvidence,
  type RecordEquipmentEvidence,
  type V2EquipmentJourneyEvidence,
} from './equipment-journey-support';

export type { V2EquipmentJourneyEvidence } from './equipment-journey-support';
export type V2EquipmentJourneyState = Readonly<{
  beforeSave: HarnessEquipmentSnapshot;
  evidence: V2EquipmentJourneyEvidence;
}>;

async function exerciseEquipmentUi(page: Page, record: RecordEquipmentEvidence, steps: EquipmentStepEvidence[]) {
  const panel = await inventory(page);
  const pickedHelmet = await committedPointer(
    page,
    () => bagItem(panel, armorIds.helmet).click(),
    (value) => value.cursor.stack?.itemId === armorIds.helmet,
  );
  const helmet = await committedPointer(
    page,
    () => equipmentAddress(panel, 'helmet').click(),
    (value) => value.cursor.stack === null && value.armor.helmet?.itemId === armorIds.helmet,
  );
  expect(pickedHelmet.inventoryRevision).toBeLessThan(helmet.inventoryRevision);
  steps.push(equipmentStep('helmet-click', helmet));
  record({ phase: 'equipped', steps: [...steps], snapshot: helmet });

  let current = helmet;
  for (const slot of ['chestplate', 'leggings', 'boots'] as const) {
    current = await committedPointer(
      page,
      () => bagItem(panel, armorIds[slot]).click({ modifiers: ['Shift'] }),
      (value) => value.armor[slot]?.itemId === armorIds[slot],
    );
    steps.push(equipmentStep(`${slot}-quick-move`, current));
    record({ phase: 'equipped', steps: [...steps], snapshot: current });
  }
  expectFullIronArmor(current);
  await expectEquipmentDom(page, panel, current);

  const holdingExtra = await committedPointer(
    page,
    () => bagItem(panel, armorIds.helmet).click(),
    (value) => value.cursor.stack?.itemId === armorIds.helmet,
  );
  await equipmentAddress(panel, 'chestplate').click();
  const feedback = page.locator('#interaction-feedback');
  await expect(feedback).toHaveAttribute('data-tone', 'error');
  await expect(feedback).toContainText('操作未完成');
  const rejectedWrongSlot = await requireEquipmentSnapshot(page);
  expect(inventoryState(rejectedWrongSlot)).toEqual(inventoryState(holdingExtra));
  await expectEquipmentDom(page, panel, rejectedWrongSlot);
  steps.push(equipmentStep('wrong-slot-zero-change', rejectedWrongSlot));
  record({ phase: 'equipped', steps: [...steps], snapshot: rejectedWrongSlot });

  const helmetTotal = itemTotal(holdingExtra, armorIds.helmet);
  current = await committedPointer(
    page,
    () => equipmentAddress(panel, 'helmet').click(),
    (value) =>
      value.cursor.stack?.itemId === armorIds.helmet &&
      value.cursor.origin?.kind === 'equipment' &&
      value.cursor.origin.slot === 'helmet',
  );
  expect(itemTotal(current, armorIds.helmet)).toBe(helmetTotal);
  steps.push(equipmentStep('occupied-helmet-swap', current));
  record({ phase: 'equipped', steps: [...steps], snapshot: current });

  const empty = panel.locator('[data-inventory-address^="inventory:"][data-item="empty"]').first();
  const storedSwap = await committedPointer(
    page,
    () => empty.click(),
    (value) => value.cursor.stack === null,
  );
  const detachedChestplate = await committedPointer(
    page,
    () => equipmentAddress(panel, 'chestplate').click(),
    (value) => value.armor.chestplate === null && value.cursor.stack?.itemId === armorIds.chestplate,
  );
  const emptyAfterDetach = panel.locator('[data-inventory-address^="inventory:"][data-item="empty"]').first();
  const storedChestplate = await committedPointer(
    page,
    () => emptyAfterDetach.click(),
    (value) => value.cursor.stack === null,
  );
  current = await committedPointer(
    page,
    () => bagItem(panel, armorIds.chestplate).click({ modifiers: ['Shift'] }),
    (value) => value.armor.chestplate?.itemId === armorIds.chestplate,
  );
  for (const [step, snapshot] of [
    ['swapped-helmet-stored', storedSwap],
    ['chestplate-detached', detachedChestplate],
    ['chestplate-stored', storedChestplate],
    ['chestplate-quick-move', current],
  ] as const) {
    steps.push(equipmentStep(step, snapshot));
    record({ phase: 'equipped', steps: [...steps], snapshot });
  }

  current = await committedPointer(
    page,
    () => equipmentAddress(panel, 'boots').click(),
    (value) => value.armor.boots === null && value.cursor.origin?.kind === 'equipment',
  );
  const beforeClose = current;
  await closeInventory(page);
  current = await waitForEquipmentSnapshot(
    page,
    (value) =>
      value.runtimeEpoch === beforeClose.runtimeEpoch &&
      sameActor(value.actor, beforeClose.actor) &&
      value.inventoryRevision === beforeClose.inventoryRevision + 1 &&
      value.cursor.stack === null &&
      value.armor.boots?.itemId === armorIds.boots,
  );
  steps.push(equipmentStep('equipment-origin-close', current));
  expectFullIronArmor(current);
  record({ phase: 'equipped', steps: [...steps], snapshot: current });
  return current;
}

export async function completeEquipmentJourneyBeforeSave(
  page: Page,
  record: RecordEquipmentEvidence,
): Promise<V2EquipmentJourneyState> {
  const steps: EquipmentStepEvidence[] = [];
  await prepareCraftedIronArmor(page, record, steps);
  const equipped = await exerciseEquipmentUi(page, record, steps);
  const panel = await inventory(page);
  await expectEquipmentDom(page, panel, equipped);
  await closeInventory(page);
  await reclaimEquipmentWorkbench(page);

  const beforeSave = await requireEquipmentSnapshot(page);
  expectFullIronArmor(beforeSave);
  expect(beforeSave.cursor.stack).toBeNull();
  steps.push(equipmentStep('workbench-reclaimed', beforeSave));
  const evidence = { phase: 'ready-to-save' as const, steps: [...steps], snapshot: beforeSave };
  record(evidence);
  return { beforeSave, evidence };
}

export async function verifyEquipmentJourneyAfterRestore(
  page: Page,
  before: HarnessEquipmentSnapshot,
  record: (
    value: Readonly<{
      phase: 'restored' | 'detached' | 'continued';
      snapshot: HarnessEquipmentSnapshot;
      restored?: HarnessEquipmentSnapshot;
    }>,
  ) => void,
): Promise<Readonly<{ restored: HarnessEquipmentSnapshot; continued: HarnessEquipmentSnapshot }>> {
  const restored = await waitForEquipmentSnapshot(
    page,
    (value) => value.runtimeEpoch !== before.runtimeEpoch && value.actor.epoch !== before.actor.epoch,
  );
  record({ phase: 'restored', snapshot: restored });
  expect(restored.actor.entityId).toBe(before.actor.entityId);
  expect(restored.actor.lifetime).toBe(before.actor.lifetime);
  expect(restored.inventoryRevision).toBe(before.inventoryRevision);
  expect(restored.slots).toEqual(before.slots);
  expect(restored.armor).toEqual(before.armor);
  expect(restored.cursor).toEqual(before.cursor);
  expect(restored.player).toEqual(before.player);
  expect(restored.armorPoints).toBe(before.armorPoints);
  expectFullIronArmor(restored);
  const panel = await inventory(page);
  await expectEquipmentDom(page, panel, restored);
  const detached = await committedPointer(
    page,
    () => equipmentAddress(panel, 'helmet').click(),
    (value) => value.armor.helmet === null && value.cursor.stack?.itemId === armorIds.helmet,
  );
  record({ phase: 'detached', snapshot: detached, restored });
  const reequipped = await committedPointer(
    page,
    () => equipmentAddress(panel, 'helmet').click(),
    (value) => value.armor.helmet?.itemId === armorIds.helmet && value.cursor.stack === null,
  );
  record({ phase: 'continued', snapshot: reequipped, restored });
  expect(detached.actor).toEqual(restored.actor);
  expect(reequipped.inventoryRevision).toBe(restored.inventoryRevision + 2);
  expect(reequipped.armor).toEqual(restored.armor);
  await expectEquipmentDom(page, panel, reequipped);
  await closeInventory(page);
  return { restored, continued: reequipped };
}

export async function expectEquipmentReadyForSave(
  page: Page,
  journey: V2EquipmentJourneyState,
): Promise<HarnessEquipmentSnapshot> {
  const current = await requireEquipmentSnapshot(page);
  expect(inventoryState(current)).toEqual(inventoryState(journey.beforeSave));
  expect(current.armorPoints).toBe(journey.beforeSave.armorPoints);
  expect(await voxelAt(page, classicScenario.v2Equipment.workbench.target)).toBe(0);
  return current;
}

export async function developerWorldEpoch(page: Page): Promise<unknown> {
  const result = await page.evaluate(async () =>
    (window as unknown as import('./harness').ClassicWindow).__seedlandsHarness!.world.identity(),
  );
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data.epoch;
}
