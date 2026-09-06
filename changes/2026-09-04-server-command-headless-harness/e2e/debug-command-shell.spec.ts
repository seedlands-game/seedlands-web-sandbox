import { expect, test } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('operates the authoritative server through the browser debug command shell', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await startHarnessWorld(page, 'browser-command-shell');
  await lockPointer(page);
  await page.keyboard.press('F4');
  await page.waitForFunction(() => document.pointerLockElement === null);

  const shell = page.getByRole('dialog', { name: '服务端调试命令' });
  const input = shell.getByRole('textbox', { name: '命令' });
  const status = shell.getByRole('status');
  await expect(shell).toBeVisible();
  await expect(input).toBeFocused();

  await input.fill('/prehistory-draft');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('/prehistory-draft');
  await input.fill('');

  await input.fill('/setblock 0 0 0 air');
  await input.press('Enter');
  await expect(status).toContainText('成功');
  await waitForSnapshot(page, (current) => current.worldRevision === 1 && current.voxelAtOrigin === 0);

  await input.fill('/inspect voxel 0 0 0');
  await input.press('Enter');
  await expect(status).toContainText('Air (0)');

  await expect(shell).toHaveCSS('pointer-events', 'auto');
  await expect(shell).toHaveCSS('user-select', 'text');
  const commandLog = shell.getByRole('log', { name: '最近命令输出' });
  const inspectResult = shell.locator('.debug-command-entry span').last();
  await inspectResult.dblclick({ position: { x: 12, y: 8 } });
  await expect(commandLog).toBeFocused();
  const selectedText = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim());
  expect(selectedText.length).toBeGreaterThan(0);
  const copiedSelection = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener('copy', () => resolve(window.getSelection()?.toString() ?? ''), { once: true });
      }),
  );
  await page.keyboard.press('ControlOrMeta+C');
  expect((await copiedSelection).trim()).toBe(selectedText);
  await input.click();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(input).toHaveValue(selectedText);
  await input.fill('');

  await input.fill('/unknown');
  await input.press('Enter');
  await expect(status).toContainText('COMMAND_PARSE_FAILED');
  await expect(shell).toBeVisible();

  await input.fill('/draft-not-run');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('/unknown');
  expect(
    await input.evaluate((element) => {
      const commandInput = element as HTMLInputElement;
      return [commandInput.selectionStart, commandInput.selectionEnd];
    }),
  ).toEqual([8, 8]);
  await input.press('ArrowDown');
  await expect(input).toHaveValue('/draft-not-run');
  await input.fill('');

  await input.fill('/tp 40 34 0');
  await input.press('Enter');
  const moved = await waitForSnapshot(
    page,
    (current) => current.streamCenter[0] === 1 && current.player[0] === 40 && current.serverPlayerPosition[0] === 40,
  );
  expect(moved.player).toEqual(moved.serverPlayerPosition);

  await input.fill('');
  const beforeTyping = await snapshot(page);
  await page.keyboard.down('KeyW');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const next = () => {
          frames += 1;
          if (frames === 10) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
  );
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyM');
  const afterTyping = await snapshot(page);
  expect(afterTyping?.player[0]).toBeCloseTo(beforeTyping?.player[0] ?? 0, 3);
  expect(afterTyping?.player[2]).toBeCloseTo(beforeTyping?.player[2] ?? 0, 3);
  await expect(page.locator('#macro-map-panel')).toBeHidden();
  await expect(input).toHaveValue('wm');
  await input.fill('');

  await input.fill('/time set 18');
  await input.press('Enter');
  await expect(status).toContainText('World time set to 18');
  const afterTimeSet = await snapshot(page);
  expect(afterTimeSet?.worldTime).toBeCloseTo(afterTimeSet?.serverWorldTime ?? 0, 5);
  expect(afterTimeSet?.worldTime).toBeGreaterThanOrEqual(18);
  expect(afterTimeSet?.worldTime).toBeLessThan(18.1);

  await input.fill('/save');
  await input.press('Enter');
  await expect(status).toContainText('成功');
  const beforeClose = await snapshot(page);
  expect(beforeClose?.worldRevision).toBe(1);

  await input.fill('/unsent-draft');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('/save');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('/time set 18');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('/save');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('/unsent-draft');

  await input.press('F4');
  await expect(shell).toBeHidden();
  await page.keyboard.press('F4');
  await expect(shell).toBeVisible();
  await expect(input).toBeFocused();
  await input.press('ArrowUp');
  await expect(input).toHaveValue('/save');
  await input.press('Escape');
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
});
