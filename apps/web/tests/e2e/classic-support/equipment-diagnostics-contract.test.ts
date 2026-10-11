import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeEquipmentOperation } from './equipment-operation-diagnostics';
import { withRoutePulseDiagnostics } from './route-pulse-diagnostics';
import type { ClassicSnapshot } from './harness-snapshot';
import type { TestInfo } from '@playwright/test';
import { configureClassicMainExecutionBudget, readClassicMainExecutionBudget } from './settings';
import { attachClassicEvidence } from './evidence';

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

function evidenceFixture(diagnosticOnly: boolean) {
  return {
    stages: Object.fromEntries(['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].map((stage) => [stage, { status: 'PASS' }])),
    pageErrors: [],
    failedResponses: [],
    stageSamples: {},
    benchmarkMode: false,
    artifact: { identity: {} },
    trace: { traceEvents: [] },
    scenario: { scenarioId: 'synthetic-unit-only', schemaVersion: 1 },
    mainExecutionBudget: { timeoutMs: diagnosticOnly ? 1_800_000 : 900_000, diagnosticOnly },
  } as unknown as Parameters<typeof attachClassicEvidence>[1];
}

describe('显式诊断执行窗口与验收资格', () => {
  it('实际诊断配置写入预算metadata，CI拒绝发生在任何配置和附件之前', async () => {
    vi.stubEnv('CI', undefined);
    vi.stubEnv('GITHUB_ACTIONS', undefined);
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', undefined);
    vi.stubEnv('SEEDLANDS_CLASSIC_DIAGNOSTIC_MAIN_BUDGET', '30m');
    const info = { setTimeout: vi.fn(), attach: vi.fn() };
    await expect(configureClassicMainExecutionBudget(info as unknown as TestInfo)).resolves.toEqual({
      timeoutMs: 1_800_000,
      diagnosticOnly: true,
    });
    expect(info.setTimeout).toHaveBeenCalledWith(1_800_000);
    expect(info.attach.mock.calls[0]![0]).toBe('classic-main-execution-budget.json');
    expect(JSON.parse(info.attach.mock.calls[0]![1].body)).toMatchObject({
      eligible: false,
      diagnosticOnly: true,
      canonicalTimeoutMs: 900_000,
    });
    info.setTimeout.mockClear();
    info.attach.mockClear();
    vi.stubEnv('CI', 'true');
    await expect(configureClassicMainExecutionBudget(info as unknown as TestInfo)).rejects.toThrow('disabled in CI');
    expect(info.setTimeout).not.toHaveBeenCalled();
    expect(info.attach).not.toHaveBeenCalled();
  });
  it('默认以及普通CI仍使用原900秒窗口', () => {
    expect(readClassicMainExecutionBudget({})).toEqual({ timeoutMs: 900_000, diagnosticOnly: false });
    expect(readClassicMainExecutionBudget({ CI: 'true' })).toEqual({ timeoutMs: 900_000, diagnosticOnly: false });
  });
  it('仅显式30m成为不可验收的扩展诊断', () => {
    expect(readClassicMainExecutionBudget({ SEEDLANDS_CLASSIC_DIAGNOSTIC_MAIN_BUDGET: '30m' })).toEqual({
      timeoutMs: 1_800_000,
      diagnosticOnly: true,
    });
  });
  it('CI和GitHub Actions拒绝扩展窗口', () => {
    for (const environment of [{ CI: 'true' }, { CI: '0' }, { GITHUB_ACTIONS: 'true' }])
      expect(() =>
        readClassicMainExecutionBudget({ ...environment, SEEDLANDS_CLASSIC_DIAGNOSTIC_MAIN_BUDGET: '30m' }),
      ).toThrow('disabled in CI');
  });
  it('benchmark拒绝扩展窗口', () => {
    expect(() =>
      readClassicMainExecutionBudget({
        SEEDLANDS_CLASSIC_DIAGNOSTIC_MAIN_BUDGET: '30m',
        SEEDLANDS_CLASSIC_BENCHMARK: '1',
      }),
    ).toThrow('benchmark');
  });
  it('未知参数值失败而不会创建任意长的窗口', () => {
    for (const value of ['', '29m', '1800000', 'infinity'])
      expect(() => readClassicMainExecutionBudget({ SEEDLANDS_CLASSIC_DIAGNOSTIC_MAIN_BUDGET: value })).toThrow(
        'Unsupported diagnostic',
      );
  });
  it('默认仍生成原标准证据namespace', async () => {
    const attach = vi.fn();
    const info = { attach, retry: 0, title: 'synthetic unit', project: { name: 'chromium' } } as unknown as TestInfo;
    await attachClassicEvidence(info, evidenceFixture(false));
    expect(attach.mock.calls[0]![0]).toBe('classic-runtime-evidence.json');
    expect(JSON.parse(attach.mock.calls[0]![1].body)).toMatchObject({ status: 'PASS' });
  });
  it('全部合成断言PASS仍只生成DIAGNOSTIC_ONLY，不能成为标准PASS', async () => {
    const attach = vi.fn();
    const info = { attach, retry: 0, title: 'synthetic unit', project: { name: 'chromium' } } as unknown as TestInfo;
    await attachClassicEvidence(info, evidenceFixture(true));
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]![0]).toBe('classic-diagnostic-runtime-evidence.json');
    expect(JSON.parse(attach.mock.calls[0]![1].body)).toMatchObject({
      status: 'DIAGNOSTIC_ONLY',
      assertionStatus: 'PASS',
      diagnosticOnly: true,
      eligible: false,
      mainExecutionBudget: { timeoutMs: 1_800_000, diagnosticOnly: true },
    });
  });
});

