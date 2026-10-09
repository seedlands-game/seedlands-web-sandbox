import type { Page, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HarnessRouteSnapshot } from '../../../src/app/gameplay/game-harness-route-observation';
import type { ClassicWindow } from './harness';
import { measureRouteObservation } from './route-observation-measurement';

const initialRoute = (): HarnessRouteSnapshot => ({
  player: [10, 32.6, 10],
  serverPlayerPosition: [10, 32.6, 10],
  serverPlayerVelocity: [0, 0, 0],
  viewAngles: [90, -16],
  onGround: true,
  colliding: false,
  authority: { physicsTick: 12, acknowledgedInputSequence: 9 },
});

function fixture(
  options: {
    duration?: (arm: 'A' | 'B', index: number) => number;
    afterRead?: (readIndex: number, state: { route: HarnessRouteSnapshot; full: Record<string, unknown> }) => void;
    mismatch?: boolean;
  } = {},
) {
  const state = {
    route: initialRoute(),
    full: {
      ...initialRoute(),
      worldRevision: 5,
      runtime: 'authority-worker',
      generatorVersion: 1,
      experiments: { requested: {}, workers: [] },
      workers: { authority: 1, logic: 1 },
    } as Record<string, unknown>,
    reads: 0,
  };
  const harness = {
    snapshot: vi.fn(() => state.full),
    routeSnapshot: vi.fn(() =>
      options.mismatch ? { ...state.route, player: [10.001, 32.6, 10] as const } : state.route,
    ),
  };
  vi.stubGlobal('window', { __seedlandsHarness: harness } as unknown as ClassicWindow);
  const evaluate = vi.fn(async (callback: (argument?: unknown) => unknown, argument?: unknown) => {
    const result = callback(argument);
    if (String(callback).includes('Same-task route owner projection differs.')) {
      state.reads += 1;
      options.afterRead?.(state.reads, state);
    }
    return result;
  });
  const inputEvents: string[] = [];
  const page = {
    evaluate,
    keyboard: {
      down: vi.fn(async (key: string) => {
        inputEvents.push(`down:${key}`);
      }),
      up: vi.fn(async (key: string) => {
        inputEvents.push(`up:${key}`);
      }),
    },
    mouse: {
      move: vi.fn(async () => {
        inputEvents.push('mouse');
      }),
    },
  } as unknown as Page;
  const attachments: Array<{ name: string; body: string }> = [];
  const testInfo = {
    attach: vi.fn(async (name: string, data: { body: string }) => attachments.push({ name, body: data.body })),
  } as unknown as TestInfo;

  let clock = 100;
  let activeDuration = 0;
  let readIndex = 0;
  let awaitingEnd = false;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    if (!awaitingEnd) {
      const arm = readIndex < 4 ? (readIndex % 2 ? 'B' : 'A') : readIndex < 20 ? 'A' : abOrder(readIndex - 20);
      activeDuration = options.duration?.(arm, readIndex) ?? (arm === 'A' ? 10 : 7);
      awaitingEnd = true;
      return clock;
    }
    awaitingEnd = false;
    readIndex += 1;
    clock += activeDuration;
    return clock;
  });
  return { page, testInfo, attachments, evaluate, harness, state, inputEvents, readIndex: () => readIndex };
}

function abOrder(index: number): 'A' | 'B' {
  const orders = [
    ['A', 'B', 'B', 'A'],
    ['B', 'A', 'A', 'B'],
    ['A', 'B', 'B', 'A'],
    ['B', 'A', 'A', 'B'],
  ] as const;
  return orders[Math.floor(index / 4)]?.[index % 4] ?? 'A';
}

