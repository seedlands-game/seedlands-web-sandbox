import { expect, test, type Page } from '@playwright/test';
import { startHarnessWorld, lockPointer, moveHarnessPlayer, setHarnessView } from '../../../tests/e2e/support/harness';

const bagSlot = (page: Page, slot: number) => page.locator(`#inventory-crafting [data-slot="${slot}"]`);

async function prepare(page: Page, seed: string, count = 9, query = '') {
  await startHarnessWorld(page, seed, query, 'low');
  await page.evaluate(async (count) => {
    const world = window.__seedlandsHarness!.world;
    const logic = await world.logic({ kind: 'mode', mode: 'scripted' });
    if (!logic.ok) throw new Error('Cannot prepare scripted fixture.');
    const given = await world.command({ type: 'give-item', itemId: 'plank', count });
    if (!given.ok || !given.data.success) throw new Error('Cannot prepare initial materials.');
  }, count);
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: '背包与合成', exact: true })).toBeVisible();
}

test('右键拆半、单放与关闭归还均来自真实鼠标输入', async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page, 'inventory-pointer-split');
  await expect(bagSlot(page, 0)).toHaveAttribute('data-item', 'plank');
  await bagSlot(page, 0).click({ button: 'right' });
  await expect(bagSlot(page, 0).locator('strong')).toHaveText('4');
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '5');
  await bagSlot(page, 8).click({ button: 'right' });
  await expect(bagSlot(page, 8).locator('strong')).toHaveText('1');
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '4');
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(bagSlot(page, 0).locator('strong')).toHaveText('8');
  await expect(bagSlot(page, 8).locator('strong')).toHaveText('1');
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
});

async function drag(page: Page, addresses: string[], button: 'left' | 'right') {
  const centers = await Promise.all(
    addresses.map(async (address) => {
      const box = await page.locator(`[data-inventory-address="${address}"]`).boundingBox();
      if (!box) throw new Error(`Slot is not visible: ${address}`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }),
  );
  await page.mouse.move(centers[0].x, centers[0].y);
  await page.mouse.down({ button });
  for (const center of centers.slice(1)) await page.mouse.move(center.x, center.y, { steps: 5 });
  await page.mouse.up({ button });
}

test('左拖均分、右拖逐个、Shift 快速移动和数字交换', async ({ page }, info) => {
  test.setTimeout(90_000);
  await prepare(page, 'inventory-pointer-distribution', 10);
  await bagSlot(page, 0).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '10');
  await drag(page, ['inventory:8', 'inventory:9', 'inventory:10'], 'left');
  for (const index of [8, 9, 10]) await expect(bagSlot(page, index)).toHaveAttribute('data-count', '3');
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '1');
  await bagSlot(page, 11).click({ button: 'right' });
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
  await bagSlot(page, 8).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '3');
  await drag(page, ['inventory:16', 'inventory:17', 'inventory:18'], 'right');
  for (const index of [16, 17, 18]) await expect(bagSlot(page, index)).toHaveAttribute('data-count', '1');
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
  await bagSlot(page, 9).click({ modifiers: ['Shift'] });
  await expect(bagSlot(page, 9)).toHaveAttribute('data-count', '0');
  await expect(bagSlot(page, 0)).toHaveAttribute('data-count', '3');
  await bagSlot(page, 10).hover();
  await page.keyboard.press('Digit2');
  await expect(bagSlot(page, 10)).toHaveAttribute('data-count', '0');
  await expect(bagSlot(page, 1)).toHaveAttribute('data-count', '3');
  await page.screenshot({ path: info.outputPath('inventory-organized.png') });
});

