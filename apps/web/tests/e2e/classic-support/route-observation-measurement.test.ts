import type { Page, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HarnessRouteSnapshot } from '../../../src/app/gameplay/game-harness-route-observation';
import type { ClassicWindow } from './harness';
import { measureRouteObservation } from './route-observation-measurement';

type InputProbe = Readonly<{ id: string; eventCount: number; dispose(): void }>;

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
    afterRead?: (
      readIndex: number,
      state: { route: HarnessRouteSnapshot; full: Record<string, unknown> },
      windowTarget: EventTarget,
      documentTarget: EventTarget,
    ) => void;
    mismatch?: boolean;
    preexistingProbe?: InputProbe;
  } = {},
) {
  const state = {
    route: initialRoute(),
    full: {
      ...initialRoute(),
      worldRevision: 5,
      runtime: 'authority-worker',
      generatorVersion: 1,
      quality: 'low',
      renderPipeline: { backend: 'webgl2' },
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
  const windowTarget = new EventTarget() as EventTarget & {
    __seedlandsHarness?: unknown;
    __seedlandsRouteObservationInputProbe?: InputProbe;
  };
  const documentTarget = new EventTarget();
  windowTarget.__seedlandsHarness = harness;
  if (options.preexistingProbe) windowTarget.__seedlandsRouteObservationInputProbe = options.preexistingProbe;
  vi.stubGlobal('window', windowTarget as unknown as ClassicWindow);
  vi.stubGlobal('document', documentTarget);
  const trackedProbes: InputProbe[] = [];
  const evaluate = vi.fn(async (callback: (argument?: unknown) => unknown, argument?: unknown) => {
    const result = structuredClone(callback(argument));
    const probe = windowTarget.__seedlandsRouteObservationInputProbe;
    if (probe && !trackedProbes.includes(probe)) trackedProbes.push(probe);
    if (argument && typeof argument === 'object' && 'arm' in argument) {
      state.reads += 1;
      options.afterRead?.(state.reads, state, windowTarget, documentTarget);
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
    retry: 0,
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
  return {
    page,
    testInfo,
    attachments,
    evaluate,
    harness,
    state,
    windowTarget,
    documentTarget,
    trackedProbes,
    inputEvents,
    readIndex: () => readIndex,
  };
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

function expectOwnProbeDisposed(test: ReturnType<typeof fixture>) {
  const probe = test.trackedProbes[0]!;
  expect(test.windowTarget.__seedlandsRouteObservationInputProbe).toBeUndefined();
  const eventCount = probe.eventCount;
  test.windowTarget.dispatchEvent(new Event('keydown'));
  test.documentTarget.dispatchEvent(new Event('pointerlockchange'));
  expect(probe.eventCount).toBe(eventCount);
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
    expect(attached.samples).toMatchObject([
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

  it('allows physics tick and acknowledgement to advance between samples when pose, world and DOM input are fixed', async () => {
    enableMeasurement();
    const test = fixture({
      afterRead: (_readIndex, state) => {
        const authority = {
          physicsTick: state.route.authority.physicsTick + 1,
          acknowledgedInputSequence: state.route.authority.acknowledgedInputSequence + 1,
        };
        state.route = { ...state.route, authority };
        state.full.authority = authority;
      },
    });
    const result = await measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' });
    expect(result).toMatchObject({ status: 'PASS', improvementPercent: 30 });
    expect(test.inputEvents).toEqual([]);
    const samples = result!.samples as readonly {
      physicsTick: number;
      acknowledgedInputSequence: number;
      inputEventCount: number;
      fixedOwner: string;
    }[];
    expect(samples).toHaveLength(36);
    expect(samples.every((sample) => sample.inputEventCount === 0)).toBe(true);
    expect(samples.every((sample, index) => index === 0 || sample.physicsTick >= samples[index - 1]!.physicsTick)).toBe(
      true,
    );
    expect(
      samples.every(
        (sample, index) =>
          index === 0 || sample.acknowledgedInputSequence >= samples[index - 1]!.acknowledgedInputSequence,
      ),
    ).toBe(true);
    expect(JSON.parse(samples[0]!.fixedOwner)).toMatchObject({
      worldRevision: 5,
      runtime: 'authority-worker',
      generatorVersion: 1,
      quality: 'low',
      renderPipeline: { backend: 'webgl2' },
    });
    expect(test.attachments).toHaveLength(1);
    const probe = test.trackedProbes[0]!;
    expect(probe.id).toBe('measurement-fixture:0:route-observation');
    expectOwnProbeDisposed(test);
  });

  it.each([
    ['window', 'keydown'],
    ['window', 'keyup'],
    ['window', 'pointerdown'],
    ['window', 'pointerup'],
    ['window', 'pointermove'],
    ['window', 'mousemove'],
    ['window', 'wheel'],
    ['window', 'blur'],
    ['window', 'focus'],
    ['document', 'pointerlockchange'],
  ] as const)('rejects %s %s with unchanged route pose and world, then cleans the probe', async (targetName, type) => {
    enableMeasurement();
    const test = fixture({
      afterRead: (readIndex, _state, windowTarget, documentTarget) => {
        if (readIndex === 1) {
          const event = new Event(type, { cancelable: true });
          (targetName === 'window' ? windowTarget : documentTarget).dispatchEvent(event);
          expect(event.defaultPrevented).toBe(false);
        }
      },
    });
    await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow();
    expect(test.attachments).toHaveLength(1);
    const attached = JSON.parse(test.attachments[0]!.body);
    expect(attached).toMatchObject({ status: 'FAIL', samples: expect.any(Array) });
    expect(attached.samples[0]).toMatchObject({ physicsTick: 12, acknowledgedInputSequence: 9, inputEventCount: 0 });
    const probe = test.trackedProbes[0]!;
    expect(probe.eventCount).toBe(1);
    expectOwnProbeDisposed(test);
  });

  it('refuses to replace or dispose a probe owned by another measurement', async () => {
    enableMeasurement();
    const foreignProbe: InputProbe = { id: 'another-run', eventCount: 0, dispose: vi.fn() };
    const test = fixture({ preexistingProbe: foreignProbe });
    await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow();
    expect(test.windowTarget.__seedlandsRouteObservationInputProbe).toBe(foreignProbe);
    expect(foreignProbe.dispose).not.toHaveBeenCalled();
  });

  it.each([
    [
      'physics tick',
      (route: HarnessRouteSnapshot) => ({
        ...route,
        authority: { ...route.authority, physicsTick: route.authority.physicsTick - 1 },
      }),
    ],
    [
      'input acknowledgement',
      (route: HarnessRouteSnapshot) => ({
        ...route,
        authority: { ...route.authority, acknowledgedInputSequence: route.authority.acknowledgedInputSequence - 1 },
      }),
    ],
  ] as const)('rejects backwards %s and cleans its probe', async (_field, regress) => {
    enableMeasurement();
    const test = fixture({
      afterRead: (readIndex, state) => {
        if (readIndex === 1) {
          state.route = regress(state.route);
          state.full.authority = state.route.authority;
        }
      },
    });
    await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow();
    expect(test.attachments).toHaveLength(1);
    expectOwnProbeDisposed(test);
  });

  it.each([
    [
      'world revision',
      (state: { route: HarnessRouteSnapshot; full: Record<string, unknown> }) => {
        state.full.worldRevision = 6;
      },
    ],
    [
      'runtime identity',
      (state: { route: HarnessRouteSnapshot; full: Record<string, unknown> }) => {
        state.full.runtime = 'other-runtime';
      },
    ],
    [
      'generator version',
      (state: { route: HarnessRouteSnapshot; full: Record<string, unknown> }) => {
        state.full.generatorVersion = 2;
      },
    ],
    [
      'quality profile',
      (state: { route: HarnessRouteSnapshot; full: Record<string, unknown> }) => {
        state.full.quality = 'high';
      },
    ],
    [
      'render backend',
      (state: { route: HarnessRouteSnapshot; full: Record<string, unknown> }) => {
        state.full.renderPipeline = { backend: 'webgpu' };
      },
    ],
    [
      'requested worker configuration',
      (state: { route: HarnessRouteSnapshot; full: Record<string, unknown> }) => {
        state.full.experiments = { requested: { wasm: true }, workers: [] };
      },
    ],
    [
      'worker counts',
      (state: { route: HarnessRouteSnapshot; full: Record<string, unknown> }) => {
        state.full.workers = { authority: 2, logic: 1 };
      },
    ],
  ] as const)('rejects a changed %s and cleans its probe', async (_field, mutate) => {
    enableMeasurement();
    const test = fixture({
      afterRead: (readIndex, state) => {
        if (readIndex === 1) mutate(state);
      },
    });
    await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow();
    expect(test.attachments).toHaveLength(1);
    expectOwnProbeDisposed(test);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid elapsed duration %s and cleans its probe',
    async (duration) => {
      enableMeasurement();
      const test = fixture({ duration: () => duration });
      await expect(measureRouteObservation(test.page, test.testInfo, { artifact: 'fixed' })).rejects.toThrow(
        'Route observation elapsed time is invalid.',
      );
      expect(test.attachments).toHaveLength(1);
      expectOwnProbeDisposed(test);
    },
  );

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
