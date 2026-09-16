import { describe, expect, it } from 'vitest';
import { pairedBootstrap } from '../../support/performance/ab-statistics';

describe('成对 bootstrap 保留运行间变异', () => {
  it('两次运行效果不同时，重采样必须能选到重复的同一运行', () => {
    const result = pairedBootstrap([100, 100], [20, 80]);
    expect(result.improvement).toBe(50);
    expect(result.ci95[0]).toBeCloseTo(20);
    expect(result.ci95[1]).toBeCloseTo(80);
  });
  it('保持成对关联，对恒定比例改进返回对应区间', () => {
    const result = pairedBootstrap([10, 100, 1000], [5, 50, 500]);
    expect(result.ci95).toEqual([50, 50]);
  });
});