test('按住源格直接拖放与双击收集不重复执行', async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page, 'inventory-pointer-direct-drag', 9);
  await drag(page, ['inventory:0', 'inventory:8'], 'left');
  await expect(bagSlot(page, 0)).toHaveAttribute('data-count', '0');
  await expect(bagSlot(page, 8)).toHaveAttribute('data-count', '9');
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
  await bagSlot(page, 8).click({ button: 'right' });
  await bagSlot(page, 9).click();
  await expect(bagSlot(page, 9)).toHaveAttribute('data-count', '5');
  await bagSlot(page, 8).dblclick();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '9');
  await expect(bagSlot(page, 8)).toHaveAttribute('data-count', '0');
  await expect(bagSlot(page, 9)).toHaveAttribute('data-count', '0');
});

async function station(page: Page, voxel: number, kind: string) {
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  const x = kind === 'furnace' ? 8 : 0;
  await page.evaluate(
    async ({ x, kind }) => {
      const h = window.__seedlandsHarness!;
      await h.fillWorld({ from: [x - 2, 59, -2], to: [x + 3, 59, 4], voxel: 3 });
      await h.fillWorld({ from: [x - 2, 60, -2], to: [x + 3, 64, 4], voxel: 0 });
      const given = await h.world.command({ type: 'give-item', itemId: kind, count: 1 });
      if (!given.ok || !given.data.success) throw new Error('Station fixture material failed.');
    },
    { x, kind },
  );
  await moveHarnessPlayer(page, x + 0.5, 61.6, 2.5);
  await lockPointer(page);
  await page.mouse.move(0, 0);
  const stationKey = await page.locator(`#hotbar [data-item="${kind}"] .slot-key`).textContent();
  await page.keyboard.press(`Digit${stationKey}`);
  await expect(page.locator(`#hotbar [data-item="${kind}"]`)).toHaveAttribute('aria-pressed', 'true');
  await setHarnessView(page, 0, -40.36);
  await expect(page.locator('#target-card[data-voxel="3"]')).toBeVisible();
  await page.mouse.click(0, 0, { button: 'right' });
  await expect.poll(() => page.evaluate((x) => window.__seedlandsHarness!.getVoxelAt!(x, 60, 0), x)).toBe(voxel);
  await setHarnessView(page, 0, -28.81);
  await expect(page.locator(`#target-card[data-voxel="${voxel}"]`)).toBeVisible();
  await page.mouse.click(0, 0, { button: 'right' });
  await expect(page.locator(`[data-station-kind="${kind}"]`)).toBeVisible();
}

test('工作台右拖铺料、结果取出与保存重进', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page, 'inventory-pointer-workbench', 10);
  await station(page, 11, 'workbench');
  await bagSlot(page, 0).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '10');
  await drag(page, ['station:0', 'station:1', 'station:2', 'station:4', 'station:7'], 'right');
  for (const index of [0, 1, 2, 4, 7])
    await expect(page.locator(`[data-station-slot="${index}"]`)).toHaveAttribute('data-count', '1');
  await expect(page.locator('[data-craft-result]')).toHaveAttribute('data-item', 'wood-pickaxe');
  await bagSlot(page, 0).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('workbench-ready.png') });
  await page.locator('[data-craft-result]').click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-item', 'wood-pickaxe');
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '1');
  for (const index of [0, 1, 2, 4, 7])
    await expect(page.locator(`[data-station-slot="${index}"]`)).toHaveAttribute('data-count', '0');
  await page.screenshot({ path: info.outputPath('workbench-cursor-tool.png') });
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  await page.evaluate(() => window.__seedlandsHarness!.flushSave!());
  await startHarnessWorld(page, 'inventory-pointer-workbench', '', 'low');
  await page.keyboard.press('KeyE');
  await expect(page.locator('[data-slot][data-item="wood-pickaxe"]')).toHaveAttribute('data-count', '1');
  await expect(page.locator('[data-slot][data-item="plank"]')).toHaveAttribute('data-count', '5');
  expect(errors).toEqual([]);
});