describe('V2 diagnostic callback and evidence boundaries', () => {
  it('时钟和body统计仅复制已有同次快照，后续源变化不改证据', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const authority = {
      ...snapshot.authority,
      physicsHz: 60,
      integratedPhysicsTimeMs: 1000,
      activeTimeMs: 1010,
      physicsDebtMs: 0,
      paused: false,
      bodies: { total: 1, actors: 0, worldItems: 0, nearPlayer: 0 },
    };
    await withRoutePulseDiagnostics('C4-return', [3, 0], 90_000, async (diagnostic) => {
      const current = { ...snapshot, authority };
      diagnostic!.begin(current);
      diagnostic!.observe(current, false);
      authority.integratedPhysicsTimeMs = 9000;
      authority.bodies.total = 2;
    });
    const observed = JSON.parse(log.mock.calls[0]![1] as string).pulses[0].lastObservation;
    expect(observed.physicsClock).toEqual({
      physicsHz: 60,
      integratedPhysicsTimeMs: 1000,
      activeTimeMs: 1010,
      physicsDebtMs: 0,
      paused: false,
    });
    expect(observed.bodyCounts).toEqual({ total: 1, actors: 0, worldItems: 0, nearPlayer: 0 });
  });
  it('缺失或非有限时钟/统计保持null而不是伪造零状态', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await withRoutePulseDiagnostics('C4-return', [3, 0], 90_000, async (diagnostic) => {
      diagnostic!.begin(snapshot);
      diagnostic!.observe(
        {
          ...snapshot,
          authority: { ...snapshot.authority, integratedPhysicsTimeMs: NaN, bodies: { total: Infinity } },
        } as unknown as ClassicSnapshot,
        false,
      );
    });
    const pulse = JSON.parse(log.mock.calls[0]![1] as string).pulses[0];
    expect(pulse.before.physicsClock).toEqual({
      physicsHz: null,
      integratedPhysicsTimeMs: null,
      activeTimeMs: null,
      physicsDebtMs: null,
      paused: null,
    });
    expect(pulse.before.bodyCounts).toBeNull();
    expect(pulse.lastObservation.physicsClock.integratedPhysicsTimeMs).toBeNull();
    expect(pulse.lastObservation.bodyCounts.total).toBeNull();
  });
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
  it('route诊断复制已有release观测，保留未消费ACK而不制造完成', async () => {
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const nativeMovementInput = {
      epoch: 'observed-session',
      release: { code: 'KeyW', sequence: 3, neutral: true },
    };
    await withRoutePulseDiagnostics('V2-equipment', [3, 0], 45_000, async (diagnostic) => {
      diagnostic!.begin(snapshot);
      diagnostic!.beforeInput(snapshot, 80, 'KeyW');
      diagnostic!.inputFinished('returned');
      diagnostic!.observe({ ...snapshot, nativeMovementInput }, false);
      nativeMovementInput.release.sequence = 100;
    });
    const pulse = JSON.parse(log.mock.calls[0]![1] as string).pulses[0];
    expect(pulse.before.nativeMovementInput).toBeNull();
    expect(pulse.lastObservation).toMatchObject({
      acknowledgedInputSequence: 1,
      nativeMovementInput: {
        epoch: 'observed-session',
        release: { code: 'KeyW', sequence: 3, neutral: true },
      },
    });
    expect(pulse.firstSettled).toBeUndefined();
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
