import { describe, expect, it } from 'vitest';
import { CognitionBudget } from '../src/budget';

describe('CognitionBudget', () => {
  it('uses session limits and reports a conservative price estimate rather than a fake zero bill', () => {
    const budget = new CognitionBudget({
      maxCalls: 2,
      maxInputTokens: 1000,
      maxOutputTokens: 100,
      maxOutputTokensPerCall: 50,
    });
    const flash = budget.reserve(100, 20, false);
    expect(flash).not.toBeNull();
    budget.settle(flash!, { inputTokens: 100, cacheHitTokens: 25, outputTokens: 20, totalTokens: 120 });
    const pro = budget.reserve(100, 20, true);
    expect(pro).not.toBeNull();
    budget.settle(pro!, { inputTokens: 100, cacheHitTokens: 25, outputTokens: 20, totalTokens: 120 });

    expect(budget.snapshot()).toMatchObject({ calls: 2, compressionCalls: 1, cachedTokens: 50 });
    expect(budget.snapshot().estimatedCostUsd).toBeGreaterThan(0);
    expect(budget.reserve(1, 1)).toBeNull();
  });
});
