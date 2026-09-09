import { validateRealPro, validateRealBirth } from './resident-real-pro';
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { startBrowserResidentFixture } from './resident-support';
import { faceLifeCharacter, lifeSample, startLifeScene } from './support';

test('真实Flash经标准网关感知玩家并调整持续行为，断线后身体继续执行', async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.SEEDLANDS_NPC_REAL_GATEWAY !== '1', '显式选择真实网关；本轮最多6个Flash和4个Pro标准调用');
  test.setTimeout(780000);
  const runtime = await startBrowserResidentFixture(new URL(baseURL!).origin, true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.kind === 'error') errors.push(JSON.stringify(message));
      } catch {
        /* malformed frames separately fail bridge */
      }
    }),
  );
  try {
    const character = await startLifeScene(page);
    await page.getByRole('button', { name: '思考设置' }).click();
    await page.locator('#companion-url').fill(runtime.host.url);
    await page.locator('#companion-token').fill(runtime.host.pairingToken);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await expect(page.locator('#companion .connection')).toHaveText('思考服务已连接');
    await page
      .locator('#companion-dialogue')
      .fill(
        '你好，我叫舟。请告诉我你的打算，并把白天的计划改成在我附近走动。饿了记得找食物吃，晚上你自己决定去哪里休息。',
      );
    await page.getByRole('button', { name: '说话', exact: true }).click();
    await expect
      .poll(async () => (await lifeSample(page, character.entityId, 0)).observation.character.behaviorTree.revision, {
        timeout: 150000,
        intervals: [1000],
      })
      .toBeGreaterThan(1);
    await expect
      .poll(async () => (await lifeSample(page, character.entityId, 0)).observation.character.lastSpeech ?? '', {
        timeout: 30000,
      })
      .not.toBe('');
    const first = await lifeSample(page, character.entityId, 0);
    writeFileSync(
      testInfo.outputPath('real-world-outcomes.json'),
      JSON.stringify({ first, calls: runtime.calls.length }),
    );
    // A provider reply may arrive after the player has left local perception.
    // Reintroduce the player through the fixture, then require the installed tree to reacquire it.
    const actorPosition = first.observation.self.position;
    await page.evaluate(
      async (position) => {
        const result = await window.__seedlandsHarness!.world.command({ type: 'teleport', position });
        if (!result.ok || !result.data.success) throw new Error('Player reappearance failed');
      },
      [actorPosition[0] + 4, actorPosition[1], actorPosition[2]] as const,
    );
    await faceLifeCharacter(page, character.entityId);
    await page.screenshot({ path: testInfo.outputPath('real-flash-response.png') });
    await page.getByRole('button', { name: '断开', exact: true }).click();
    await expect
      .poll(async () => (await lifeSample(page, character.entityId, 0)).physicsTick, { timeout: 15000 })
      .toBeGreaterThan(first.physicsTick + 120);
    const after = await lifeSample(page, character.entityId, first.observation.cursor);
    writeFileSync(
      testInfo.outputPath('real-world-outcomes.json'),
      JSON.stringify({ first, after, calls: runtime.calls.length }),
    );
    expect(after.observation.character.lifecycle).toBe('active');
    expect(after.observation.character.behaviorTree.definition).toEqual(
      first.observation.character.behaviorTree.definition,
    );
    expect(after.observation.character.behaviorTree.runtime.skills.some((entry) => entry.status === 'running')).toBe(
      true,
    );
    writeFileSync(
      testInfo.outputPath('real-world-outcomes.json'),
      JSON.stringify({ first, after, calls: runtime.calls.length }),
    );
    expect(errors).toEqual([]);
    await runtime.host.close();
    await validateRealPro(page, runtime, character.entityId, testInfo);
  } finally {
    writeFileSync(testInfo.outputPath('real-flash-requests.json'), JSON.stringify(runtime.calls));
    writeFileSync(testInfo.outputPath('real-browser-errors.json'), JSON.stringify(errors));
    writeFileSync(testInfo.outputPath('real-pro-requests.json'), JSON.stringify(runtime.proCalls));
    await runtime.close();
  }
});

test('真实Pro单次生成出生包并在浏览器幂等激活', async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.SEEDLANDS_NPC_REAL_GATEWAY !== '1', '显式选择真实网关；仅验证Factory，不重复Flash与压缩');
  test.setTimeout(360000);
  const runtime = await startBrowserResidentFixture(new URL(baseURL!).origin, true);
  try {
    await startLifeScene(page);
    await validateRealBirth(page, runtime, testInfo);
    expect(runtime.calls).toHaveLength(0);
    expect(runtime.proCalls).toHaveLength(1);
  } finally {
    writeFileSync(testInfo.outputPath('real-pro-requests.json'), JSON.stringify(runtime.proCalls));
    await runtime.close();
  }
});
