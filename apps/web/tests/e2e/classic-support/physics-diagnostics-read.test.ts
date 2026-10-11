import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { snapshot } from './harness';
import type { HarnessPhysicsDiagnostics } from '../../../src/app/gameplay/harness-physics-diagnostics';
import { withRoutePulseDiagnostics } from './route-pulse-diagnostics';
import type { ClassicSnapshot } from './harness-snapshot';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const fixture = () => {
  const observed = {
    authority: { physicsTick: 42, acknowledgedInputSequence: 7 },
    nativeMovementInput: { epoch: 'world:2' },
  };
  const diagnostics: HarnessPhysicsDiagnostics = {
    schemaVersion: 1,
    diagnosticOnly: true,
    epoch: 'world:2',
    physicsTick: 42,
    acknowledgedInputSequence: 7,
    player: {
      id: 'player',
      position: [100, 31, 0],
      velocity: [4.5, 0, 0],
      grounded: true,
      contacts: { count: 0, truncated: false, entries: [] },
    },
    bodies: { sourceCount: 1, scannedCount: 1, scanTruncated: false, nearbyCount: 0, truncated: false, entries: [] },
  };
  const read = vi.fn(() => diagnostics);
  const current = vi.fn(() => observed);
  vi.stubGlobal('window', { __seedlandsHarness: { snapshot: current, physicsDiagnostics: read } });
  const evaluate = vi.fn(async (run: (value: boolean) => unknown, value: boolean) => run(value));
  return { observed, diagnostics, read, current, evaluate, page: { evaluate } as unknown as Page };
};

describe('physics diagnostic read in the existing snapshot evaluation', () => {
  it('copies physics diagnostics before retaining a route observation', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const f = fixture();
    const position: [number, number, number] = [100, 31, 0];
    const diagnostics = { ...f.diagnostics, player: { ...f.diagnostics.player, position } };
    const value = {
      ...f.observed,
      player: [100, 32.6, 0],
      serverPlayerPosition: [100, 32.6, 0],
      serverPlayerVelocity: [4.5, 0, 0],
      physicsDiagnostics: diagnostics,
    } as unknown as ClassicSnapshot;
    const report = vi.spyOn(console, 'info').mockImplementation(() => {});
    await withRoutePulseDiagnostics('C4-outbound', [208.5, 0.5], 90_000, async (record) => {
      record!.begin(value);
      position[0] = 999;
    });
    const logged = JSON.parse(report.mock.calls[0]![1] as string);
    expect(logged.pulses[0].before.physicsDiagnostics.player.position).toEqual([100, 31, 0]);
    expect(logged.diagnosticOnly).toBe(true);
    expect(logged.eligible).toBe(false);
  });

  it('reads once in the same evaluation and preserves frontier metadata', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const f = fixture();
    const value = await snapshot(f.page);
    expect(value?.physicsDiagnostics).toEqual(f.diagnostics);
    expect(f.evaluate).toHaveBeenCalledTimes(1);
    expect(f.current).toHaveBeenCalledTimes(1);
    expect(f.read).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the diagnostic projection in benchmark snapshots', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '1');
    const f = fixture();
    expect(await snapshot(f.page)).toBe(f.observed);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.evaluate).toHaveBeenCalledTimes(1);
  });

  it.each(['epoch', 'physicsTick', 'acknowledgedInputSequence'] as const)('rejects mismatched %s', async (field) => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const f = fixture();
    f.read.mockReturnValue({ ...f.diagnostics, [field]: field === 'epoch' ? 'world:3' : 99 });
    expect((await snapshot(f.page))?.physicsDiagnostics).toBeNull();
  });
});
