import { describe, expect, it } from 'vitest';
import { MultiRateScheduler } from '../../src/runtime/multi-rate-scheduler';

describe('MultiRateScheduler', () => {
  it.each([30, 60, 120] as const)('以 %sHz 独立产生固定物理步', (physicsHz) => {
    const scheduler = new MultiRateScheduler({ physicsHz, gameplayHz: 20, fluidHz: 30 });

    const result = scheduler.advanceTo(1_000);

    expect(result.physicsSteps).toHaveLength(physicsHz);
    expect(result.physicsSteps.every((step) => step.dtSeconds === 1 / physicsHz)).toBe(true);
    expect(result.integratedPhysicsTimeMs).toBeCloseTo(1_000, 7);
  });

  it('为非整数频率比保存独立 deadline', () => {
    const scheduler = new MultiRateScheduler({ physicsHz: 60, gameplayHz: 11, fluidHz: 7 });

    const result = scheduler.advanceTo(1_000);

    expect(result.physicsSteps).toHaveLength(60);
    expect(result.gameplay).toMatchObject({ due: true, elapsedPeriods: 11 });
    expect(result.fluid).toMatchObject({ due: true, elapsedPeriods: 7 });
  });

  it('物理追赶受限并保留欠债，不用巨大 dt 假装追平', () => {
    const scheduler = new MultiRateScheduler({
      physicsHz: 60,
      gameplayHz: 20,
      fluidHz: 30,
      maxPhysicsCatchUpSteps: 4,
    });

    const first = scheduler.advanceTo(500);
    const second = scheduler.advanceTo(500);

    expect(first.physicsSteps).toHaveLength(4);
    expect(first.physicsSteps.every((step) => step.dtSeconds === 1 / 60)).toBe(true);
    expect(first.physicsDebtMs).toBeGreaterThan(400);
    expect(second.integratedPhysicsTimeMs).toBeGreaterThan(first.integratedPhysicsTimeMs);
    expect(second.physicsDebtMs).toBeLessThan(first.physicsDebtMs);
  });

  it('逻辑和流体过期周期合并为一次到期事件并报告被合并数量', () => {
    const scheduler = new MultiRateScheduler({
      physicsHz: 60,
      gameplayHz: 20,
      fluidHz: 30,
      maxPhysicsCatchUpSteps: 1,
    });

    const result = scheduler.advanceTo(500);

    expect(result.gameplay).toMatchObject({ due: true, elapsedPeriods: 10, coalescedPeriods: 9 });
    expect(result.fluid).toMatchObject({ due: true, elapsedPeriods: 15, coalescedPeriods: 14 });
  });
});
