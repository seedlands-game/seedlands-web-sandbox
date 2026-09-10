import { expect, test } from '@playwright/test';
import { createLifeBehavior } from '@seedlands/game-core/runtime/character-control-protocol';
import type { FrozenGameSaveSnapshot } from '@seedlands/game-core/server/persistence/game-save-snapshot';
import { withCampWork } from '../examples/camp-work';
import { buildCampPackFixture } from './camp-pack';
import { faceLifeCharacter, lifeSample, startLifeScene } from './support';

test('浏览器加载独立扩展 Pack：伙伴发现新能力并正常加工，回档不复制物品，另外两位继续生活', async ({ page }, info) => {
  test.setTimeout(180000);
  const fixture = await buildCampPackFixture();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await fixture.route(page);
    const first = await startLifeScene(page);
    await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'pause' }));
    const others = await page.evaluate(
      async (births) => {
        const world = window.__seedlandsHarness!.world;
        const characters = [];
        for (const birth of births) {
          const created = await world.character({ kind: 'create', ...birth });
          if (!created.ok || created.data.kind !== 'created') throw new Error('扩展世界伙伴出生失败');
          characters.push(created.data.character);
        }
        return characters;
      },
      [
        { name: '青禾', position: [-2.5, 57, 0.5] as const },
        { name: '小满', position: [0.5, 57, -3.5] as const },
      ].map(({ name, position }) => ({
        profile: { name, personality: `${name}喜欢照看营地，会自己补给和休息。` },
        position,
        homePosition: position,
        behaviorTree: createLifeBehavior({
          homePosition: position,
          patrolPositions: [
            [-4.5, 57, -4.5],
            [4.5, 57, -7.5],
          ],
        }),
      })),
    );
    const initial = await lifeSample(page, first.entityId, 0);
    const capabilities = await page.evaluate(
      (entityId) => window.__seedlandsHarness!.world.character({ kind: 'capabilities', entityId }),
      first.entityId,
    );
    expect(capabilities).toMatchObject({
      ok: true,
      data: {
        kind: 'capabilities',
        capabilities: expect.arrayContaining([
          expect.objectContaining({
            id: 'sample:has-camp-material',
            kind: 'condition',
            provider: { moduleId: 'sample:camp-behavior', version: '1.0.0' },
          }),
          expect.objectContaining({ id: 'sample:prepare-planks', kind: 'skill' }),
        ]),
      },
    });
    expect(
      await page.evaluate(
        async ({ entityId, definition, revision }) => {
          const world = window.__seedlandsHarness!.world;
          const given = await world.command({ type: 'give-item', entityId, itemId: 'wood-block', count: 1 });
          if (!given.ok || !given.data.success) throw new Error('有限初始木材没有进入演员库存');
          return world.character({
            kind: 'behavior',
            entityId,
            requestId: 'camp-pack-work',
            expectedBehaviorRevision: revision,
            goal: { description: '先把我的木材制成营地木板，然后继续照看营地。' },
            definition,
          });
        },
        {
          entityId: first.entityId,
          definition: withCampWork(initial.observation.character.behaviorTree.definition),
          revision: initial.observation.character.behaviorTree.revision,
        },
      ),
    ).toMatchObject({ ok: true });
    const advance = async (elapsedMs: number) =>
      expect(
        await page.evaluate(
          (elapsedMs) => window.__seedlandsHarness!.world.clock({ kind: 'advance', elapsedMs }),
          elapsedMs,
        ),
      ).toMatchObject({ ok: true });
    await advance(1000);
    const running = await lifeSample(page, first.entityId, 0);
    expect(running.observation.character.behaviorTree.runtime.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skill: 'sample:prepare-planks', status: 'running', phase: 'preparing' }),
      ]),
    );
    await faceLifeCharacter(page, first.entityId);
    await page.screenshot({ path: info.outputPath('extension-skill-running.png') });
    // Keep typed checkpoint buffers inside the browser; Playwright JSON transport is not a save codec.
    const saved = await page.evaluateHandle(async (): Promise<unknown> => {
      const exported = await window.__seedlandsHarness!.world.checkpoint({ kind: 'export' });
      if (!exported.ok || !exported.data.snapshot) throw new Error('扩展世界存档不可用');
      return exported.data.snapshot;
    });
    expect(
      await saved.evaluate((snapshot) => (snapshot as FrozenGameSaveSnapshot).gameplay.composition?.packLock.length),
    ).toBe(2);
    const countPlanks = (sample: Awaited<ReturnType<typeof lifeSample>>) =>
      sample.observation.character.inventory.reduce(
        (sum, slot) => sum + (slot?.itemId === 'plank' ? slot.count : 0),
        0,
      );
    await advance(2000);
    expect(countPlanks(await lifeSample(page, first.entityId, 0))).toBe(4);
    expect(
      await saved.evaluate((snapshot) =>
        window.__seedlandsHarness!.world.checkpoint({ kind: 'restore', snapshot: snapshot as FrozenGameSaveSnapshot }),
      ),
    ).toMatchObject({ ok: true });
    await saved.dispose();
    await advance(2000);
    expect(countPlanks(await lifeSample(page, first.entityId, 0))).toBe(4);
    const samples = [];
    for (let period = 0; period < 6; period++) {
      await advance(10000);
      samples.push(await Promise.all([first, ...others].map((character) => lifeSample(page, character.entityId, 0))));
    }
    const final = samples.at(-1)!;
    expect(countPlanks(final[0])).toBe(4);
    for (const index of [1, 2]) {
      expect(final[index].observation.character.lifecycle).toBe('active');
      expect(final[index].observation.character.behaviorTree.revision).toBe(1);
      expect(samples.some((row) => row[index].observation.events.some((event) => event.type === 'item-consumed'))).toBe(
        true,
      );
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('extension-three-residents.png') });
    await info.attach('extension-pack-world-evidence', {
      body: JSON.stringify({
        admitted: fixture.approvedExtensions,
        capabilities,
        running,
        samples,
        errors,
        postStartResourceInjection: 0,
      }),
      contentType: 'application/json',
    });
  } finally {
    await fixture.dispose();
  }
});
