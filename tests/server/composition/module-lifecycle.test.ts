import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, createModuleLifecycle } from '@seedlands/game-core/server/composition/host-api';

function setup(cycle = false) {
  const calls: string[] = [];
  const module: ModModule = {
    descriptor: { id: 'test:module', version: '1.0.0', resources: [{ id: 'test.clock', operations: ['execute'] }] },
    register(api) {
      for (const id of ['start', 'stop', 'a', 'b'])
        api.registerOperation({ id: `test:${id}`, resource: 'test.clock', run: () => null });
      api.registerLifecycle({ startOperationId: 'test:start', stopOperationId: 'test:stop' });
      api.registerSystem({ id: 'test:a', operationId: 'test:a', after: ['test:b'], intervalSeconds: 0.5 });
      api.registerSystem({ id: 'test:b', operationId: 'test:b', after: cycle ? ['test:a'] : [], intervalSeconds: 0.5 });
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
    invoke: (moduleId, request) => {
      calls.push(`${moduleId}/${request.operationId}`);
      return { ok: true, value: null, revision: calls.length };
    },
  });
  return { lifecycle, calls, composition };
}

describe('explicit module lifecycle and logical schedule', () => {
  it('does not start on import/assembly, orders systems and disposes exactly once', () => {
    const { lifecycle, calls } = setup();
    expect(calls).toEqual([]);
    expect(() => lifecycle.advance(0.5)).toThrow(/not running/i);
    lifecycle.start();
    lifecycle.advance(0.2);
    lifecycle.advance(0.3);
    expect(calls).toEqual(['test:module/test:start', 'test:module/test:b', 'test:module/test:a']);
    lifecycle.dispose();
    lifecycle.dispose();
    expect(calls.at(-1)).toBe('test:module/test:stop');
    expect(calls.filter((v) => v.endsWith('test:stop'))).toHaveLength(1);
    expect(() => lifecycle.start()).toThrow(/disposed/i);
  });

  it('rejects cycles before state construction and excessive catch-up before any operation', () => {
    expect(() => setup(true)).toThrow(/cycle/i);
    const { lifecycle, calls } = setup();
    lifecycle.start();
    const before = lifecycle.snapshot();
    expect(() => lifecycle.advance(10000)).toThrow(/budget/i);
    expect(lifecycle.snapshot()).toEqual(before);
    expect(calls).toHaveLength(1);
  });

  it('restores the logical remainder without restarting or skipping the next tick', () => {
    const first = setup();
    first.lifecycle.start();
    first.lifecycle.advance(0.3);
    const second = setup();
    second.lifecycle.start();
    second.lifecycle.restore(first.lifecycle.snapshot());
    second.lifecycle.advance(0.2);
    expect(second.calls.slice(1)).toEqual(['test:module/test:b', 'test:module/test:a']);
    const before = second.lifecycle.snapshot();
    expect(() => second.lifecycle.restore({ ...before, systems: [] })).toThrow(/schedule/i);
    expect(second.lifecycle.snapshot()).toEqual(before);
  });
});
