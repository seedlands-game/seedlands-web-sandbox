import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createLifeBehavior } from '@seedlands/game-core/runtime/character-control-protocol';
import { definitionHash, faceLifeCharacter, LifeEvidence, lifeSample, lifeScene, startLifeScene } from './support';

test('同一组合世界三位伙伴以有限共享食物跨昼夜连续生活1800模拟秒', async ({ page }, testInfo) => {
  // Three Authorities, event drains, resource checks, and evidence screenshots; this is a hang budget, not a performance metric.
  test.setTimeout(600_000);
  const sockets: string[] = [];
  const errors: string[] = [];
  page.on('websocket', (socket) => sockets.push(new URL(socket.url()).host));
  page.on('pageerror', (error) => errors.push(error.message));
  const first = await startLifeScene(page);
  const paused = await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'pause' }));
  expect(paused, JSON.stringify(paused)).toMatchObject({ ok: true, data: { paused: true } });
  const newcomers = [
    { name: '青禾', personality: '沉稳勤快，喜欢巡视食物附近，入夜回家休息。', position: [-2.5, 57, 0.5] as const },
    { name: '小满', personality: '好奇但谨慎，照看营地，珍惜有限的食物。', position: [0.5, 57, -3.5] as const },
  ];
  const others = await page.evaluate(
    async (births) => {
      const world = window.__seedlandsHarness!.world;
      const created = [];
      for (const birth of births) {
        const result = await world.character({ kind: 'create', ...birth });
        if (!result.ok || result.data.kind !== 'created') throw new Error('三伙伴出生失败');
        created.push(result.data.character);
      }
      return created;
    },
    newcomers.map(({ name, personality, position }) => ({
      profile: { name, personality },
      position,
      homePosition: position,
      behaviorTree: createLifeBehavior({
        homePosition: position,
        patrolPositions: lifeScene.patrolPositions,
        hungerStart: 40,
        hungerSatisfied: 20,
        threatResponse: 'flee',
      }),
    })),
  );
  const characters = [first, ...others];
  expect(new Set(characters.map((character) => character.entityId)).size).toBe(3);
  expect(new Set(characters.map((character) => character.profile.personality)).size).toBe(3);
  const initial = await Promise.all(characters.map((character) => lifeSample(page, character.entityId, 0)));
  const worldItemIds = () =>
    page.evaluate(async () => {
      const result = await window.__seedlandsHarness!.world.command({ type: 'query-nearby', radius: 128 });
      if (!result.ok || !result.data.success) throw new Error('有限食物实体清单不可用');
      return (result.data.data as { entities: { id: string; type: string }[] }).entities
        .filter((entity) => entity.type === 'world-item')
        .map((entity) => entity.id);
    });
  const initialItemIds = await worldItemIds();
  expect(initialItemIds).toHaveLength(lifeScene.food.length);
  const hashes = initial.map((sample) => definitionHash(sample.observation));
  const lives = [new LifeEvidence(), ...newcomers.map((entry) => new LifeEvidence(entry.position))];
  const cursors = [0, 0, 0];
  const samples = [initial];
  let nextPlayerMeal = lifeScene.playerFood.useEverySimulatedSeconds;
  try {
    for (let seconds = 0; seconds < 1800; seconds += 10) {
      const advanced = await page.evaluate(() =>
        window.__seedlandsHarness!.world.clock({ kind: 'advance', elapsedMs: 10000 }),
      );
      expect(advanced, `Advance at ${seconds} seconds: ${JSON.stringify(advanced)}`).toMatchObject({ ok: true });
      const current = await Promise.all(
        characters.map((character, index) => lifeSample(page, character.entityId, cursors[index])),
      );
      samples.push(current);
      current.forEach((sample, index) => {
        expect(definitionHash(sample.observation), characters[index].profile.name).toBe(hashes[index]);
        expect(sample.observation.character.entityId).toBe(characters[index].entityId);
        lives[index].record(sample);
        cursors[index] = sample.observation.cursor;
      });
      expect(
        (await worldItemIds()).filter((id) => !initialItemIds.includes(id)),
        '不得凭空生成食物或死亡掉落',
      ).toEqual([]);
      if (current[0].simulationTime - initial[0].simulationTime >= nextPlayerMeal) {
        const slot = current[0].player.inventory.findIndex((entry) => entry?.itemId === lifeScene.playerFood.itemId);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(
          await page.evaluate(async (slot) => {
            const world = window.__seedlandsHarness!.world;
            const selected = await world.command({ type: 'select-slot', slot });
            if (!selected.ok || !selected.data.success) throw new Error('玩家初始补给槽不可用');
            return world.command({ type: 'use-item' });
          }, slot),
        ).toMatchObject({ ok: true, data: { success: true } });
        nextPlayerMeal += lifeScene.playerFood.useEverySimulatedSeconds;
      }
      if ([0, 890, 1790].includes(seconds)) {
        await faceLifeCharacter(page, first.entityId);
        await page.screenshot({ path: testInfo.outputPath(`three-life-${seconds + 10}.png`) });
      }
    }
    lives.forEach((life, index) => {
      expect(life.feedingEpisodes, characters[index].profile.name).toBeGreaterThanOrEqual(3);
      expect(life.nightDayEpisodes, characters[index].profile.name).toBeGreaterThanOrEqual(2);
      expect(life.patrolArrivals, characters[index].profile.name).toBeGreaterThanOrEqual(4);
    });
    expect(samples.at(-1)![0].simulationTime - initial[0].simulationTime).toBeGreaterThanOrEqual(1800);
    expect(sockets.filter((host) => host !== new URL(page.url()).host)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    writeFileSync(
      testInfo.outputPath('three-npc-continuous-life.json'),
      JSON.stringify({
        characters,
        hashes,
        samples,
        outcomes: lives.map((life) => ({
          feedingEpisodes: life.feedingEpisodes,
          nightDayEpisodes: life.nightDayEpisodes,
          patrolArrivals: life.patrolArrivals,
        })),
        initialWorldFoodUnits: lifeScene.food.reduce((sum, food) => sum + food.count, 0),
        initialItemIds,
        sockets,
        errors,
        postStartResourceInjection: 0,
        modelCalls: 0,
        treeChanges: 0,
      }),
    );
  }
});
