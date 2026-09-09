import { prepareCompanionGround } from './support';
import { expect, test } from '@playwright/test';
import { startAgentServer } from '../../../apps/agent-server/src/node/websocket-host';
import type { CognitionModel } from '../../../apps/agent-server/src/model-types';
import type { CharacterObservation } from '../../../packages/game-core/src/runtime/character-control-protocol';
import { startHarnessWorld, prepareFlatMovement } from '../../../tests/e2e/support/harness';

test('浏览器双向控制经过 Authority 回执，第二轮交谈继续触发，断连保持角色', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const calls: { goal: string; cursor: number }[] = [];
  const model: CognitionModel = {
    complete: async (request) => {
      const last = request.messages.filter((message) => message.role === 'user').at(-1);
      const observation = (JSON.parse(last!.content!) as { observation: CharacterObservation }).observation;
      const player = observation.visibleEntities.find((entry) => entry.type === 'player');
      const goal =
        calls.length && player ? { kind: 'follow' as const, target: player.target } : { kind: 'forage' as const };
      calls.push({ goal: goal.kind, cursor: observation.cursor });
      return {
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: 'fixture-private-reasoning',
          tool_calls: [
            {
              id: `fixture-${calls.length}`,
              type: 'function',
              function: {
                name: 'propose_intent',
                arguments: JSON.stringify({
                  goal,
                  say: `第${calls.length}次：${calls.length === 1 ? '我先去附近找点吃的。' : '好，我跟上你，咱们一起留意周围。'}`,
                }),
              },
            },
          ],
        },
        finishReason: 'tool_calls',
        usage: { inputTokens: 100, cacheHitTokens: 0, outputTokens: 30, totalTokens: 130 },
        latencyMs: 0,
      };
    },
  };
  const host = await startAgentServer({ model, allowedOrigins: [new URL(baseURL!).origin], port: 0 });
  try {
    await page.addInitScript(() => localStorage.setItem('seedlands.quality.v1', 'low'));
    await startHarnessWorld(page, 'companion-controller-connection');
    await prepareFlatMovement(page);
    await prepareCompanionGround(page);
    await page.keyboard.press('F3');
    await expect(page.locator('#debug')).toBeHidden();
    await page.getByRole('button', { name: /结识旅伴/ }).click();
    await page.getByRole('button', { name: '邀请阿岚进入世界' }).click();
    await expect(page.locator('#companion .identity strong')).toHaveText('阿岚');
    await page.getByRole('button', { name: /思考设置/ }).click();
    await page.getByLabel('本机思考服务', { exact: true }).fill(host.url);
    await page.getByLabel('配对码', { exact: true }).fill(host.pairingToken);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await page.getByLabel('和阿岚说句话').fill('先去找些吃的吧。');
    await page.getByRole('button', { name: '说话', exact: true }).click();
    await expect(page.getByTestId('companion-speech')).toContainText('找点吃的', { timeout: 20_000 });
    await page.getByLabel('和阿岚说句话').fill('现在先跟着我走。');
    await page.getByRole('button', { name: '说话', exact: true }).click();
    await expect(page.getByTestId('companion-speech')).toContainText('跟上你', { timeout: 20_000 });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const readCharacter = () =>
      page.evaluate(async () => {
        const list = await window.__seedlandsHarness!.world.character({ kind: 'list' });
        if (!list.ok || list.data.kind !== 'list') throw new Error('Character missing');
        return list.data.characters[0];
      });
    const inputBounds = await page.getByLabel('和阿岚说句话').boundingBox();
    expect(inputBounds!.width).toBeGreaterThan(140);
    await page.getByRole('button', { name: /思考设置/ }).click();
    await page.screenshot({ path: testInfo.outputPath('companion-dialogue-layout.png') });
    await page.getByRole('button', { name: /思考设置/ }).click();
    const controlled = await readCharacter();
    expect(controlled.currentGoal.goal.kind).toBe('follow');
    await page.getByRole('button', { name: '断开', exact: true }).click();
    await expect(page.locator('#companion .connection')).toContainText('未连接模型');
    const disconnected = await readCharacter();
    expect(disconnected.entityId).toBe(controlled.entityId);
    expect(disconnected.currentGoal.goal).toEqual(controlled.currentGoal.goal);
    const beforeReconnect = calls.length;
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await page.getByLabel('和阿岚说句话').fill('重新连接了，继续一起走吧。');
    // The button waits for the initial history baseline before allowing this new dialogue.
    await page.getByRole('button', { name: '说话', exact: true }).click();
    await expect(page.getByTestId('companion-speech')).toContainText(`第${beforeReconnect + 1}次`, { timeout: 20_000 });
    expect(calls).toHaveLength(beforeReconnect + 1);
    expect((await readCharacter()).entityId).toBe(controlled.entityId);
    expect(await page.locator('#companion').innerText()).not.toContain('fixture-private-reasoning');
    await testInfo.attach('controller-round-trips', {
      body: JSON.stringify({
        provider: 'deterministic fixture, not real model evidence',
        calls,
        controlled,
        disconnected,
      }),
      contentType: 'application/json',
    });
  } finally {
    await host.close();
  }
});
