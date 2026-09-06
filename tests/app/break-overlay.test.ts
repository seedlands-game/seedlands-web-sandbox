import { describe, expect, it } from 'vitest';
import { BreakOverlayState, breakOverlayStage } from '../../src/app/gameplay/break-overlay-state';

describe('方块破坏覆盖层状态', () => {
  it('把权威进度单调量化为 0–9 阶', () => {
    expect([0, 0.01, 0.099, 0.1, 0.51, 0.999, 1].map(breakOverlayStage)).toEqual([0, 0, 0, 1, 5, 9, 9]);
    expect(breakOverlayStage(Number.NaN)).toBeNull();
  });

  it('目标变化和取消会清除旧坐标，不允许阶段倒退', () => {
    const state = new BreakOverlayState();
    expect(state.update([1, 2, 3], 0.42)).toEqual({ position: [1, 2, 3], stage: 4 });
    expect(state.update([1, 2, 3], 0.18)).toEqual({ position: [1, 2, 3], stage: 4 });
    expect(state.update([2, 2, 3], 0.18)).toEqual({ position: [2, 2, 3], stage: 1 });
    expect(state.clear()).toBeNull();
    expect(state.current).toBeNull();
  });
});