test('箱子 Shift 往返和熔炉只读产出槽，截取实际面板', async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepare(page, 'inventory-pointer-containers', 9);
  await station(page, 12, 'chest');
  await bagSlot(page, 0).click({ modifiers: ['Shift'] });
  await expect(bagSlot(page, 0)).toHaveAttribute('data-count', '0');
  await expect(page.locator('[data-station-slot="0"]')).toHaveAttribute('data-count', '9');
  await page.locator('[data-station-slot="0"]').click({ button: 'right' });
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '5');
  await page.locator('[data-station-slot="1"]').click();
  await expect(page.locator('[data-station-slot="1"]')).toHaveAttribute('data-count', '5');
  await page.locator('[data-station-slot="0"]').click({ modifiers: ['Shift'] });
  await expect(bagSlot(page, 0)).toHaveAttribute('data-count', '4');
  await page.locator('[data-station-slot="1"]').click({ button: 'right' });
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '3');
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  await lockPointer(page);
  await page.mouse.move(0, 0);
  await setHarnessView(page, 180, 85);
  await expect(page.locator('#target-card')).toBeHidden();
  await setHarnessView(page, 0, -28.81);
  await expect(page.locator('#target-card[data-voxel="12"]')).toBeVisible();
  await page.mouse.click(0, 0, { button: 'right' });
  await expect(page.locator('[data-station-slot="1"]')).toHaveAttribute('data-count', '5');
  await expect(bagSlot(page, 0)).toHaveAttribute('data-count', '4');
  await page.screenshot({ path: info.outputPath('chest-slots.png') });
  await station(page, 13, 'furnace');
  await bagSlot(page, 0).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '4');
  await page.locator('[data-station-slot="2"]').click();
  await expect(page.locator('[data-station-slot="2"]')).toHaveAttribute('data-count', '0');
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '4');
  await page.screenshot({ path: info.outputPath('furnace-slots.png') });
});

test('持物检查点恢复后仍可操作，失焦取消预览不扣物', async ({ page }, info) => {
  test.setTimeout(90_000);
  await prepare(page, 'inventory-pointer-restore', 9);
  await bagSlot(page, 0).click({ button: 'right' });
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '5');
  expect(
    await page.evaluate(async () => {
      const world = window.__seedlandsHarness!.world;
      const exported = await world.checkpoint({ kind: 'export' });
      if (!exported.ok || !exported.data.snapshot) throw new Error('Checkpoint export failed.');
      return (await world.checkpoint({ kind: 'restore', snapshot: exported.data.snapshot })).ok;
    }),
  ).toBe(true);
  await page.keyboard.press('KeyE');
  await expect(bagSlot(page, 8)).toBeVisible();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '5');
  const first = (await bagSlot(page, 8).boundingBox())!;
  const second = (await bagSlot(page, 9).boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 5 });
  await expect(bagSlot(page, 8)).toHaveClass(/previewing/);
  await expect(bagSlot(page, 9)).toHaveClass(/previewing/);
  await page.screenshot({ path: info.outputPath('inventory-drag-preview.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up({ button: 'right' });
  await expect(bagSlot(page, 8)).toHaveAttribute('data-count', '0');
  await expect(bagSlot(page, 9)).toHaveAttribute('data-count', '0');
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '5');
  await bagSlot(page, 8).click();
  await expect(bagSlot(page, 8)).toHaveAttribute('data-count', '5');
});

test('窗口内留白保留持物、窗口外右键丢一个、Esc 归还，切模式不丢物', async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page, 'inventory-pointer-lifecycle', 9);
  await bagSlot(page, 0).click({ button: 'right' });
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '5');
  await page.locator('.bag-intro h3').click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '5');
  await page.mouse.click(10, 680, { button: 'right' });
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '4');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(bagSlot(page, 0)).toHaveAttribute('data-count', /^[89]$/);
  const returned = await bagSlot(page, 0).getAttribute('data-count');
  await bagSlot(page, 0).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', returned!);
  await page.getByRole('button', { name: '切换创造模式', exact: true }).click();
  await expect(page.locator('#creative-catalog')).toBeVisible();
  await page.getByRole('button', { name: '切换生存模式', exact: true }).click();
  await expect(bagSlot(page, 0)).toHaveAttribute('data-count', /^[89]$/);
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
});

