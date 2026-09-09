import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { startBrowserResidentFixture } from './resident-support';
import { faceLifeCharacter, lifeSample, startLifeScene } from './support';

test('一个浏览器连接承载三位持续生活伙伴，并恢复配对的世界与PG记忆', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(180000);
  const runtime = await startBrowserResidentFixture(new URL(baseURL!).origin);
  const sockets: string[] = [];
  const errors: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const first = await startLifeScene(page);
    await page.getByRole('button', { name: '思考设置' }).click();
    await page.locator('#companion-url').fill(runtime.host.url);
    await page.locator('#companion-token').fill(runtime.host.pairingToken);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await expect(page.locator('#companion .connection')).toHaveText('思考服务已连接');
    await page.locator('#companion-dialogue').fill('请照看这里，也记得吃饭。');
    await page.getByRole('button', { name: '说话', exact: true }).click();
    await expect
      .poll(async () => (await lifeSample(page, first.entityId, 0)).observation.character.behaviorTree.revision, {
        timeout: 20000,
      })
      .toBeGreaterThan(1);
    await expect(page.getByLabel('认知状态')).toBeVisible();
    await page.getByRole('button', { name: '邀请另一位伙伴' }).click();
    await expect(page.getByLabel('选择伙伴').locator('button')).toHaveCount(3);
    await page.getByRole('button', { name: '邀请另一位伙伴' }).click();
    await expect(page.getByLabel('选择伙伴').locator('button')).toHaveCount(3);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const result = await window.__seedlandsHarness!.world.character({ kind: 'list' });
          return result.ok && result.data.kind === 'list' ? result.data.characters.length : 0;
        }),
      )
      .toBe(3);
    const characters = await page.evaluate(async () => {
      const result = await window.__seedlandsHarness!.world.character({ kind: 'list' });
      if (!result.ok || result.data.kind !== 'list') throw new Error('character list unavailable');
      for (const character of result.data.characters)
        await window.__seedlandsHarness!.world.character({
          kind: 'dialogue',
          entityId: character.entityId,
          text: '各自照看这里，饿了就吃饭。',
        });
      return result.data.characters;
    });
    expect(characters).toHaveLength(3);
    for (const character of characters)
      await expect
        .poll(async () => (await lifeSample(page, character.entityId, 0)).observation.character.behaviorTree.revision, {
          timeout: 20000,
        })
        .toBeGreaterThan(1);
    expect(sockets).toHaveLength(1);
    const identity = await page.evaluate(async () => {
      const result = await window.__seedlandsHarness!.world.identity();
      if (!result.ok) throw new Error('world identity unavailable');
      return result.data;
    });
    const timeline = await page.evaluate(
      (worldId) => localStorage.getItem(`seedlands.cognition.timeline:${worldId}`)!,
      identity.worldId,
    );
    const bindings = await runtime.workspace.listBindings(identity.worldId, timeline);
    expect(bindings).toHaveLength(3);
    for (const binding of bindings) {
      const own = await runtime.workspace.readFile(binding, '/SOUL.md', 'system');
      expect(own.content).toContain(characters.find((entry) => entry.entityId === binding.actorId)!.profile.name);
      const journal = runtime.workspace.restoreMessages(await runtime.workspace.getJournal(binding));
      expect(journal.some((entry) => entry._getType() === 'tool')).toBe(true);
    }
    await faceLifeCharacter(page, first.entityId);
    await page.screenshot({ path: testInfo.outputPath('three-residents.png') });
    await page.getByText('世界与伙伴存档', { exact: true }).click();
    await page.getByRole('button', { name: '准备此刻的存档' }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载世界与伙伴存档' }).click();
    const download = await downloadEvent;
    const path = testInfo.outputPath('application-checkpoint.json');
    await download.saveAs(path);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { cognition: string; sourceTimeline: string };
    expect(saved.sourceTimeline).toBe(timeline);
    expect(JSON.parse(saved.cognition).workspaces).toHaveLength(3);
    await page.locator('#application-checkpoint').setInputFiles(path);
    await expect(page.getByText('世界与伙伴记忆已恢复。世界保持暂停，可以继续游玩。', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const restoredTimeline = await page.evaluate(
      (worldId) => localStorage.getItem(`seedlands.cognition.timeline:${worldId}`)!,
      identity.worldId,
    );
    expect(restoredTimeline).not.toBe(timeline);
    expect(await runtime.workspace.listBindings(identity.worldId, restoredTimeline)).toHaveLength(3);
    await page.getByRole('button', { name: '继续这个世界' }).click();
    await expect.poll(async () => (await lifeSample(page, first.entityId, 0)).paused).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('restored-residents.png') });
    expect(errors).toEqual([]);
  } finally {
    writeFileSync(testInfo.outputPath('resident-model-calls.json'), JSON.stringify(runtime.calls));
    writeFileSync(testInfo.outputPath('resident-browser-errors.json'), JSON.stringify(errors));
    await runtime.close();
  }
});
