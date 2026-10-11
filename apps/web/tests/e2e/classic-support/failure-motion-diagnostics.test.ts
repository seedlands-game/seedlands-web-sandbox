import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { collectClassicFailureDiagnostics } from './evidence';

afterEach(() => vi.unstubAllGlobals());

const page = {
  evaluate: async (callback: (includeNearby: boolean) => unknown, includeNearby: boolean) => callback(includeNearby),
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
  it('uses a later formal query and retains only bounded independent character poses', async () => {
    const snapshot = vi.fn(() => ({ player: [90, 32.6, 0.5], authority: { physicsTick: 731 } }));
    installWindow(snapshot);
    const bodies = Array.from({ length: 65 }, (_, index) => ({
      id: `actor-${index}`,
      type: 'creature',
      archetype: 'cow',
      position: [90 + index / 100, 31, 0.5],
      physicsVelocity: [0, 0, 0],
      privateBrain: { goal: 'not in the diagnostic contract' },
    }));
    const command = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        success: true,
        data: { entities: [{ id: 'drop', type: 'world-item', position: [90, 31, 0.5] }, ...bodies] },
      },
      frontier: { epoch: 'world-1', physicsTick: 734, worldRevision: 145, commitSequence: 800, internal: [1, 2] },
    });
    (window as unknown as { __seedlandsHarness: { world: unknown } }).__seedlandsHarness.world = { command };
    const result = await collectClassicFailureDiagnostics(page, true);
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'query-nearby', radius: 8 });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(result?.nearbyEntities).toMatchObject({
      status: 'OBSERVED',
      diagnosticOnly: true,
      eligible: false,
      observedNearbyCount: 66,
      truncated: true,
      frontier: { epoch: 'world-1', physicsTick: 734, worldRevision: 145, commitSequence: 800 },
    });
    const observed = result?.nearbyEntities as { entities: unknown[]; frontier: unknown };
    expect(observed.entities).toHaveLength(64);
    expect(observed.entities[0]).toEqual({
      id: 'actor-0',
      type: 'creature',
      archetype: 'cow',
      position: [90, 31, 0.5],
      physicsVelocity: [0, 0, 0],
    });
    expect(observed.frontier).not.toHaveProperty('internal');
    bodies[0]!.position[0] = 99;
    expect(observed.entities[0]).toMatchObject({ position: [90, 31, 0.5] });
  });

  it('retains original motion/input evidence when the later query is rejected', async () => {
    const snapshot = vi.fn(() => ({ player: [90, 32.6, 0.5], authority: { physicsTick: 731 } }));
    const input = installWindow(snapshot);
    const command = vi.fn().mockResolvedValue({ ok: false, error: { code: 'unavailable' } });
    (window as unknown as { __seedlandsHarness: { world: unknown } }).__seedlandsHarness.world = { command };
    const result = await collectClassicFailureDiagnostics(page, true);
    expect(result?.nearbyEntities).toMatchObject({ status: 'QUERY_FAILED', reason: 'query-rejected' });
    expect(result?.inputDecisions).toEqual(input);
    expect(result?.presentation).toMatchObject({ motion: { authority: { physicsTick: 731 } } });
  });

  it('leaves the available query port untouched by default', async () => {
    installWindow(() => ({ player: [90, 32.6, 0.5], authority: { physicsTick: 731 } }));
    const command = vi.fn();
    (window as unknown as { __seedlandsHarness: { world: unknown } }).__seedlandsHarness.world = { command };
    const result = await collectClassicFailureDiagnostics(page);
    expect(command).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('nearbyEntities');
  });

  it('isolates a thrown query error from the captured original evidence', async () => {
    const input = installWindow(() => ({ player: [90, 32.6, 0.5], authority: { physicsTick: 731 } }));
    const command = vi.fn().mockRejectedValue(new Error('private query details'));
    (window as unknown as { __seedlandsHarness: { world: unknown } }).__seedlandsHarness.world = { command };
    const result = await collectClassicFailureDiagnostics(page, true);
    expect(result?.nearbyEntities).toEqual({ status: 'QUERY_FAILED', reason: 'query-error' });
    expect(result?.inputDecisions).toEqual(input);
  });

  it('rejects nonfinite poses and bounds scanning before a later valid actor', async () => {
    installWindow(() => ({ player: [90, 32.6, 0.5], authority: { physicsTick: 731 } }));
    const entities = [
      { id: 'invalid', type: 'npc', position: [NaN, 31, 0.5] },
      { id: 'valid', type: 'npc', position: [90, 31, 0.5], physicsVelocity: [Infinity, 0, 0] },
      ...Array.from({ length: 510 }, () => null),
      { id: 'beyond-scan', type: 'npc', position: [90, 31, 0.5] },
    ];
    const command = vi.fn().mockResolvedValue({
      ok: true,
      data: { success: true, data: { entities } },
      frontier: { physicsTick: Infinity, epoch: 1 },
    });
    (window as unknown as { __seedlandsHarness: { world: unknown } }).__seedlandsHarness.world = { command };
    const result = await collectClassicFailureDiagnostics(page, true);
    expect(result?.nearbyEntities).toMatchObject({
      truncated: true,
      scanLimit: 512,
      frontier: { epoch: null, physicsTick: null, worldRevision: null, commitSequence: null },
      entities: [{ id: 'valid', type: 'npc', archetype: null, position: [90, 31, 0.5], physicsVelocity: null }],
    });
  });
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

  it('运行时Authority额外字段不进入窄控制台合同，完整原snapshot保持', async () => {
    const authority = {
      physicsTick: 731,
      acknowledgedInputSequence: 92,
      commitSequence: 144,
      residency: { evictionCount: 1, residentCount: 27, dirtyCount: 2, internalSamples: [9, 8] },
      physicsCost: { samples: [11, 22, 33] },
    };
    const snapshot = vi.fn(() => ({ player: [0, 32, 0], authority }));
    installWindow(snapshot);
    const result = await collectClassicFailureDiagnostics(page);
    expect((result?.presentation as { motion?: { authority?: unknown } }).motion?.authority).toEqual({
      physicsTick: 731,
      acknowledgedInputSequence: 92,
      commitSequence: 144,
      residency: { evictionCount: 1, residentCount: 27, dirtyCount: 2 },
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(authority.physicsCost.samples).toEqual([11, 22, 33]);
    expect(authority.residency.internalSamples).toEqual([9, 8]);
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
