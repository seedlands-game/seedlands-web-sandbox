import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack as overworld } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { testCorePlatform } from '../../support/core-platform';

function setup(allow = true) {
  const calls: string[] = [];
  const module: ModModule = {
    descriptor: {
      id: 'test:schedule',
      version: '1.0.0',
      resources: [{ id: 'test.schedule', operations: ['execute'] }],
      permissions: [{ resource: 'test.schedule', operations: ['execute'] }],
    },
    register(api) {
      for (const id of ['start', 'stop', 'tick'])
        api.registerOperation({
          id: `test:${id}`,
          executionKind: 'system',
          resource: 'test.schedule',
          run(context) {
            expect(context.kind).toBe('system');
            calls.push(id);
            return null;
          },
        });
      api.registerLifecycle({ startOperationId: 'test:start', stopOperationId: 'test:stop' });
      api.registerSystem({ id: 'test:interval', operationId: 'test:tick', intervalSeconds: 1 });
    },
  };
  const pack = definePack({
    id: 'test:playbook',
    kind: 'playbook',
    version: '1.0.0',
    modules: [
      ...overworld.modules.filter(
        (entry) =>
          ![
            'seedlands:station-actions-module',
            'seedlands:forage-module',
            'seedlands:feeding-actions-module',
            'seedlands:overworld-feeding-rules',
            'seedlands:needs-module',
            'seedlands:overworld-needs-rules',
            'seedlands:behavior-registry-module',
            'seedlands:combat-module',
            'seedlands:overworld-combat-rules',
            'seedlands:block-actions-module',
            'seedlands:overworld-block-rules',
          ].includes(entry.descriptor.id),
      ),
      module,
    ],
  });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    {
      approvedPermissions: {
        'test:playbook': [
          { resource: 'test.schedule', operations: ['execute'] },
          { resource: 'seedlands.inventory', operations: ['read', 'write', 'execute'] },
          { resource: 'seedlands.inventory-item', operations: ['read', 'execute'] },
          { resource: 'seedlands.mode', operations: ['read', 'write', 'execute'] },
          { resource: 'seedlands.ruleset', operations: ['read'] },
        ],
      },
    },
  );
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'host-clock', kind: 'system' }],
      rules: allow ? [{ effect: 'allow', resources: ['test.schedule'], operations: ['execute'] }] : [],
    },
    composition.resources,
  );
  const gameplay = new GameplayRuntime({
    composition,
    moduleSystemAuthority: { authorizer, principalId: 'host-clock' },
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
  });
  return { gameplay, calls };
}

describe('real gameplay registered schedule frontier', () => {
  it('resumes the same logical frontier without running startup again', () => {
    const first = setup();
    expect(first.calls).toEqual([]);
    first.gameplay.advanceRules(0.4);
    const saved = first.gameplay.createSnapshot();
    expect(saved.moduleSchedule).toEqual({ version: 1, time: 0.4, systems: [{ id: 'test:interval', remainder: 0.4 }] });
    expect(first.calls).toEqual(['start']);
    const restored = setup();
    restored.gameplay.restoreSnapshot(saved);
    expect(restored.calls).toEqual([]);
    restored.gameplay.advanceRules(0.6);
    expect(restored.calls).toEqual(['tick']);
    expect(restored.gameplay.gameplayTime).toBe(1);
    expect(restored.gameplay.createSnapshot().moduleSchedule?.time).toBe(1);
    restored.gameplay.dispose();
    restored.gameplay.dispose();
    expect(restored.calls).toEqual(['tick', 'stop']);
    first.gameplay.dispose();
  });
  it('rejects missing or divergent schedules before installing entity state', () => {
    const { gameplay } = setup();
    gameplay.spawnPlayer({ id: 'alice', position: [0, 0, 0] });
    gameplay.advanceRules(0.4);
    const before = gameplay.createSnapshot();
    for (const schedule of [undefined, { ...before.moduleSchedule!, time: 0.5 }]) {
      const bad = structuredClone(before);
      bad.moduleSchedule = schedule;
      expect(() => gameplay.restoreSnapshot(bad)).toThrow(/schedule/i);
      expect(gameplay.createSnapshot()).toEqual(before);
    }
    gameplay.dispose();
  });
  it('does not repeat start when restoring an already active host', () => {
    const { gameplay, calls } = setup();
    gameplay.advanceRules(0.4);
    const saved = gameplay.createSnapshot();
    gameplay.advanceRules(0.6);
    gameplay.restoreSnapshot(saved);
    gameplay.advanceRules(0.6);
    expect(calls).toEqual(['start', 'tick', 'tick']);
    gameplay.dispose();
  });
  it('does not borrow player permissions when the host denies scheduled operations', () => {
    const { gameplay, calls } = setup(false);
    expect(() => gameplay.advanceRules(0.4)).toThrow(/denied/i);
    expect(calls).toEqual([]);
    gameplay.dispose();
  });
});
