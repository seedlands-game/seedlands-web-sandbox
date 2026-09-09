import { describe, expect, it } from 'vitest';
import { definePack } from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createRegisteredOperationRuntime,
  type RegisteredStatePort,
} from '@seedlands/game-core/server/composition/host-api';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import {
  COMBAT_CLOCK_RESOURCE,
  COMBAT_RESOURCE,
  combatActorAddress,
  combatWorldAddress,
  validateCombatActorProjection,
  type CombatActorProjectionV1,
} from '../../../packages/game-core/src/server/gameplay/modules/combat-model';
import type { ModuleInvocationValue } from '../../../packages/game-core/src/server/composition/contracts';
import { defineCombatModule } from '../../../packages/game-core/src/server/gameplay/modules/combat-module';
import { defineCombatRulesModule } from '../../../packages/game-core/src/server/gameplay/modules/combat-rules-module';
import {
  defineRulesetModule,
  RULESET_COMPONENT,
  RULESET_RESOURCE,
  rulesetSnapshot,
} from '../../../packages/game-core/src/server/gameplay/modules/ruleset-module';

const actor = (
  entityId: string,
  options: Partial<Pick<CombatActorProjectionV1, 'mode' | 'pending'>> = {},
): CombatActorProjectionV1 => ({
  version: 1,
  reference: { entityId, epoch: 2, lifetime: entityId === 'alice' ? 1 : 2 },
  kind: 'player',
  health: 20,
  maxHealth: 20,
  lifecycle: 'alive',
  mode: options.mode ?? { value: 'survival', revision: 0 },
  meleeDefinitionId: 'wood-sword',
  combat: {
    active: options.pending
      ? {
          actionId: 'action-1',
          definitionId: 'wood-sword',
          targetId: options.pending.targetId,
          comboStep: 0,
          comboLength: 2,
          phase: 'windup',
          phaseElapsedSeconds: 0.18,
          phaseDurationSeconds: 0.18,
          canBuffer: false,
          buffered: false,
        }
      : null,
    cooldownRemainingSeconds: options.pending ? 0.32 : 0,
    lastResult: null,
  },
  pending: options.pending ?? null,
});

function setup(withRules = true, targetMode: 'survival' | 'creative' = 'survival') {
  const rulesetDefinition = { id: 'test:rules', version: '1.0.0' };
  const modules = [
    defineRulesetModule(rulesetDefinition),
    defineCombatModule(),
    ...(withRules
      ? [
          defineCombatRulesModule({
            moduleId: 'test:combat-rules',
            profile: { damageMultiplier: 2, immuneTargetModes: ['creative'] },
          }),
        ]
      : []),
  ];
  const pack = definePack({ id: 'test:combat-pack', version: '1.0.0', kind: 'playbook', modules });
  const permissions = [
    { resource: COMBAT_RESOURCE, operations: ['read', 'execute'] as const },
    { resource: COMBAT_CLOCK_RESOURCE, operations: ['read', 'execute'] as const },
    { resource: RULESET_RESOURCE, operations: ['read'] as const },
  ];
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: {
          algorithm: 'sha256' as const,
          manifestDigest: 'a'.repeat(64),
          entryDigest: 'b'.repeat(64),
          resources: [],
        },
      },
    ],
    { approvedPermissions: { 'test:combat-pack': permissions } },
  );
  const projections = new Map<string, ModuleInvocationValue>([
    [
      JSON.stringify(combatActorAddress('alice')),
      actor('alice', { pending: { token: 'hit-1', targetId: 'bob', baseDamage: 5 } }),
    ],
    [JSON.stringify(combatActorAddress('bob')), actor('bob', { mode: { value: targetMode, revision: 3 } })],
    [JSON.stringify({ componentId: RULESET_COMPONENT, target: { kind: 'world' } }), rulesetSnapshot(rulesetDefinition)],
  ]);
  for (let partition = 0; partition < 5; partition++)
    projections.set(JSON.stringify(combatWorldAddress(partition)), {
      version: 1,
      partition,
      entries: partition === 0 ? [{ reference: actor('alice').reference, active: false, pending: true }] : [],
    });
  const prepared: Array<{ candidate: unknown; writes: readonly unknown[] }> = [];
  const state: RegisteredStatePort = {
    read(address) {
      const value = projections.get(JSON.stringify(address));
      if (value === undefined) throw new Error(`missing projection ${JSON.stringify(address)}`);
      return { revision: 4, value };
    },
    prepareCommit(_observed, writes, execution) {
      prepared.push({ candidate: execution.candidateValue, writes });
      return {
        ok: true,
        revision: 4,
        value: execution.candidateValue,
        validate() {},
        apply() {},
      };
    },
    commit() {
      throw new Error('pure Combat module must use inspected prepareCommit');
    },
  };
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [
        { id: 'human', subject: 'test:human', boundEntityId: 'alice' },
        { id: 'clock', subject: 'test:clock', kind: 'system' },
      ],
      rules: [
        { effect: 'allow', resources: [COMBAT_RESOURCE], operations: ['read', 'execute'], scope: 'any' },
        { effect: 'allow', resources: [COMBAT_CLOCK_RESOURCE], operations: ['read', 'execute'], scope: 'any' },
        { effect: 'allow', resources: [RULESET_RESOURCE], operations: ['read'], scope: 'any' },
      ],
    },
    composition.resources,
  );
  const operations = createRegisteredOperationRuntime({ composition, authorizer, clone: structuredClone, state });
  return {
    actor: operations.bind({ moduleId: 'seedlands:combat-module', principalId: 'human', originalActorId: 'alice' }),
    system: operations.bind({
      kind: 'system',
      moduleId: 'seedlands:combat-module',
      principalId: 'clock',
      systemId: 'seedlands:combat-system',
    }),
    prepared,
  };
}

