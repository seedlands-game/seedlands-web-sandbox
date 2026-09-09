import { describe, expect, it } from 'vitest';
import { definePack, type ModModule, type ModSystemDefinition } from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createModuleLifecycle,
  type ModuleScheduleSnapshot,
} from '@seedlands/game-core/server/composition/host-api';

type Call = Readonly<{ operationId: string; seconds?: number; systemId: string }>;

function setup(
  options: Readonly<{
    cycle?: boolean;
    intervalSeconds?: number;
    onInvoke?: (operationId: string) => void;
  }> = {},
) {
  const calls: Call[] = [];
  const module: ModModule = {
    descriptor: { id: 'test:module', version: '1.0.0', resources: [{ id: 'test.clock', operations: ['execute'] }] },
    register(api) {
      for (const id of ['start', 'stop', 'interval', 'every'])
        api.registerOperation({ id: `test:${id}`, resource: 'test.clock', executionKind: 'system', run: () => null });
      api.registerLifecycle({ startOperationId: 'test:start', stopOperationId: 'test:stop' });
      api.registerSystem({
        id: 'test:interval',
        operationId: 'test:interval',
        after: ['test:every'],
        intervalSeconds: options.intervalSeconds ?? 1,
      });
      api.registerSystem({
        id: 'test:every',
        operationId: 'test:every',
        cadence: 'every-advance',
        after: options.cycle ? ['test:interval'] : [],
      });
    },
  };
  const pack = definePack({ id: 'test:playbook', version: '1.0.0', kind: 'playbook', modules: [module] });
  const composition = assembleWorldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
  const lifecycle = createModuleLifecycle({
    composition,
    invoke: (_moduleId, request, systemId) => {
      const seconds = (request.input as Readonly<{ seconds?: number }> | undefined)?.seconds;
      calls.push({ operationId: request.operationId, ...(seconds === undefined ? {} : { seconds }), systemId });
      options.onInvoke?.(request.operationId);
      return { ok: true, value: null, revision: calls.length };
    },
  });
  return { lifecycle, calls, composition };
}

const validSnapshot = (): ModuleScheduleSnapshot => ({
  version: 1,
  time: 0.4,
  systems: [
    { id: 'test:every', remainder: 0 },
    { id: 'test:interval', remainder: 0.4 },
  ],
});

