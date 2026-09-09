import { expect, test } from '@playwright/test';
import { HeadlessSession } from '../../../packages/game-core/src/server/headless/headless-session';
import { baseVoxel, normalizeSeed, Voxel } from '../../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../../../tests/support/core-platform';
import { lockPointer, snapshot, startHarnessWorld } from '../../../tests/e2e/support/harness';

const SEED = 'cross-host-world-harness-parity';
const BROWSER_TARGET_SEED = 'cross-host-browser-target';
const EDITED: [number, number, number] = [1, 30, 1];
const EXTRA: [number, number, number] = [129, 30, 1];
const GENERATED = (() => {
  const sourceSeed = normalizeSeed(SEED);
  const targetSeed = normalizeSeed(BROWSER_TARGET_SEED);
  for (let x = 192; x < 224; x += 1)
    for (let z = 0; z < 32; z += 1)
      for (let y = 8; y < 48; y += 1) {
        const source = baseVoxel(sourceSeed, x, y, z);
        const target = baseVoxel(targetSeed, x, y, z);
        if (source !== target) return { position: [x, y, z] as [number, number, number], source, target };
      }
  throw new Error('Cross-seed generated voxel fixture is unavailable.');
})();

test('Headless checkpoint 在真实 Browser Authority Worker 恢复并保持确定 parity', async ({ page }) => {
  const source = await HeadlessSession.create({ platform: testCorePlatform, seedText: SEED });
  await source.world.clock({ kind: 'pause' });
  await source.world.prepare({ kind: 'chunk', chunk: [0, 0, 0] });
  await source.world.command({ type: 'set-block', position: EDITED, voxel: Voxel.Wood });
  await source.world.command({ type: 'spawn-actor', id: 'parity-actor', archetype: 'settler', position: [3, 30, 3] });
  await source.world.command({ type: 'start-action', entityId: 'parity-actor', action: 'idle' });
  const exported = await source.world.checkpoint({ kind: 'export' });
  if (!exported.ok || !exported.data.snapshot) throw new Error('Headless checkpoint export failed.');

  const control = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'parity-control-target' });
  await control.world.checkpoint({ kind: 'restore', snapshot: exported.data.snapshot });
  await control.world.logic({ kind: 'mode', mode: 'scripted' });
  const controlAdvance = await control.world.clock({ kind: 'advance', elapsedMs: 1_000 });
  const controlVoxel = await control.world.inspect({ kind: 'voxel', position: EDITED });
  const controlActor = await control.world.inspect({ kind: 'actor', entityId: 'parity-actor' });
  const controlActions = await control.world.actions({ entityId: 'parity-actor' });

  await startHarnessWorld(page, BROWSER_TARGET_SEED);
  const result = await page.evaluate(
    async ({ checkpoint, edited, extra, generated, lantern }) => {
      const world = window.__seedlandsHarness!.world;
      const prepare = async (request: Parameters<typeof world.prepare>[0]) => {
        const result = await world.prepare(request);
        if (!result.ok) throw new Error(`World preparation failed: ${JSON.stringify({ request, result })}`);
        return result;
      };
      await world.clock({ kind: 'pause' });
      await prepare({ kind: 'chunk', chunk: [4, 0, 0] });
      await world.command({ type: 'set-block', position: extra, voxel: lantern });
      const browserCheckpoint = await world.checkpoint({ kind: 'export' });
      if (!browserCheckpoint.ok) throw new Error('Browser pre-restore checkpoint failed.');

      await world.logic({ kind: 'mode', mode: 'scripted' });
      const oldObservation = await world.logic({ kind: 'observe' });
      if (!oldObservation.ok || !('observation' in oldObservation.data))
        throw new Error('Old observation unavailable.');
      const before = await world.identity();
      const restored = await world.checkpoint({ kind: 'restore', snapshot: checkpoint });
      const after = await world.identity();
      await world.logic({ kind: 'mode', mode: 'scripted' });
      const staleLogic = await world.logic({
        kind: 'submit',
        batch: {
          protocolVersion: 1,
          epoch: oldObservation.data.observation.epoch,
          observationSequence: oldObservation.data.observation.observationSequence,
          expiresAtPhysicsTick: oldObservation.data.observation.physicsTick + 60,
          intents: [],
        },
      });
      const newObservation = await world.logic({ kind: 'observe' });
      if (!newObservation.ok || !('observation' in newObservation.data))
        throw new Error('New observation unavailable.');
      const freshLogic = await world.logic({
        kind: 'submit',
        batch: {
          protocolVersion: 1,
          epoch: newObservation.data.observation.epoch,
          observationSequence: newObservation.data.observation.observationSequence,
          expiresAtPhysicsTick: newObservation.data.observation.physicsTick + 60,
          intents: [],
        },
      });
      await prepare({
        kind: 'chunks',
        chunks: [
          [0, 0, 0],
          [4, 0, 0],
        ],
      });
      await prepare({
        kind: 'chunk',
        chunk: [Math.floor(generated[0] / 32), Math.floor(generated[1] / 32), Math.floor(generated[2] / 32)],
      });
      const derivedVoxel = window.__seedlandsHarness!.getVoxelAt?.(...generated) ?? null;
      const advanced = await world.clock({ kind: 'advance', elapsedMs: 1_000 });
      const voxel = await world.inspect({ kind: 'voxel', position: edited });
      const removedExtra = await world.inspect({ kind: 'voxel', position: extra });
      const actor = await world.inspect({ kind: 'actor', entityId: 'parity-actor' });
      const actions = await world.actions({ entityId: 'parity-actor' });
      const roundTripCheckpoint = await world.checkpoint({ kind: 'export' });
      if (!roundTripCheckpoint.ok || !roundTripCheckpoint.data.snapshot)
        throw new Error('Browser round-trip checkpoint unavailable.');
      // Runtime ticks are epoch-local; compare both hosts after the same restore lifecycle.
      const roundTripRestore = await world.checkpoint({ kind: 'restore', snapshot: roundTripCheckpoint.data.snapshot });
      if (!roundTripRestore.ok) throw new Error(`Browser re-restore failed: ${JSON.stringify(roundTripRestore)}`);
      await world.logic({ kind: 'mode', mode: 'scripted' });
      const roundTripAdvance = await world.clock({ kind: 'advance', elapsedMs: 100 });
      const roundTripVoxel = await world.inspect({ kind: 'voxel', position: edited });
      const roundTripActor = await world.inspect({ kind: 'actor', entityId: 'parity-actor' });
      const roundTripActions = await world.actions({ entityId: 'parity-actor' });
      return {
        before,
        restored,
        after,
        staleLogic,
        freshLogic,
        voxel,
        removedExtra,
        derivedVoxel,
        actor,
        actions,
        advanced,
        roundTripCheckpoint: roundTripCheckpoint.data.snapshot,
        roundTripAdvance,
        roundTripVoxel,
        roundTripActor,
        roundTripActions,
      };
    },
    {
      checkpoint: exported.data.snapshot,
      edited: EDITED,
      extra: EXTRA,
      generated: GENERATED.position,
      lantern: Voxel.Lantern,
    },
  );

  expect(result.restored).toMatchObject({ ok: true, data: { restored: true } });
  expect(result.after).toMatchObject({ ok: true, data: { seedText: SEED } });
  if (!result.before.ok || !result.after.ok) throw new Error('Browser identity unavailable.');
  expect(result.after.data.epoch).not.toBe(result.before.data.epoch);
  expect(result.staleLogic).toMatchObject({ ok: true, data: { accepted: false } });
  expect(result.freshLogic).toMatchObject({ ok: true, data: { accepted: true } });
  if (!controlAdvance.ok || !controlAdvance.data.lanes || !controlVoxel.ok || !controlActor.ok || !controlActions.ok)
    throw new Error('Headless control fixture failed.');
  expect(result.voxel).toMatchObject({ ok: true, data: controlVoxel.data });
  expect(result.actor).toMatchObject({ ok: true, data: controlActor.data });
  expect(result.actions).toMatchObject({ ok: true, data: controlActions.data });
  const sharedLanes = {
    physicsSteps: controlAdvance.data.lanes.physicsSteps,
    gameplayPeriods: controlAdvance.data.lanes.gameplayPeriods,
    fluidPeriods: controlAdvance.data.lanes.fluidPeriods,
  };
  expect(result.advanced).toMatchObject({
    ok: true,
    data: { paused: true, lanes: sharedLanes },
  });
  if (!result.advanced.ok) throw new Error('Browser deterministic advance failed.');
  expect(result.advanced.frontier).toMatchObject({
    worldRevision: controlAdvance.frontier.worldRevision,
    commitSequence: controlAdvance.frontier.commitSequence,
    physicsTick: controlAdvance.frontier.physicsTick,
  });
  expect(result.removedExtra).not.toMatchObject({ ok: true, data: { voxel: Voxel.Lantern } });
  expect(GENERATED.source).not.toBe(GENERATED.target);
  expect(result.derivedVoxel).toBe(GENERATED.source);

  const roundTrip = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'browser-round-trip-target' });
  await roundTrip.world.checkpoint({ kind: 'restore', snapshot: result.roundTripCheckpoint });
  await roundTrip.world.logic({ kind: 'mode', mode: 'scripted' });
  const roundTripAdvance = await roundTrip.world.clock({ kind: 'advance', elapsedMs: 100 });
  const roundTripVoxel = await roundTrip.world.inspect({ kind: 'voxel', position: EDITED });
  const roundTripActor = await roundTrip.world.inspect({ kind: 'actor', entityId: 'parity-actor' });
  const roundTripActions = await roundTrip.world.actions({ entityId: 'parity-actor' });
  if (!roundTripAdvance.ok || !roundTripVoxel.ok || !roundTripActor.ok || !roundTripActions.ok)
    throw new Error('Browser to Headless round-trip failed.');
  if (!roundTripAdvance.data.lanes) throw new Error('Headless round-trip lanes unavailable.');
  expect(result.roundTripAdvance).toMatchObject({
    ok: true,
    data: {
      lanes: {
        physicsSteps: roundTripAdvance.data.lanes.physicsSteps,
        gameplayPeriods: roundTripAdvance.data.lanes.gameplayPeriods,
        fluidPeriods: roundTripAdvance.data.lanes.fluidPeriods,
      },
    },
  });
  if (!result.roundTripAdvance.ok) throw new Error('Browser round-trip advance failed.');
  expect(result.roundTripAdvance.frontier).toMatchObject({
    worldRevision: roundTripAdvance.frontier.worldRevision,
    commitSequence: roundTripAdvance.frontier.commitSequence,
    physicsTick: roundTripAdvance.frontier.physicsTick,
  });
  expect(result.roundTripVoxel).toMatchObject({ ok: true, data: roundTripVoxel.data });
  expect(result.roundTripActor).toMatchObject({ ok: true, data: roundTripActor.data });
  expect(result.roundTripActions).toMatchObject({ ok: true, data: roundTripActions.data });

  const beforeMovement = await snapshot(page);
  if (!beforeMovement) throw new Error('Browser product snapshot unavailable before resumed input.');
  await page.evaluate(async () => {
    const resumed = await window.__seedlandsHarness!.world.clock({ kind: 'run' });
    if (!resumed.ok) throw new Error(resumed.error.message);
  });
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction(
      ([startX, startZ]) => {
        const current = window.__seedlandsHarness?.snapshot();
        return Boolean(current && Math.hypot(current.player[0] - startX, current.player[2] - startZ) > 0.2);
      },
      [beforeMovement.player[0], beforeMovement.player[2]],
      { timeout: 15_000 },
    );
  } finally {
    await page.keyboard.up('KeyW');
  }
  await roundTrip.dispose();
  await source.dispose();
  await control.dispose();
});
