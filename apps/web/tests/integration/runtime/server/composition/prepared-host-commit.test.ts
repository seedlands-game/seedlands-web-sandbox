import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks, type RegisteredStatePort } from '@seedlands/stdlib/host';
import { GameplayModuleRuntime } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/gameplay-module-runtime';
import { EntityStore } from '../../../../../../../packages/stdlib/src/server/gameplay/entity-store';
import { WorldResourceAuthorizer } from '../../../../../../../packages/stdlib/src/server/harness/world-authorization';
import { RULESET_COMPONENT } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/ruleset-module';

function setup(staleRuleset = false) {
  const actorAddress = { componentId: 'seedlands:inventory', target: { kind: 'entity' as const, entityId: 'alice' } };
  const rulesetAddress = { componentId: RULESET_COMPONENT, target: { kind: 'world' as const } };
  const module: ModModule = {
    descriptor: {
      id: 'test:prepared',
      version: '1.0.0',
      resources: [{ id: 'test.prepared', operations: ['read', 'write', 'execute'] }],
      permissions: [{ resource: 'test.prepared', operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      for (const id of [actorAddress.componentId, rulesetAddress.componentId])
        api.registerState({
          id,
          version: '1.0.0',
          resource: 'test.prepared',
          validate: (value) => typeof value === 'number',
        });
      api.registerOperation({
        id: 'test:allocate',
        resource: 'test.prepared',
        run(_context, _input, state) {
          state.read(rulesetAddress);
          state.write(actorAddress, 1);
          return { proposed: true };
        },
      });
    },
  };
  const pack = definePack({ id: 'test:playbook', version: '1.0.0', kind: 'playbook', modules: [module] });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:playbook': module.descriptor.permissions! } },
  );
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice', subject: 'test:human' }],
      rules: [
        { effect: 'allow', resources: ['test.prepared'], operations: ['read', 'write', 'execute'], scope: 'any' },
      ],
    },
    composition.resources,
  );
  const entities = new EntityStore();
  entities.spawn({ id: 'alice', type: 'player', position: [0, 0, 0] });
  let installed = false,
    prepared = false;
  const events: string[] = [];
  const inventory: RegisteredStatePort = {
    read: () => ({ revision: 4, value: 0 }),
    commit: () => {
      throw new Error('prepared owner cannot use legacy commit');
    },
    prepareCommit(observed, writes, execution) {
      prepared = true;
      expect(observed).toEqual([{ address: actorAddress, revision: 4 }]);
      expect(writes).toEqual([{ address: actorAddress, value: 1 }]);
      expect(execution.authorizer).toBe(authorizer);
      expect(execution.context).toMatchObject({
        kind: 'actor',
        originalActorId: 'alice',
        principal: { subject: 'test:human' },
      });
      return {
        ok: true,
        revision: 5,
        value: { actionId: 'action-42' },
        validate() {
          events.push('validate');
        },
        apply() {
          events.push('apply');
          installed = true;
        },
      };
    },
  };
  const ruleset: RegisteredStatePort = {
    read: () => ({ revision: 7, value: 0 }),
    commit(observed, writes) {
      expect(observed).toEqual([{ address: rulesetAddress, revision: 7 }]);
      expect(writes).toEqual([]);
      return staleRuleset ? { ok: false, reason: 'ruleset-stale' } : { ok: true, revision: 7 };
    },
  };
  const manager = new GameplayModuleRuntime({
    composition,
    entities,
    clone: (value) => {
      if (value && typeof value === 'object' && 'actionId' in value) {
        expect(installed).toBe(false);
        events.push('copy-result');
      }
      return structuredClone(value);
    },
    inventory,
    mode: inventory,
    needs: inventory,
    ruleset,
  });
  const execution = manager.bind(authorizer, {
    moduleId: 'test:prepared',
    principalId: 'human',
    originalActorId: 'alice',
  });
  execution.subscribe((fact) => {
    events.push('publish');
    expect(installed).toBe(true);
    expect(fact.value).toEqual({ actionId: 'action-42' });
  });
  return {
    invoke: () => execution.invoke({ operationId: 'test:allocate', target: actorAddress.target }),
    state: () => ({ installed, prepared, events }),
  };
}

describe('Gameplay manager routes prepared owner commits', () => {
  it('checks Ruleset and copies the host result before validation and installation', () => {
    const world = setup();
    expect(world.invoke()).toMatchObject({ ok: true, revision: 5, value: { actionId: 'action-42' } });
    expect(world.state()).toEqual({
      installed: true,
      prepared: true,
      events: ['copy-result', 'validate', 'apply', 'publish'],
    });
  });
  it('rejects stale Ruleset before preparing the mutable owner', () => {
    const world = setup(true);
    expect(world.invoke()).toMatchObject({ ok: false, code: 'STATE_CONFLICT', message: 'ruleset-stale' });
    expect(world.state()).toEqual({ installed: false, prepared: false, events: [] });
  });
});
