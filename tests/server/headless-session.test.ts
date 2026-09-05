import { describe, expect, it } from 'vitest';
import { HeadlessSession } from '../../src/server/headless/headless-session';
import { runWorldComputeTask } from '../../src/worker/world-compute-task';
import { Voxel } from '../../src/world/voxel';

describe('HeadlessSession', () => {
  it('uses the shared deterministic compute path for the new-world feet spawn', async () => {
    const session = await HeadlessSession.create({ seedText: 'headless-safe-spawn' });
    const expected = await runWorldComputeTask({
      kind: 'find-safe-spawn',
      seed: session.runtime.server.seed,
      generatorVersion: session.runtime.server.generatorVersion,
    });

    expect(expected.kind).toBe('safe-spawn-result');
    if (expected.kind !== 'safe-spawn-result') throw new Error('Expected a safe spawn result.');
    expect(session.runtime.ready().playerBodyPosition).toEqual(expected.position);
    expect(session.persistence.loadGameplaySnapshot()).toBeNull();
  });

  it('advances every lane through Authority and performs real entity physics', async () => {
    const session = await HeadlessSession.create({ seedText: 'headless-multi-rate' });
    const spawn = await session.executeLine('/spawnitem wood-block 1 1 60 1', 1);
    expect(spawn.result.success).toBe(true);
    const item = session.runtime.server.queryEntities({ type: 'world-item' })[0];
    expect(item).toBeDefined();

    const advanced = await session.advanceSession(1_000);

    expect(advanced.lanes).toEqual({
      physicsSteps: 60,
      gameplayPeriods: 20,
      fluidPeriods: 30,
      logicBatches: 20,
    });
    expect(session.runtime.server.getEntity(item.id)!.position[1]).toBeLessThan(60);
    expect(advanced.snapshot.physicsDebtMs).toBeCloseTo(0, 6);
  });

  it('computes and commits fluid work during session advancement', async () => {
    const session = await HeadlessSession.create({ seedText: 'headless-fluid' });
    expect((await session.executeLine('/setblock 2 30 2 water', 1)).result.success).toBe(true);
    expect((await session.executeLine('/setblock 2 29 2 air', 2)).result.success).toBe(true);

    const advanced = await session.advanceSession(250);

    expect(advanced.lanes.fluidPeriods).toBeGreaterThan(0);
    expect(advanced.fluidCandidates).toBeGreaterThan(0);
    expect(session.runtime.server.getVoxel(2, 29, 2)).toBe(Voxel.Water);
  });

  it.each([30, 60, 120] as const)('keeps advancePhysics wall-clock semantics at %i Hz', async (physicsHz) => {
    const session = await HeadlessSession.create({
      seedText: `headless-${physicsHz}`,
      frequencies: { physicsHz, gameplayHz: 20, fluidHz: 30 },
    });

    const advanced = await session.advancePhysics(physicsHz);

    expect(advanced.elapsedMs).toBeCloseTo(1_000, 6);
    expect(advanced.lanes.physicsSteps).toBe(physicsHz);
    expect(advanced.lanes.gameplayPeriods).toBe(20);
    expect(advanced.lanes.fluidPeriods).toBe(30);
  });

  it('exposes logic and fluid advancement without bypassing the shared scheduler', async () => {
    const session = await HeadlessSession.create({ seedText: 'headless-lane-helpers' });

    const logic = await session.advanceLogic(2);
    const fluid = await session.advanceFluid(3);

    expect(logic.lanes).toMatchObject({ gameplayPeriods: 2, logicBatches: 2 });
    expect(fluid.lanes.fluidPeriods).toBe(3);
    expect(logic.lanes.physicsSteps).toBeGreaterThan(0);
    expect(fluid.lanes.physicsSteps).toBeGreaterThan(0);
  });

  it('chunks long legacy tick commands while retaining every real lane delta', async () => {
    const session = await HeadlessSession.create({ seedText: 'headless-long-tick' });

    const execution = await session.executeLine('/tick 61', 1);

    expect(execution.result).toMatchObject({
      success: true,
      data: {
        seconds: 61,
        elapsedMs: 61_000,
        lanes: { physicsSteps: 3_660, gameplayPeriods: 1_220, fluidPeriods: 1_830 },
      },
    });
  });

  it('deduplicates commands by the headless transaction identity', async () => {
    const session = await HeadlessSession.create({ seedText: 'headless-deduplication' });
    const first = await session.executeLine('/setblock 1 30 1 wood', 7);
    const replay = await session.executeLine('/setblock 1 30 1 wood', 7);

    expect(first.result).toEqual(replay.result);
    expect(session.runtime.server.worldRevision).toBe(1);
  });
});