describe('single logical module lifecycle clock', () => {
  it('activates fresh, runs every-advance with actual deltas and preserves interval order', () => {
    const { lifecycle, calls } = setup();
    expect(calls).toEqual([]);
    expect(() => lifecycle.advance(0.4)).toThrow(/not running/i);

    lifecycle.activateFresh();
    lifecycle.advance(0);
    lifecycle.advance(0.4);
    lifecycle.advance(0.6);

    expect(calls).toEqual([
      { operationId: 'test:start', systemId: 'test:module/lifecycle' },
      { operationId: 'test:every', seconds: 0.4, systemId: 'test:every' },
      { operationId: 'test:every', seconds: 0.6, systemId: 'test:every' },
      { operationId: 'test:interval', seconds: 1, systemId: 'test:interval' },
    ]);
    expect(lifecycle.time).toBe(1);
    expect(lifecycle.snapshot()).toEqual({
      version: 1,
      time: 1,
      systems: [
        { id: 'test:every', remainder: 0 },
        { id: 'test:interval', remainder: 0 },
      ],
    });
    lifecycle.dispose();
    lifecycle.dispose();
    expect(calls.filter(({ operationId }) => operationId === 'test:stop')).toHaveLength(1);
  });

  it('resumes a complete schedule without start effects and stops the resumed lifecycle once', () => {
    const first = setup();
    first.lifecycle.activateFresh();
    first.lifecycle.advance(0.4);

    const resumed = setup();
    resumed.lifecycle.resume(first.lifecycle.snapshot());
    expect(resumed.calls).toEqual([]);
    expect(resumed.lifecycle.time).toBe(0.4);
    resumed.lifecycle.advance(0.6);
    expect(resumed.calls).toEqual([
      { operationId: 'test:every', seconds: 0.6, systemId: 'test:every' },
      { operationId: 'test:interval', seconds: 1, systemId: 'test:interval' },
    ]);
    resumed.lifecycle.dispose();
    resumed.lifecycle.dispose();
    expect(resumed.calls.at(-1)).toEqual({ operationId: 'test:stop', systemId: 'test:module/lifecycle' });
    expect(resumed.calls.filter(({ operationId }) => operationId === 'test:stop')).toHaveLength(1);
  });

  it('atomically rejects malformed resume snapshots and preserves a running restore schedule', () => {
    const sparseSystems = Array<ModuleScheduleSnapshot['systems'][number]>(2);
    sparseSystems[0] = { id: 'test:every', remainder: 0 };
    const invalid: unknown[] = [
      { ...validSnapshot(), extra: true },
      { ...validSnapshot(), systems: sparseSystems },
      { ...validSnapshot(), systems: [validSnapshot().systems[0], validSnapshot().systems[0]] },
      { ...validSnapshot(), systems: [{ id: 'test:unknown', remainder: 0 }, validSnapshot().systems[1]] },
      { ...validSnapshot(), systems: [...validSnapshot().systems].reverse() },
      {
        ...validSnapshot(),
        systems: [{ id: 'test:every', remainder: 0, extra: true }, validSnapshot().systems[1]],
      },
      { ...validSnapshot(), systems: [{ id: 'test:every', remainder: 0.1 }, validSnapshot().systems[1]] },
      { ...validSnapshot(), systems: [validSnapshot().systems[0], { id: 'test:interval', remainder: 1 }] },
      { ...validSnapshot(), time: 0.4000000001 },
    ];
    const resumed = setup();
    for (const snapshot of invalid)
      expect(() => resumed.lifecycle.resume(snapshot as ModuleScheduleSnapshot)).toThrow(/schedule/i);
    expect(resumed.calls).toEqual([]);
    resumed.lifecycle.resume(validSnapshot());
    expect(resumed.lifecycle.snapshot()).toEqual(validSnapshot());

    const running = setup();
    running.lifecycle.activateFresh();
    running.lifecycle.advance(0.25);
    const before = running.lifecycle.snapshot();
    expect(() => running.lifecycle.restore({ ...before, systems: [] })).toThrow(/schedule/i);
    expect(running.lifecycle.snapshot()).toEqual(before);
  });

  it('rejects invalid advances and excessive catch-up before schedule mutation or operations', () => {
    const { lifecycle, calls } = setup();
    lifecycle.activateFresh();
    const before = lifecycle.snapshot();
    for (const seconds of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e-12, 10_000_000])
      expect(() => lifecycle.advance(seconds)).toThrow(/advance/i);
    expect(() => lifecycle.advance(300)).toThrow(/budget/i);
    expect(lifecycle.snapshot()).toEqual(before);
    expect(calls).toEqual([{ operationId: 'test:start', systemId: 'test:module/lifecycle' }]);
  });

  it('validates without effects and rejects accessors without executing their getters', () => {
    const { lifecycle, calls } = setup();
    expect(lifecycle.validate(validSnapshot())).toBeUndefined();
    expect(calls).toEqual([]);

    let getterCalls = 0;
    const rootAccessor = { version: 1, systems: validSnapshot().systems } as Record<string, unknown>;
    Object.defineProperty(rootAccessor, 'time', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 0.4;
      },
    });
    const arrayAccessor = [...validSnapshot().systems];
    Object.defineProperty(arrayAccessor, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return validSnapshot().systems[0];
      },
    });
    const entryAccessor = { id: 'test:every' } as Record<string, unknown>;
    Object.defineProperty(entryAccessor, 'remainder', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 0;
      },
    });
    const accessorSnapshots = [
      rootAccessor,
      { ...validSnapshot(), systems: arrayAccessor },
      { ...validSnapshot(), systems: [entryAccessor, validSnapshot().systems[1]] },
    ];
    for (const snapshot of accessorSnapshots)
      expect(() => lifecycle.validate(snapshot as ModuleScheduleSnapshot)).toThrow(/schedule|accessor/i);
    expect(getterCalls).toBe(0);
    expect(calls).toEqual([]);

    lifecycle.resume(validSnapshot());
    expect(lifecycle.snapshot()).toEqual(validSnapshot());
  });

  it('passes the canonical clock delta to every-advance systems for fractional input', () => {
    const { lifecycle, calls } = setup();
    lifecycle.activateFresh();
    lifecycle.advance(1 / 3);
    expect(lifecycle.time).toBe(0.333333333);
    expect(calls.at(-1)).toEqual({
      operationId: 'test:every',
      seconds: lifecycle.time,
      systemId: 'test:every',
    });
  });

  it('forbids operation reentry and rejects dependency cycles before lifecycle construction', () => {
    const errors: string[] = [];
    const current = setup({
      onInvoke(operationId) {
        if (operationId !== 'test:every') return;
        for (const action of [
          () => lifecycle.advance(0.1),
          () => lifecycle.snapshot(),
          () => lifecycle.time,
          () => lifecycle.dispose(),
        ]) {
          try {
            action();
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      },
    });
    const lifecycle = current.lifecycle;
    lifecycle.activateFresh();
    lifecycle.advance(0.1);
    expect(errors).toHaveLength(4);
    expect(errors.every((message) => /reentry/i.test(message))).toBe(true);
    expect(() => setup({ cycle: true })).toThrow(/cycle/i);
  });

  it('keeps start and running restore compatibility while validating cadence definitions', () => {
    const compatible = setup();
    compatible.lifecycle.start();
    compatible.lifecycle.restore(validSnapshot());
    expect(compatible.lifecycle.time).toBe(0.4);

    const invalidDefinitions: ModSystemDefinition[] = [
      {
        id: 'test:x',
        operationId: 'test:x',
        cadence: 'every-advance',
        intervalSeconds: 1,
      } as unknown as ModSystemDefinition,
      { id: 'test:x', operationId: 'test:x', cadence: 'interval' } as unknown as ModSystemDefinition,
      { id: 'test:x', operationId: 'test:x', cadence: 'sometimes' } as unknown as ModSystemDefinition,
    ];
    for (const definition of invalidDefinitions) {
      const module: ModModule = {
        descriptor: { id: 'test:invalid', version: '1.0.0' },
        register(api) {
          api.registerOperation({ id: 'test:x', resource: 'world.entity', executionKind: 'system', run: () => null });
          api.registerSystem(definition);
        },
      };
      const pack = definePack({ id: 'test:invalid-pack', version: '1.0.0', kind: 'playbook', modules: [module] });
      expect(() =>
        assembleWorldPacks([
          {
            ...pack,
            integrity: {
              algorithm: 'sha256',
              manifestDigest: 'a'.repeat(64),
              entryDigest: 'b'.repeat(64),
              resources: [],
            },
          },
        ]),
      ).toThrow(/cadence|interval/i);
    }
  });
});
