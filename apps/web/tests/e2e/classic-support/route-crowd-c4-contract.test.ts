import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
vi.mock('./harness', () => ({ walkTo: vi.fn(async () => ({ marker: 'original-route-result' })) }));
import { walkTo } from './harness';
import { walkC4Route } from './route-pulse-diagnostics';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
for (const benchmark of [false, true])
  it(`keeps original C4 input, target, deadline and functional recovery: benchmark=${benchmark}`, async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', benchmark ? '1' : '0');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const page = {} as Page,
      target = [72.5, 0.5] as const;
    const result = await walkC4Route(page, target, 'KeyS');
    expect(result).toEqual({ marker: 'original-route-result' });
    expect(walkTo).toHaveBeenCalledWith(
      page,
      target,
      expect.objectContaining({ key: 'KeyS', jump: true, timeout: 90_000, recoverCrowd: true }),
    );
    const options = vi.mocked(walkTo).mock.calls[0]![2]!;
    expect(Boolean(options.diagnostics)).toBe(!benchmark);
  });
