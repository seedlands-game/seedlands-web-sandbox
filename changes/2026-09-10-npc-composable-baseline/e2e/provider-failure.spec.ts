import { expect, test } from '@playwright/test';
import { buildCampPackFixture } from './camp-pack';
import { lifeSample, startLifeScene } from './support';

test('扩展条件故障经真实 Worker 返回并显示，重复读取不改角色状态，原生活树仍继续执行', async ({ page }, info) => {
  test.setTimeout(90000);
  const fixture = await buildCampPackFixture({ failingCondition: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await fixture.route(page);
    const character = await startLifeScene(page);
    await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'pause' }));
    const initial = await lifeSample(page, character.entityId, 0);
    const installed = await page.evaluate(
      async ({ entityId, behavior }) =>
        window.__seedlandsHarness!.world.character({
          kind: 'behavior',
          entityId,
          requestId: 'broken-milestone',
          expectedBehaviorRevision: behavior.revision,
          definition: behavior.definition,
          goal: {
            description: '照常生活，同时尝试核实营地条件。',
            milestones: [
              {
                id: 'camp-status',
                description: '确认营地条件',
                condition: { name: 'sample:condition-unavailable' },
              },
            ],
          },
        }),
      { entityId: character.entityId, behavior: initial.observation.character.behaviorTree },
    );
    expect(installed).toMatchObject({ ok: true });
    const first = await lifeSample(page, character.entityId, 0);
    const second = await lifeSample(page, character.entityId, 0);
    expect(second.observation.character).toEqual(first.observation.character);
    expect(first.observation.character.behaviorTree.runtime.milestones).toEqual([
      expect.objectContaining({ id: 'camp-status', satisfied: false, failure: expect.stringContaining('condition') }),
    ]);
    await expect(page.getByTestId('character-behavior')).toHaveAttribute('open', '');
    await expect(page.getByRole('status').filter({ hasText: '条件计算失败' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '条件计算失败' })).toContainText('condition');
    expect(
      await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'advance', elapsedMs: 20000 })),
    ).toMatchObject({ ok: true });
    const after = await lifeSample(page, character.entityId, 0);
    expect(after.physicsTick).toBeGreaterThan(first.physicsTick);
    expect(after.observation.character.lifecycle).toBe('active');
    expect(after.observation.character.behaviorTree.definition).toEqual(
      initial.observation.character.behaviorTree.definition,
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('provider-failure-visible.png') });
    await info.attach('provider-failure-observation', {
      body: JSON.stringify({ first, second, after, errors }),
      contentType: 'application/json',
    });
  } finally {
    await fixture.dispose();
  }
});
