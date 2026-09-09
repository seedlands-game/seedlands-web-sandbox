import { writeFile } from 'node:fs/promises';
import { prepareCompanionGround } from './support';
import { expect, test } from '@playwright/test';
import { startAgentServer } from '../../../apps/agent-server/src/node/websocket-host';
import type { CognitionModel } from '../../../apps/agent-server/src/model-types';
import type { CharacterObservation } from '../../../packages/game-core/src/runtime/character-control-protocol';
import { startHarnessWorld, prepareFlatMovement, lockPointer } from '../../../tests/e2e/support/harness';
import { CognitionRuntime } from '../../../apps/agent-server/src/runtime';
import type { ControllerClientMessage } from '@seedlands/cognition-protocol';

test('浏览器双向控制经过 Authority 回执，第二轮交谈继续触发，断连保持角色', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const persistEvidence = async (name: string, value: unknown) => {
    const path = testInfo.outputPath(`${name}.json`);
    await writeFile(path, JSON.stringify(value, null, 2));
    await testInfo.attach(name, { path, contentType: 'application/json' });
  };
  const calls: { goal: string; cursor: number }[] = [];
  const pages: { cursor: number; head: number; count: number }[] = [];
  const controls: string[] = [];
  let holdNextDecision = false;
  let releaseDecision: (() => void) | undefined;
  let heldDecisionAborted = false;
  class ObservedRuntime extends CognitionRuntime {
    override receive(message: ControllerClientMessage) {
      super.receive(message);
      if (message.kind === 'control') controls.push(message.command);
      if (message.kind === 'observe')
        pages.push({
          cursor: message.observation.cursor,
          head: message.observation.character.eventCursor,
          count: message.observation.events.length,
        });
    }
  }
  const model: CognitionModel = {
    complete: async (request) => {
      const last = request.messages.filter((message) => message.role === 'user').at(-1);
      const observation = (JSON.parse(last!.content!) as { observation: CharacterObservation }).observation;
      const player = observation.visibleEntities.find((entry) => entry.type === 'player');
      const goal =
        calls.length && player ? { kind: 'follow' as const, target: player.target } : { kind: 'forage' as const };
      calls.push({ goal: goal.kind, cursor: observation.cursor });
      if (holdNextDecision) {
        holdNextDecision = false;
        // Deliberately return a late completion even after cancellation.
        await new Promise<void>((resolve) => {
          releaseDecision = resolve;
          request.signal?.addEventListener(
            'abort',
            () => {
              heldDecisionAborted = true;
            },
            { once: true },
          );
        });
      }
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
  const host = await startAgentServer({
    model,
    allowedOrigins: [new URL(baseURL!).origin],
    port: 0,
    createRuntime: (options) => new ObservedRuntime(options),
  });
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
    const historyCursor = await page.evaluate(async () => {
      const world = window.__seedlandsHarness!.world;
      const list = await world.character({ kind: 'list' });
      if (!list.ok || list.data.kind !== 'list' || !list.data.characters[0]) throw new Error('Character missing');
      let cursor = 0;
      for (let index = 0; index < 70; index += 1) {
        const reply = await world.character({
          kind: 'dialogue',
          entityId: list.data.characters[0].entityId,
          text: `这是连接前已经留下的第${index + 1}条历史。`,
        });
        if (!reply.ok || reply.data.kind !== 'dialogue') throw new Error('History fixture failed');
        cursor = reply.data.event.cursor;
      }
      return cursor;
    });
    await page.getByRole('button', { name: /思考设置/ }).click();
    await page.getByLabel('本机思考服务', { exact: true }).fill(host.url);
    await page.getByLabel('配对码', { exact: true }).fill(host.pairingToken);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await expect.poll(() => pages.some((entry) => entry.cursor >= historyCursor)).toBe(true);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(calls).toHaveLength(0);
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
    const readBodies = () =>
      page.evaluate(async () => {
        const harness = window.__seedlandsHarness!;
        const list = await harness.world.character({ kind: 'list' });
        if (!list.ok || list.data.kind !== 'list' || !list.data.characters[0]) throw new Error('Character missing');
        const entityId = list.data.characters[0].entityId;
        const observed = await harness.world.character({ kind: 'observe', entityId });
        const actions = await harness.world.actions({ entityId });
        const snapshot = harness.snapshot();
        if (!observed.ok || observed.data.kind !== 'observation' || !actions.ok || !snapshot)
          throw new Error('Body missing');
        return {
          player: snapshot.player,
          npc: observed.data.observation.self.position,
          actions: actions.data.actions,
          tick: snapshot.authority.physicsTick,
        };
      });
    await expect.poll(async () => (await readBodies()).actions.length, { timeout: 20_000 }).toBe(0);
    const arrived = await readBodies();
    await expect.poll(async () => (await readBodies()).tick, { timeout: 15_000 }).toBeGreaterThan(arrived.tick + 90);
    const held = await readBodies();
    expect(Math.hypot(held.npc[0] - arrived.npc[0], held.npc[2] - arrived.npc[2])).toBeLessThan(0.02);
    expect(held.actions).toHaveLength(0);
    await page.locator('#companion .companion-toggle').click();
    await page.evaluate(() => window.__seedlandsHarness!.setView(0, 0));
    await lockPointer(page);
    await page.keyboard.down('KeyW');
    try {
      await expect
        .poll(
          async () => {
            const current = await readBodies();
            return Math.hypot(current.player[0] - held.player[0], current.player[2] - held.player[2]);
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThan(4);
    } finally {
      await page.keyboard.up('KeyW');
      await page.keyboard.press('KeyT');
    }
    await expect
      .poll(
        async () => {
          const current = await readBodies();
          return Math.hypot(current.npc[0] - held.npc[0], current.npc[2] - held.npc[2]);
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(1);
    const followed = await readBodies();
    expect(Math.hypot(followed.npc[0] - followed.player[0], followed.npc[2] - followed.player[2])).toBeLessThan(
      Math.hypot(held.npc[0] - followed.player[0], held.npc[2] - followed.player[2]),
    );
    await persistEvidence('hold-and-follow-bodies', { arrived, held, followed });
    holdNextDecision = true;
    await page.getByLabel('和阿岚说句话').fill('等一下，先别改变计划。');
    await page.getByRole('button', { name: '说话', exact: true }).click();
    await expect.poll(() => releaseDecision !== undefined).toBe(true);
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await expect.poll(() => heldDecisionAborted).toBe(true);
    expect(controls.at(-1)).toBe('pause');
    const paused = await readCharacter();
    releaseDecision!();
    // Drain the deliberately late provider completion before querying Authority again.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(page.locator('#companion .connection')).toContainText('世界已暂停');
    const afterLateCompletion = await readCharacter();
    expect(afterLateCompletion.revision).toBe(paused.revision);
    expect(afterLateCompletion.lastSpeech).toBe(paused.lastSpeech);
    expect(afterLateCompletion.currentGoal).toEqual(paused.currentGoal);
    await page.getByRole('button', { name: '继续游戏', exact: true }).click();
    await expect.poll(() => controls.at(-1)).toBe('resume');
    await persistEvidence('controller-round-trips', {
      provider: 'deterministic fixture, not real model evidence',
      calls,
      controls,
      pages,
      historyCursor,
      controlled,
      disconnected,
      paused,
      afterLateCompletion,
      heldDecisionAborted,
    });
  } finally {
    releaseDecision?.();
    await host.close();
  }
});
