import { describe, expect, it } from 'vitest';
// @ts-expect-error The executable JavaScript Harness helper is exercised through Vitest.
import { compareBrowserProfiles } from '../../scripts/harness-browser-profiles.mjs';

const profiles = {
  typescriptFallback: { status: 'PASS', metrics: { frameP95MedianMs: 20 } },
  defaultOptimized: { status: 'PASS', metrics: { frameP95MedianMs: 15 } },
};

describe('Harness browser profile comparison', () => {
  it('只比较同名且真实命中的 profile', () => {
    const comparison = compareBrowserProfiles(
      { profiles },
      {
        browserProfiles: {
          typescriptFallback: { status: 'PASS', metrics: { frameP95MedianMs: 25 } },
          defaultOptimized: { status: 'PASS', metrics: { frameP95MedianMs: 10 } },
        },
      },
      true,
    );
    expect(comparison).toEqual({
      typescriptFallback: {
        status: 'OBSERVED',
        metrics: { frameP95MedianMs: { baseline: 25, current: 20, percent: -20 } },
      },
      defaultOptimized: {
        status: 'OBSERVED',
        metrics: { frameP95MedianMs: { baseline: 10, current: 15, percent: 50 } },
      },
    });
  });

  it('回退样本与不同环境均不可作为对应基线比较', () => {
    expect(
      compareBrowserProfiles(
        { profiles: { ...profiles, defaultOptimized: { status: 'FALLBACK_NOT_BASELINE', metrics: {} } } },
        { browserProfiles: profiles },
        true,
      ).defaultOptimized,
    ).toEqual({ status: 'NOT_COMPARABLE' });
    expect(compareBrowserProfiles({ profiles }, { browserProfiles: profiles }, false)).toEqual({
      typescriptFallback: { status: 'NOT_COMPARABLE' },
      defaultOptimized: { status: 'NOT_COMPARABLE' },
    });
  });
});
