import { describe, expect, it } from 'vitest';
import { BoundedCostSamples } from '../../packages/game-core/src/runtime/bounded-cost-samples';

describe('有界执行成本采样', () => {
  it('仅保留最新窗口，累计计数可用于跨快照去重', () => {
    const samples = new BoundedCostSamples(3);
    for (const cost of [4, 1, 3, 2]) samples.record(cost);
    expect(samples.snapshot()).toEqual({ count: 4, capacity: 3, samplesMs: [1, 3, 2] });
    samples.snapshot().samplesMs[0] = 99;
    expect(samples.snapshot().samplesMs).toEqual([1, 3, 2]);
  });

  it('无数据明确保留空窗口；无效测量不计入样本', () => {
    const samples = new BoundedCostSamples(2);
    expect(samples.snapshot().count).toBe(0);
    for (const invalid of [-1, NaN, Infinity]) expect(() => samples.record(invalid)).toThrow();
    expect(samples.snapshot().samplesMs).toEqual([]);
    samples.record(0);
    expect(samples.snapshot().samplesMs).toEqual([0]);
    for (const invalid of [0, -1, 1.5, Infinity]) expect(() => new BoundedCostSamples(invalid)).toThrow();
  });
});