describe('registered Combat candidate modules', () => {
  it('admits a percent-encoded pending token derived from maximum Unicode identities', () => {
    const encoded = encodeURIComponent('\u0800'.repeat(256));
    const token = `combat-hit:${encoded}:${encoded}:0:1`;
    expect(token.length).toBeGreaterThan(2048);
    expect(
      validateCombatActorProjection(actor('alice', { pending: { token, targetId: 'bob', baseDamage: 5 } })).pending
        ?.token,
    ).toBe(token);
  });

  it('emits a readonly request candidate derived from the actor projection with zero writes', () => {
    const world = setup();
    const result = world.actor.invoke({
      operationId: 'seedlands:request-combat',
      target: { kind: 'entity', entityId: 'bob' },
      input: { targetId: 'bob' },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        version: 1,
        kind: 'request',
        actorId: 'alice',
        targetId: 'bob',
        definitionId: 'wood-sword',
        rulesetRevision: 0,
      },
    });
    expect(world.prepared).toEqual([{ candidate: (result as { value: unknown }).value, writes: [] }]);
  });

  it('derives resolve damage from the explicit profile and exempts configured modes', () => {
    for (const [mode, damage] of [
      ['survival', 10],
      ['creative', 0],
    ] as const) {
      const world = setup(true, mode);
      const result = world.actor.invoke({
        operationId: 'seedlands:resolve-combat',
        target: { kind: 'entity', entityId: 'bob' },
        input: { token: 'hit-1' },
      });
      expect(result).toMatchObject({ ok: true, value: { kind: 'resolve', token: 'hit-1', damage } });
    }
  });

  it('fails closed without before rules and rejects forged raw fields', () => {
    const missing = setup(false);
    expect(
      missing.actor.invoke({
        operationId: 'seedlands:request-combat',
        target: { kind: 'entity', entityId: 'bob' },
        input: { targetId: 'bob' },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    const world = setup();
    expect(
      world.actor.invoke({
        operationId: 'seedlands:resolve-combat',
        target: { kind: 'entity', entityId: 'bob' },
        input: { token: 'hit-1', damage: 999 },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
  });

  it('reads all five bounded partitions for a world-clock advance candidate', () => {
    const world = setup();
    const result = world.system.invoke({
      operationId: 'seedlands:advance-combat',
      target: { kind: 'world' },
      input: { seconds: 0.25 },
    });
    expect(result).toMatchObject({ ok: true, value: { version: 1, kind: 'advance', seconds: 0.25 } });
    expect(world.prepared.at(-1)).toMatchObject({ writes: [] });

    const cancelled = world.system.invoke({
      operationId: 'seedlands:advance-combat',
      target: { kind: 'world' },
      input: { seconds: 0, cancelTokens: ['hit-1'] },
    });
    expect(cancelled).toMatchObject({
      ok: true,
      value: { version: 1, kind: 'advance', seconds: 0, cancelTokens: ['hit-1'] },
    });
    expect(
      world.system.invoke({
        operationId: 'seedlands:advance-combat',
        target: { kind: 'world' },
        input: { seconds: 0, cancelTokens: ['hit-1', 'hit-1'] },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
  });
});
