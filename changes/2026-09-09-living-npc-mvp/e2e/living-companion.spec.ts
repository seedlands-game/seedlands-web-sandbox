import { expect, test } from '@playwright/test';
import { faceCompanion, prepareCompanionGround } from './support';
import { lockPointer, prepareFlatMovement, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('玩家可邀请持久伙伴，真实拾取食用，并以完整 checkpoint 继续', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('seedlands.quality.v1', 'low'));
  await startHarnessWorld(page, 'living-companion-browser-contract');
  await prepareFlatMovement(page);
  await prepareCompanionGround(page);
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeHidden();
  await page.evaluate(async () => {
    await window.__seedlandsHarness!.setTimePaused(false);
    await window.__seedlandsHarness!.setTimeSpeed(1);
  });
  await lockPointer(page);
  await page.keyboard.press('KeyT');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  const dialogueClockDelta = await page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    await world.clock({ kind: 'pause' });
    // Drain the pre-pause gameplay frontier before comparing two equal advances.
    const before = await world.clock({ kind: 'advance', elapsedMs: 1000 });
    const after = await world.clock({ kind: 'advance', elapsedMs: 1000 });
    await world.clock({ kind: 'run' });
    if (!before.ok || !after.ok) throw new Error('World clock unavailable');
    return (after.data.snapshot.worldTime - before.data.snapshot.worldTime + 24) % 24;
  });
  expect(dialogueClockDelta).toBeCloseTo(0.04, 3);
  await page.getByRole('button', { name: '邀请阿岚进入世界' }).click();
  await expect(page.locator('#companion .identity strong')).toHaveText('阿岚');
  const initial = await page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    const list = await world.character({ kind: 'list' });
    if (!list.ok || list.data.kind !== 'list' || !list.data.characters[0]) throw new Error('Character missing');
    const character = list.data.characters[0];
    const observed = await world.character({ kind: 'observe', entityId: character.entityId, sinceCursor: 0 });
    if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Observation missing');
    const [x, y, z] = observed.data.observation.self.position;
    const dropped = await world.command({
      type: 'spawn-world-item',
      itemId: 'berry',
      count: 2,
      position: [x + 3, y, z],
    });
    if (!dropped.ok || !dropped.data.success) throw new Error(`Fixture food failed: ${JSON.stringify(dropped)}`);
    const intent = await world.character({
      kind: 'intent',
      entityId: character.entityId,
      requestId: 'browser-forage',
      expectedRevision: character.revision,
      goal: { kind: 'forage' },
    });
    if (!intent.ok) throw new Error(`Forage intent failed: ${JSON.stringify(intent)}`);
    return { character, position: observed.data.observation.self.position };
  });
  await faceCompanion(page, initial.character.entityId);
  await page.screenshot({ path: testInfo.outputPath('companion-early.png') });
  const observationSamples: unknown[] = [];
  await expect
    .poll(
      async () => {
        const observed = await page.evaluate(async (entityId) => {
          const result = await window.__seedlandsHarness!.world.character({
            kind: 'observe',
            entityId,
            sinceCursor: 0,
          });
          return result;
        }, initial.character.entityId);
        observationSamples.push(observed);
        if (!observed.ok || observed.data.kind !== 'observation') throw new Error(JSON.stringify(observed));
        return observed.data.observation.events.map((event) => event.type);
      },
      { timeout: 45_000, intervals: [500, 1000] },
    )
    .toEqual(expect.arrayContaining(['item-picked-up', 'item-consumed']))
    .finally(() =>
      testInfo.attach('observation-samples', {
        body: JSON.stringify({ initial, observationSamples }),
        contentType: 'application/json',
      }),
    );
  const lived = await page.evaluate(async (entityId) => {
    const world = window.__seedlandsHarness!.world;
    const paused = await world.clock({ kind: 'pause' });
    if (!paused.ok) throw new Error('Checkpoint preparation did not pause');
    const observed = await world.character({ kind: 'observe', entityId, sinceCursor: 0 });
    const checkpoint = await world.checkpoint({ kind: 'export' });
    if (!observed.ok || observed.data.kind !== 'observation' || !checkpoint.ok || !checkpoint.data.snapshot)
      throw new Error('Checkpoint missing');
    return { observation: observed.data.observation, checkpoint: checkpoint.data.snapshot };
  }, initial.character.entityId);
  expect(lived.observation.self.position).not.toEqual(initial.position);
  expect(lived.observation.character.profile).toEqual(initial.character.profile);
  await faceCompanion(page, initial.character.entityId);
  await page.screenshot({ path: testInfo.outputPath('companion-middle.png') });
  const restored = await page.evaluate(
    async ({ checkpoint, entityId }) => {
      const world = window.__seedlandsHarness!.world;
      const before = await world.identity();
      const restore = await world.checkpoint({ kind: 'restore', snapshot: checkpoint });
      const after = await world.identity();
      const character = await world.character({ kind: 'inspect', entityId });
      return { before, restore, after, character };
    },
    { checkpoint: lived.checkpoint, entityId: initial.character.entityId },
  );
  expect(restored.restore).toMatchObject({ ok: true });
  expect(restored.character).toMatchObject({
    ok: true,
    data: {
      character: {
        entityId: initial.character.entityId,
        incarnation: initial.character.incarnation,
        profile: initial.character.profile,
        inventory: lived.observation.character.inventory,
      },
    },
  });
  if (!restored.before.ok || !restored.after.ok) throw new Error('Identity missing');
  expect(restored.after.data.epoch).not.toEqual(restored.before.data.epoch);
  await page.evaluate(async () => {
    const result = await window.__seedlandsHarness!.world.clock({ kind: 'run' });
    if (!result.ok) throw new Error('Restored world failed to resume');
  });
  await expect(page.locator('#companion .identity strong')).toHaveText('阿岚');
  await faceCompanion(page, initial.character.entityId);
  await page.screenshot({ path: testInfo.outputPath('companion-restored.png') });
  await testInfo.attach('continuous-life', {
    body: JSON.stringify({ initial, lived: lived.observation, restored: restored.character }, null, 2),
    contentType: 'application/json',
  });
});
