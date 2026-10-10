import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeEquipmentOperation } from './equipment-operation-diagnostics';
import { withRoutePulseDiagnostics } from './route-pulse-diagnostics';
import type { ClassicSnapshot } from './harness-snapshot';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const snapshot = {
  player: [0, 32.6, 0],
  serverPlayerPosition: [0, 32.6, 0],
  serverPlayerVelocity: [0, 0, 0],
  onGround: true,
  colliding: false,
  authority: { physicsTick: 1, acknowledgedInputSequence: 1 },
} as unknown as ClassicSnapshot;

describe('V2 diagnostic callback and evidence boundaries', () => {
  it('原operation只执行一次并保留返回对象，耗时只记diagnostic', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValue(160);
    const value = Object.freeze({ result: 'original' });
    const run = vi.fn(async () => value);
    expect(await observeEquipmentOperation('mine:pickup', [0, 31, 0], run)).toBe(value);
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({
      diagnosticOnly: true,
      eligible: false,
      elapsedMs: 60,
      outcome: 'returned',
    });
  });
  it('operation与route均保留原错误对象', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = new Error('original native failure');
    const run = vi.fn(async () => {
      throw error;
    });
    await expect(observeEquipmentOperation('mine:break', [0, 31, 0], run)).rejects.toBe(error);
    await expect(withRoutePulseDiagnostics('V2-equipment', [3, 0], 45_000, run)).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(2);
    expect(JSON.parse(log.mock.calls[0]![1] as string).outcome).toBe('threw');
    expect(JSON.parse(log.mock.calls[1]![1] as string).status).toBe('threw');
  });
  it('route只保留已有pulse观察，第一fresh ACK是观察时刻，非server发生时刻', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result = await withRoutePulseDiagnostics('V2-equipment', [3, 0], 45_000, async (diagnostic) => {
      diagnostic!.begin(snapshot);
      now = 110;
      diagnostic!.beforeInput(snapshot, 80, 'KeyW');
      now = 190;
      diagnostic!.inputFinished('returned');
      now = 220;
      diagnostic!.observe({ ...snapshot, authority: { ...snapshot.authority, acknowledgedInputSequence: 2 } }, true);
      now = 240;
      return snapshot;
    });
    expect(result).toBe(snapshot);
    expect(log.mock.calls[0]![0]).toBe('Classic V2 route pulse diagnostic:');
    const report = JSON.parse(log.mock.calls[0]![1] as string);
    expect(report).toMatchObject({
      diagnosticOnly: true,
      eligible: false,
      pulseCount: 1,
      truncated: false,
      elapsedMs: 140,
    });
    expect(report.pulses[0]).toMatchObject({
      requestedDelayMs: 80,
      keyboardWallMs: 80,
      polls: 1,
      firstFreshAck: { elapsedMs: 120 },
      firstSettled: { elapsedMs: 120 },
    });
  });
  it('超过512 pulse明确截断，C4原标签保持', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await withRoutePulseDiagnostics('C4-return', [3, 0], 90_000, async (diagnostic) => {
      for (let index = 0; index < 513; index++) diagnostic!.begin(snapshot);
    });
    expect(log.mock.calls[0]![0]).toBe('Classic C4 route pulse diagnostic:');
    const report = JSON.parse(log.mock.calls[0]![1] as string);
    expect(report.pulseCount).toBe(513);
    expect(report.pulses).toHaveLength(512);
    expect(report.truncated).toBe(true);
  });
  it('正式benchmark旁路observer/log/Date.now而仍执行原callback一次', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '1');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const clock = vi.spyOn(Date, 'now');
    const value = Object.freeze({ untouched: true });
    const operation = vi.fn(async () => value);
    const route = vi.fn(async (diagnostic) => {
      expect(diagnostic).toBeUndefined();
      return value;
    });
    expect(await observeEquipmentOperation('mine:break', [0, 31, 0], operation)).toBe(value);
    expect(await withRoutePulseDiagnostics('V2-equipment', [3, 0], 45_000, route)).toBe(value);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });
});
