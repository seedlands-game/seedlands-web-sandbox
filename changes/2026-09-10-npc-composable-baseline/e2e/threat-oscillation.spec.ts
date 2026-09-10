import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createLifeBehavior, type CharacterObservation } from '@seedlands/game-core/runtime/character-control-protocol';
import { startHarnessWorld, prepareFlatMovement } from '../../../tests/e2e/support/harness';

test('断开模型时，NPC 脱险后在安全侧找到食物，不在感知边界往返', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const sockets: string[] = [];
  const errors: string[] = [];
  page.on('websocket', (socket) => sockets.push(new URL(socket.url()).origin));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('seedlands.quality.v1', 'low'));
  await startHarnessWorld(page, 'npc-threat-edge-browser');
  await prepareFlatMovement(page);
  const birth = createLifeBehavior({ homePosition: [-1.5, 57, 0.5], patrolPositions: [[1.5, 57, 0.5]] });
  const id = await page.evaluate(async (behaviorTree) => {
    const world = window.__seedlandsHarness!.world;
    await world.clock({ kind: 'pause' });
    const nearby = await world.command({ type: 'query-nearby', radius: 128 });
    if (!nearby.ok || !nearby.data.success) throw new Error('No entities');
    for (const entity of (nearby.data.data as { entities: { id: string; type: string }[] }).entities)
      if (entity.type !== 'player') await world.command({ type: 'despawn-entity', entityId: entity.id });
    for (const command of [
      { type: 'fill', from: [-32, 56, -16], to: [16, 56, 16], voxel: 3 },
      { type: 'fill', from: [-32, 57, -16], to: [16, 61, 16], voxel: 0 },
      { type: 'teleport', position: [-25.5, 58.6, 10.5] },
      { type: 'spawn-actor', id: 'edge-threat', archetype: 'night-stalker', position: [1.5, 57, 0.5] },
      { type: 'spawn-world-item', itemId: 'berry', count: 20, position: [-17.5, 57, 0.5] },
    ] as const) {
      const receipt = await world.command(command);
      if (!receipt.ok || !receipt.data.success) throw new Error(`Fixture failed: ${JSON.stringify(receipt)}`);
    }
    const created = await world.character({
      kind: 'create',
      profile: { name: '避险测试', personality: '谨慎生活。' },
      position: [-8, 57, 0.5],
      homePosition: [-1.5, 57, 0.5],
      behaviorTree,
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('No NPC');
    return created.data.character.entityId;
  }, birth);
  await page.keyboard.press('F3');
  await page.keyboard.press('KeyT');
  await page.locator('[data-testid="character-behavior"] > summary').click();
  await expect(page.getByLabel('生效行为树')).toBeVisible();
  const samples: CharacterObservation[] = [];
  let cursor = 0;
  try {
    for (let second = 0; second < 20; second += 1) {
      const sample = await page.evaluate(
        async ({ entityId, sinceCursor }) => {
          const harness = window.__seedlandsHarness!;
          const advanced = await harness.world.clock({ kind: 'advance', elapsedMs: 1_000 });
          if (!advanced.ok) throw new Error('Clock advance failed');
          const observed = await harness.world.character({ kind: 'observe', entityId, sinceCursor });
          if (!observed.ok || observed.data.kind !== 'observation') throw new Error('No observation');
          return observed.data.observation;
        },
        { entityId: id, sinceCursor: cursor },
      );
      expect(sample.eventCoverage.lostRange).toBeUndefined();
      expect(sample.character.behaviorTree.revision).toBe(1);
      samples.push(sample);
      cursor = sample.cursor;
      if (second === 19)
        await expect
          .poll(async () => Number(await page.locator('#companion .vitals span').nth(1).locator('b').textContent()))
          .toBe(Math.round(sample.character.hunger));
      if ([0, 5, 19].includes(second)) {
        await page.evaluate(async (position) => {
          const harness = window.__seedlandsHarness!;
          const [px, py, pz] = harness.snapshot()!.player;
          const [x, y, z] = position;
          harness.setView(
            (Math.atan2(px - x, pz - z) * 180) / Math.PI,
            (Math.atan2(y + 1 - py, Math.hypot(x - px, z - pz)) * 180) / Math.PI,
          );
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        }, sample.self.position);
        await page.screenshot({ path: testInfo.outputPath(`retreat-${second + 1}.png`) });
      }
    }
    const events = samples.flatMap((sample) => sample.events);
    expect(
      events.filter((event) => event.type === 'activity-started' && event.nodeId === 'threat-action').length,
    ).toBeLessThanOrEqual(2);
    expect(samples.at(-1)!.self.position[0]).toBeLessThan(-10.5);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['item-picked-up', 'item-consumed']));
    expect(
      events.some(
        (event) =>
          event.nodeId === 'hunger-action' &&
          event.type === 'activity-succeeded' &&
          event.hunger !== undefined &&
          event.hunger <= 20,
      ),
    ).toBe(true);
    expect(sockets.filter((url) => new URL(url).host !== new URL(page.url()).host)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    const path = testInfo.outputPath('observations.json');
    writeFileSync(
      path,
      JSON.stringify({ source: process.env.SEEDLANDS_EVIDENCE_SHA ?? 'working-tree', sockets, samples }),
    );
    await testInfo.attach('threat-edge-authority-observations', {
      path,
      contentType: 'application/json',
    });
  }
});
