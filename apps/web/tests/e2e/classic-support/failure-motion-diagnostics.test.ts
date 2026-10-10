import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { collectClassicFailureDiagnostics } from './evidence';

afterEach(() => vi.unstubAllGlobals());

const page = {
  evaluate: async (callback: () => unknown) => callback(),
} as unknown as Page;

function installWindow(snapshot: (() => unknown) | undefined) {
  const input = { lastSequence: 93, totalReceipts: 94 };
  vi.stubGlobal('window', {
    __seedlandsHarness:
      snapshot === undefined
        ? undefined
        : {
            snapshot,
            aimedVoxelTarget: () => null,
            inputDecisionDiagnostics: () => input,
            getChunkRevision: () => 11,
            getRenderedChunkRevision: () => 10,
            exportPerformanceTrace: () => ({ traceEvents: [] }),
          },
  });
  vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [] });
  return input;
}

describe('失败控制台同次运动观察', () => {
  it('保留正式读回的玩家、Authority及停稳字段而不重复采样', async () => {
    const snapshot = vi.fn(() => ({
      player: [102.25, 31, -0.5],
      serverPlayerPosition: [102.5, 31, -0.5],
      serverPlayerVelocity: [4.5, 0, 0],
      viewAngles: [Math.PI / 2, 0],
      onGround: true,
      colliding: false,
      worldRevision: 145,
      authority: { physicsTick: 731, acknowledgedInputSequence: 92, commitSequence: 144, residency: null },
    }));
    const input = installWindow(snapshot);
    const result = await collectClassicFailureDiagnostics(page);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(result?.inputDecisions).toEqual(input);
    expect(result?.presentation).toMatchObject({
      diagnosticOnly: true,
      eligible: false,
      motion: snapshot.mock.results[0]!.value,
    });
    expect(result?.presentation).toMatchObject({
      chunks: expect.arrayContaining([{ key: '3,0,-1', authorityRevision: 11, renderedRevision: 10 }]),
    });
  });

  it('尚未启动时保持null观察及原启动诊断', async () => {
    installWindow(undefined);
    const result = await collectClassicFailureDiagnostics(page);
    expect(result?.inputDecisions).toBeNull();
    expect(result?.presentation).toMatchObject({ diagnosticOnly: true, eligible: false, motion: null, chunks: [] });
    expect(result?.startup.cardDisplay).toBeNull();
  });

  it('snapshot拒绝时保留错误及独立输入诊断', async () => {
    const input = installWindow(() => {
      throw new Error('snapshot unavailable');
    });
    const result = await collectClassicFailureDiagnostics(page);
    expect(result?.inputDecisions).toEqual(input);
    expect(result?.presentation).toEqual({ error: 'snapshot unavailable' });
  });
});
