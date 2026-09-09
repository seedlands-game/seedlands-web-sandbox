import { appendFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { definitionHash, faceLifeCharacter, LifeEvidence, lifeSample, lifeScene, startLifeScene } from './support';

test.beforeEach(async ({ page }, testInfo) => {
  const path = testInfo.outputPath('browser-errors.jsonl');
  page.on('pageerror', (error) =>
    appendFileSync(path, JSON.stringify({ kind: 'pageerror', message: error.message, stack: error.stack }) + '\n'),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      appendFileSync(path, JSON.stringify({ kind: 'console', message: message.text() }) + '\n');
  });
});

test('固定行为树通过真实身体连续补给，并在面板显示生效执行状态', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const character = await startLifeScene(page);
  const first = await lifeSample(page, character.entityId, 0);
  const hash = definitionHash(first.observation);
  const evidence = new LifeEvidence();
  const samples = [first];
  let cursor = first.observation.cursor;
  evidence.record(first);
  await faceLifeCharacter(page, character.entityId);
  await page.screenshot({ path: testInfo.outputPath('life-early.png') });
  await expect(page.getByLabel('生效行为树')).toBeVisible();
  try {
    await expect
      .poll(
        async () => {
          const sample = await lifeSample(page, character.entityId, cursor);
          cursor = sample.observation.cursor;
          samples.push(sample);
          expect(definitionHash(sample.observation)).toBe(hash);
          evidence.record(sample);
          return evidence.feedingEpisodes;
        },
        { timeout: 60000, intervals: [500, 1000] },
      )
      .toBeGreaterThanOrEqual(1);
    const lived = samples.at(-1)!;
    expect(lived.observation.character.hunger).toBeLessThanOrEqual(20);
    expect(lived.observation.self.position).not.toEqual(first.observation.self.position);
    expect(samples.flatMap((sample) => sample.observation.events).map((event) => event.type)).toEqual(
      expect.arrayContaining(['item-picked-up', 'item-consumed']),
    );
    expect([...evidence.actions.values()].some((count) => count >= 2)).toBe(true);
    expect(lived.physicsTick).toBeGreaterThan(first.physicsTick);
    await faceLifeCharacter(page, character.entityId);
    await expect
      .poll(async () => Number(await page.locator('#companion .vitals span').nth(1).locator('b').textContent()))
      .toBeLessThanOrEqual(20);
    await page.screenshot({ path: testInfo.outputPath('life-after-feeding.png') });
    await page.getByLabel('生效行为树').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('life-behavior-inspector.png') });
  } finally {
    await testInfo.attach('life-world-observations', {
      body: JSON.stringify({ hash, samples }),
      contentType: 'application/json',
    });
  }
});

test('固定初始资源、零模型、零换树的60分钟浏览器生活', async ({ page }, testInfo) => {
  test.skip(process.env.SEEDLANDS_NPC_LONG_LIFE !== '1', '显式 opt-in 的60分钟旅程；短测试不代替此验收');
  test.setTimeout((lifeScene.duration.browserWallSeconds + 120) * 1000);
  const character = await startLifeScene(page);
  const first = await lifeSample(page, character.entityId, 0);
  const hash = definitionHash(first.observation);
  const evidence = new LifeEvidence();
  const journal = testInfo.outputPath('life-observations.jsonl');
  const start = performance.now();
  const seconds = lifeScene.duration.browserWallSeconds;
  let cursor = 0;
  let middleCaptured = false;
  let last = first;
  let nextPlayerMeal = lifeScene.playerFood.useEverySimulatedSeconds;
  writeFileSync(
    journal,
    JSON.stringify({ kind: 'manifest', hash, scene: lifeScene, initial: first, requestedWallSeconds: seconds }) + '\n',
  );
  await faceLifeCharacter(page, character.entityId);
  await page.screenshot({ path: testInfo.outputPath('life-early.png') });
  try {
    while (performance.now() - start < seconds * 1000) {
      last = await lifeSample(page, character.entityId, cursor);
      cursor = last.observation.cursor;
      appendFileSync(journal, JSON.stringify({ wallMs: performance.now() - start, ...last }) + '\n');
      expect(last.paused).toBe(false);
      expect(definitionHash(last.observation)).toBe(hash);
      evidence.record(last);
      if (last.simulationTime - first.simulationTime >= nextPlayerMeal) {
        const slot = last.player.inventory.findIndex((entry) => entry?.itemId === lifeScene.playerFood.itemId);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(8);
        const receipt = await page.evaluate(async (slot) => {
          const world = window.__seedlandsHarness!.world;
          const selected = await world.command({ type: 'select-slot', slot });
          if (!selected.ok || !selected.data.success) throw new Error('Player food slot unavailable');
          return world.command({ type: 'use-item' });
        }, slot);
        expect(receipt).toMatchObject({ ok: true, data: { success: true } });
        appendFileSync(
          journal,
          JSON.stringify({ kind: 'player-used-initial-food', atSimulationTime: last.simulationTime, receipt }) + '\n',
        );
        nextPlayerMeal += lifeScene.playerFood.useEverySimulatedSeconds;
      }
      if (!middleCaptured && performance.now() - start >= seconds * 500) {
        await faceLifeCharacter(page, character.entityId);
        await page.screenshot({ path: testInfo.outputPath('life-middle.png') });
        middleCaptured = true;
      }
      await page.waitForTimeout(1000);
    }
    expect(last.simulationTime - first.simulationTime).toBeGreaterThanOrEqual(
      lifeScene.duration.headlessSimulatedSeconds,
    );
    expect(evidence.feedingEpisodes).toBeGreaterThanOrEqual(3);
    expect(evidence.nightDayEpisodes).toBeGreaterThanOrEqual(2);
    expect(evidence.patrolArrivals).toBeGreaterThanOrEqual(4);
    expect([...evidence.actions.values()].some((count) => count >= 3)).toBe(true);
    await faceLifeCharacter(page, character.entityId);
    await page.screenshot({ path: testInfo.outputPath('life-late.png') });
    await expect(page.locator('#companion .connection')).toContainText('未连接模型');
  } finally {
    await testInfo.attach('life-journal', { path: journal, contentType: 'application/x-ndjson' });
    await testInfo.attach('life-outcome', {
      body: JSON.stringify({
        hash,
        wallSeconds: (performance.now() - start) / 1000,
        last,
        feedingEpisodes: evidence.feedingEpisodes,
        nightDayEpisodes: evidence.nightDayEpisodes,
        patrolArrivals: evidence.patrolArrivals,
        postStartResourceInjection: 0,
        treeChanges: 0,
      }),
      contentType: 'application/json',
    });
  }
});