function enableMeasurement() {
  vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '1');
  vi.stubEnv('SEEDLANDS_ROUTE_OBSERVATION_AB', '1');
  vi.stubEnv('SEEDLANDS_PERFORMANCE_WINDOW_RESERVED', '1');
  vi.stubEnv('SEEDLANDS_HARNESS_RUN_ID', 'measurement-fixture');
  vi.stubEnv('SEEDLANDS_SOURCE_SHA', 'fixture-source');
  vi.stubEnv('SEEDLANDS_PERFORMANCE_WINDOW_ID', 'fixture-window');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('route observation measurement contract', () => {
  it('does no sampling when the measurement environment is not enabled', async () => {
    const test = fixture();
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '0');
    expect(await measureRouteObservation(test.page, test.testInfo, { source: 'fixture' })).toBeUndefined();
    expect(test.evaluate).not.toHaveBeenCalled();
    expect(test.testInfo.attach).not.toHaveBeenCalled();
    expect(test.inputEvents).toEqual([]);
    expect(test.readIndex()).toBe(0);
  });

  it('rejects an unreserved performance window before sampling', async () => {
    const test = fixture();
    vi.stubEnv('SEEDLANDS_CLASSIC_BENCHMARK', '1');
    vi.stubEnv('SEEDLANDS_ROUTE_OBSERVATION_AB', '1');
    vi.stubEnv('SEEDLANDS_PERFORMANCE_WINDOW_RESERVED', '0');
    await expect(measureRouteObservation(test.page, test.testInfo, { source: 'fixture' })).rejects.toThrow(
      'Route observation measurement requires the performance window.',
    );
    expect(test.evaluate).not.toHaveBeenCalled();
    expect(test.attachments).toHaveLength(0); // reservation guard runs before sample/attachment setup
  });

  it('rejects a non-positive elapsed value and retains the raw failed sample', async () => {
    enableMeasurement();
    const test = fixture({ duration: () => 0 });
    await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow(
      'Route observation elapsed time is invalid.',
    );
    const attached = JSON.parse(test.attachments[0]!.body);
    expect(attached.status).toBe('FAIL');
    expect(attached.samples).toEqual([
      { phase: 'warmup', pair: 0, arm: 'A', elapsedMs: 0, logicalJsonBytes: expect.any(Number) },
    ]);
  });

  it('rejects unequal same-task owner projections and retains attachment', async () => {
    enableMeasurement();
    const test = fixture({ mismatch: true });
    await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow(
      'Same-task route owner projection differs.',
    );
    expect(test.attachments).toHaveLength(1);
    expect(JSON.parse(test.attachments[0]!.body)).toMatchObject({
      status: 'FAIL',
      error: 'Same-task route owner projection differs.',
    });
    expect(test.readIndex()).toBe(0);
  });

  it('rejects owner changes across samples even when each same-task projection agrees', async () => {
    enableMeasurement();
    const test = fixture({
      afterRead: (readIndex, state) => {
        if (readIndex === 1) {
          state.route = { ...state.route, player: [10.1, 32.6, 10] as const };
          state.full.player = state.route.player;
        }
      },
    });
    await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow(
      'Input, pose or world identity changed within the measurement window.',
    );
    expect(test.attachments).toHaveLength(1);
    expect(JSON.parse(test.attachments[0]!.body)).toMatchObject({
      status: 'FAIL',
      error: 'Input, pose or world identity changed within the measurement window.',
      samples: expect.any(Array),
    });
    expect(test.readIndex()).toBe(2);
  });

  it('stops after A/A noise exceeds 15 percent and records no AB samples', async () => {
    enableMeasurement();
    const test = fixture({ duration: (_arm, index) => (index >= 4 && index % 2 === 1 ? 12 : 10) });
    await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow(
      'Route observation A/A exceeds the registered 15% noise veto.',
    );
    const attached = JSON.parse(test.attachments[0]!.body);
    expect(attached).toMatchObject({ status: 'FAIL', reason: 'A/A noise veto' });
    expect(attached.samples).toHaveLength(20); // 4 warmups + 16 A/A reads; AB never begins
    expect(attached.samples.every((sample: { phase: string }) => sample.phase !== 'ab')).toBe(true);
    expect(attached.samples.every((sample: { logicalJsonBytes: number }) => sample.logicalJsonBytes > 0)).toBe(true);
    expect(attached.bytes).toContain('logical UTF-8 JSON');
  });

  it.each([
    ['balanced 30% improvement', 7, 'PASS'],
    ['sub-threshold 15% improvement', 8.5, 'FAIL'],
  ] as const)('enforces 8-pair ABBA/BAAB threshold for %s', async (_name, bDuration, expectedStatus) => {
    enableMeasurement();
    const test = fixture({ duration: (arm, index) => (index < 20 ? 10 : arm === 'A' ? 10 : bDuration) });
    if (expectedStatus === 'PASS') {
      const result = await measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' });
      expect(result).toMatchObject({ status: 'PASS', improvementPercent: 30, samples: expect.any(Array) });
      const samples = result!.samples as readonly {
        phase: string;
        arm: string;
        pair: number;
        logicalJsonBytes: number;
      }[];
      expect(samples).toHaveLength(36);
      expect(samples.filter((sample) => sample.phase === 'aa')).toHaveLength(16);
      expect(samples.filter((sample) => sample.phase === 'ab' && sample.arm === 'A')).toHaveLength(8);
      expect(samples.filter((sample) => sample.phase === 'ab' && sample.arm === 'B')).toHaveLength(8);
      expect(samples.filter((sample) => sample.phase === 'ab').map((sample) => sample.arm)).toEqual([
        'A',
        'B',
        'B',
        'A',
        'B',
        'A',
        'A',
        'B',
        'A',
        'B',
        'B',
        'A',
        'B',
        'A',
        'A',
        'B',
      ]);
      expect(samples.every((sample) => sample.logicalJsonBytes > 0)).toBe(true);
      expect(test.attachments).toHaveLength(1);
      expect(JSON.parse(test.attachments[0]!.body)).toMatchObject({
        status: 'PASS',
        windowId: 'fixture-window',
        sourceSha: 'fixture-source',
      });
    } else {
      await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow(
        'Route observation improvement is below the registered 20% threshold.',
      );
      expect(JSON.parse(test.attachments[0]!.body)).toMatchObject({ status: 'FAIL', improvementPercent: 15 });
    }
    expect(test.readIndex()).toBe(36);
  });
});
