import { describe, expect, it } from 'vitest';
import { runNetworkBaselineReferenceCorpus } from './support/network-baseline-reference-corpus-recorder';

describe('真实 Authority 基线派生公开 reference 语料', () => {
  it('绑定冻结 r2 并逐条投影、lazy materialize 与乱序重组', async () => {
    const capture = process.env.SEEDLANDS_CAPTURE_BASELINE_REFERENCE === '1';
    const result = await runNetworkBaselineReferenceCorpus({
      mode: capture ? 'capture' : 'preview',
      sourceFrozen: capture,
    });
    expect(result.frames).toHaveLength(3);
    expect(result.frames.map((frame) => frame.pages.length)).toEqual([162, 162, 6]);
    expect(result.frames.map((frame) => frame.descriptor.entries.length)).toEqual([27, 27, 1]);
  });
});