test('工作台 Shift 批量制作并保留随身配方与食用入口', async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page, 'inventory-pointer-workbench', 20);
  await station(page, 11, 'workbench');
  await bagSlot(page, 0).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '20');
  const pattern = [0, 1, 2, 4, 7];
  for (let batch = 1; batch <= 4; batch++) {
    await drag(
      page,
      pattern.map((slot) => `station:${slot}`),
      'right',
    );
    await expect(page.locator('[data-station-slot="0"]')).toHaveAttribute('data-count', String(batch));
  }
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
  await page.locator('[data-craft-result]').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-slot][data-item="wood-pickaxe"]')).toHaveCount(4);
  for (const slot of pattern)
    await expect(page.locator(`[data-station-slot="${slot}"]`)).toHaveAttribute('data-count', '0');
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  await page.evaluate(async () => {
    const given = await window.__seedlandsHarness!.world.command({ type: 'give-item', itemId: 'berry', count: 2 });
    if (!given.ok || !given.data.success) throw new Error('Food fixture failed.');
  });
  await page.keyboard.press('KeyE');
  await expect(page.locator('.personal-recipes')).toBeVisible();
  await page.locator('[data-slot][data-item="berry"]').hover();
  const eat = page.getByRole('button', { name: '食用浆果', exact: true });
  await expect(eat).toBeEnabled();
  await eat.click();
  // Full hunger follows the existing failure feedback; opening this route must remain possible.
  await expect(page.locator('[data-slot][data-item="berry"]')).toHaveAttribute('data-count', '2');
});

test('有传输延迟时切模式期间连续点击不会在创造模式暗中拿起库存', async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page, 'inventory-pointer-split', 9, '&authorityLatencyMs=150');
  const slot = (await bagSlot(page, 0).boundingBox())!;
  await page.getByRole('button', { name: '切换创造模式', exact: true }).click();
  // Exercise repeated real user input throughout the delayed response, not a wait for readiness.
  for (let frame = 0; frame < 40 && !(await page.locator('#creative-catalog').isVisible()); frame++) {
    await page.mouse.click(slot.x + slot.width / 2, slot.y + slot.height / 2);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  await expect(page.locator('#creative-catalog')).toBeVisible();
  await page.getByRole('button', { name: '切换生存模式', exact: true }).click();
  await expect(bagSlot(page, 0)).toHaveAttribute('data-count', '9');
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
});

test('背包满时仍能把工作台结果拿到空游标，Shift 满袋不扣材料', async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepare(page, 'inventory-pointer-workbench', 10);
  await station(page, 11, 'workbench');
  await bagSlot(page, 0).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '10');
  const pattern = [0, 1, 2, 4, 7];
  await drag(
    page,
    pattern.map((slot) => `station:${slot}`),
    'right',
  );
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '5');
  await bagSlot(page, 0).click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
  await page.evaluate(async () => {
    const given = await window.__seedlandsHarness!.world.command({
      type: 'give-item',
      itemId: 'stone-block',
      count: 23 * 64,
    });
    if (!given.ok || !given.data.success)
      throw new Error(given.ok ? given.data.message : 'Full inventory fixture rejected.');
  });
  await expect(page.locator('[data-slot]:not([data-item="empty"])')).toHaveCount(24);
  await expect(page.locator('[data-craft-result]')).toHaveAttribute('data-item', 'wood-pickaxe');
  await page.locator('[data-craft-result]').click({ modifiers: ['Shift'] });
  for (const slot of pattern)
    await expect(page.locator(`[data-station-slot="${slot}"]`)).toHaveAttribute('data-count', '1');
  await page.locator('[data-craft-result]').click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-item', 'wood-pickaxe');
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-count', '1');
  for (const slot of pattern)
    await expect(page.locator(`[data-station-slot="${slot}"]`)).toHaveAttribute('data-count', '0');
  await page.screenshot({ path: info.outputPath('workbench-full-inventory-cursor.png') });
});
