import { expect, test } from '@playwright/test';
import { faceCompanion, prepareCompanionGround } from './support';
import { startAgentServer } from '../../../apps/agent-server/src/node/websocket-host';
import { resolveDeepSeekEndpoint } from '../../../apps/agent-server/src/config';
import { DeepSeekChatCompletionsTransport } from '../../../apps/agent-server/src/deepseek-transport';
import type { CognitionModel, ModelUsage } from '../../../apps/agent-server/src/model-types';
import { startHarnessWorld, prepareFlatMovement, lockPointer } from '../../../tests/e2e/support/harness';

test('真实 Flash 与玩家共处浏览器世界并连续回应自己的动机', async ({ page, baseURL }, testInfo) => {
  test.skip(
    process.env.SEEDLANDS_LIVE_MODEL !== '1',
    'Explicit operator-run real-provider acceptance; CI uses the controller fixture.',
  );
  test.setTimeout(240_000);
  const endpoint = resolveDeepSeekEndpoint(process.env);
  if (!endpoint) throw new Error('Authorized model environment unavailable');
  const transport = new DeepSeekChatCompletionsTransport({ endpoint, requestTimeoutMs: 60_000 });
  const calls: { model: string; latencyMs?: number; usage?: ModelUsage | null; status: string }[] = [];
  const model: CognitionModel = {
    complete: async (request) => {
      if (calls.length >= 6) throw new Error('Real browser acceptance call budget exhausted');
      const record = { model: request.model, status: 'started' } as (typeof calls)[number];
      calls.push(record);
      try {
        const result = await transport.complete(request);
        Object.assign(record, { latencyMs: result.latencyMs, usage: result.usage, status: 'completed' });
        return result;
      } catch (error) {
        record.status = 'failed';
        throw error;
      }
    },
  };
  const host = await startAgentServer({ model, allowedOrigins: [new URL(baseURL!).origin], port: 0 });
  const journey: unknown[] = [];
  try {
    await page.addInitScript(() => localStorage.setItem('seedlands.quality.v1', 'low'));
    await startHarnessWorld(page, 'living-companion-real-browser');
    await prepareFlatMovement(page);
    await prepareCompanionGround(page);
    await page.keyboard.press('F3');
    await expect(page.locator('#debug')).toBeHidden();
    await page.getByRole('button', { name: /结识旅伴/ }).click();
    await page.getByRole('button', { name: '邀请阿岚进入世界' }).click();
    await expect(page.locator('#companion .identity strong')).toHaveText('阿岚');
    const foodFixture = await page.evaluate(async () => {
      const world = window.__seedlandsHarness!.world;
      const list = await world.character({ kind: 'list' });
      if (!list.ok || list.data.kind !== 'list' || !list.data.characters[0]) throw new Error('Character missing');
      const observed = await world.character({ kind: 'observe', entityId: list.data.characters[0].entityId });
      if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Body missing');
      const [x, y, z] = observed.data.observation.self.position;
      const result = await world.command({
        type: 'spawn-world-item',
        itemId: 'berry',
        count: 3,
        position: [x + 2, y, z],
      });
      if (!result.ok || !result.data.success) throw new Error('Fixture food unavailable');
      return { source: 'developer test fixture; ordinary world item, no inventory or hunger patch', result };
    });
    journey.push({ phase: 'fixture', foodFixture });
    await page.getByRole('button', { name: /思考设置/ }).click();
    await page.getByLabel('本机思考服务', { exact: true }).fill(host.url);
    await page.getByLabel('配对码', { exact: true }).fill(host.pairingToken);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    for (const [index, dialogue] of [
      '你好阿岚，你为什么来到这里？你打算在这里过怎样的生活？说说你的想法，然后先在附近找些吃的吧。',
      '我就在旁边，先跟着我走一会儿好吗？你为什么愿意同行？如果我逼你不吃东西硬闯危险地带，你会怎么做？',
    ].entries()) {
      const speech = page.getByTestId('companion-speech');
      const before = (await speech.count()) ? await speech.textContent() : null;
      await page.getByLabel('和阿岚说句话').fill(dialogue);
      await page.getByRole('button', { name: '说话', exact: true }).click();
      await expect
        .poll(async () => ((await speech.count()) ? speech.textContent() : null), {
          timeout: 70_000,
          intervals: [1000],
        })
        .not.toEqual(before);
      const observation = await page.evaluate(async () => {
        const world = window.__seedlandsHarness!.world;
        const list = await world.character({ kind: 'list' });
        if (!list.ok || list.data.kind !== 'list' || !list.data.characters[0]) throw new Error('Character missing');
        return world.character({ kind: 'observe', entityId: list.data.characters[0].entityId, sinceCursor: 0 });
      });
      journey.push({ input: dialogue, observation, ui: await page.locator('#companion').innerText() });
      await faceCompanion(page);
      await page.screenshot({ path: testInfo.outputPath(`real-companion-${index}.png`) });
    }
    expect(calls.filter((call) => call.status === 'completed').length).toBeGreaterThanOrEqual(2);
    const readBodies = () =>
      page.evaluate(async () => {
        const harness = window.__seedlandsHarness!;
        const list = await harness.world.character({ kind: 'list' });
        if (!list.ok || list.data.kind !== 'list' || !list.data.characters[0]) throw new Error('Character missing');
        const result = await harness.world.character({ kind: 'observe', entityId: list.data.characters[0].entityId });
        if (!result.ok || result.data.kind !== 'observation') throw new Error('Body missing');
        return { player: harness.snapshot()!.player, observation: result.data.observation };
      });
    const beforeWalk = await readBodies();
    if (beforeWalk.observation.character.currentGoal.goal.kind === 'follow') {
      await page.locator('#companion .companion-toggle').click();
      await lockPointer(page);
      await page.keyboard.down('KeyW');
      try {
        // A continuous real-input interval, not an authority position patch.
        await page.waitForTimeout(2000);
        journey.push({ phase: 'walking-middle', ...(await readBodies()) });
        await page.screenshot({ path: testInfo.outputPath('real-companion-walking.png') });
        await page.waitForTimeout(1500);
      } finally {
        await page.keyboard.up('KeyW');
        await page.evaluate(() => document.exitPointerLock());
      }
      const afterWalk = await readBodies();
      journey.push({ phase: 'walking', before: beforeWalk, after: afterWalk });
      expect(afterWalk.player).not.toEqual(beforeWalk.player);
      expect(afterWalk.observation.self.position).not.toEqual(beforeWalk.observation.self.position);
      await page.locator('#companion .companion-toggle').click();
      await faceCompanion(page);
      await page.screenshot({ path: testInfo.outputPath('real-companion-followed.png') });
    }
    await page.getByRole('button', { name: '断开', exact: true }).click();
    await expect(page.locator('#companion .connection')).toContainText('未连接模型');
  } finally {
    await host.close();
    await testInfo.attach('real-cognition-journey', {
      body: JSON.stringify({ provider: 'real DeepSeek inherited credentials; text only', calls, journey }, null, 2),
      contentType: 'application/json',
    });
  }
});
