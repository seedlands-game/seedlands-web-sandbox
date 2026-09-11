import { describe, expect, it } from 'vitest';

import {
  BEHAVIOR_REGISTRY_CAPABILITY,
  defineBehaviorCapabilityModule,
  definePack,
  type BehaviorCapabilityRegistry,
  type ModModule,
  type ModuleInvocationValue,
} from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createRegisteredOperationRuntime,
  OVERWORLD_PRODUCT_PERMISSIONS,
} from '@seedlands/game-core/server/composition/host-api';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import type { BehaviorRuntimeContext } from '../../packages/game-core/src/server/composition/behavior-capability-registry';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { WorldResourceAuthorizer } from '../../packages/game-core/src/server/harness/world-authorization';
import { characterActorSnapshot } from '../support/character-gameplay';
import { testCorePlatform } from '../support/core-platform';
import { createFaultyBehaviorComposition } from '../support/faulty-behavior-composition';
import { undeclaredOperationBehavior, verifiedBehaviorPack } from '../support/behavior-capability-fixtures';

describe('per-world behavior capability registry', () => {
  it('lets an external Pack install and run a continuing skill through its real registered operation', () => {
    const state = new Map<string, ModuleInvocationValue>([['npc-1', 0]]);
    let revision = 0;
    const counter: ModModule = {
      descriptor: {
        id: 'example:counter-module',
        version: '2.1.0',
        resources: [{ id: 'example.counter', operations: ['read', 'write', 'execute'] }],
        permissions: [{ resource: 'example.counter', operations: ['read', 'write', 'execute'] }],
      },
      register(api) {
        api.registerState({
          id: 'example:counter',
          version: '1.0.0',
          resource: 'example.counter',
          validate: (value) => Number.isSafeInteger(value) && Number(value) >= 0,
        });
        api.registerOperation({
          id: 'example:increment-counter',
          resource: 'example.counter',
          run(context, input, candidate) {
            const amount = Number((input as { amount?: unknown } | undefined)?.amount);
            if (!Number.isSafeInteger(amount) || amount < 1 || amount > 4) throw new TypeError('bad amount');
            const address = {
              componentId: 'example:counter',
              target: { kind: 'entity' as const, entityId: context.originalActorId },
            };
            const next = Number(candidate.read(address)) + amount;
            candidate.write(address, next);
            return { value: next };
          },
        });
      },
    };
    const behavior = defineBehaviorCapabilityModule({
      id: 'example:counter-behavior',
      version: '1.2.0',
      permissions: [{ resource: 'example.counter', operations: ['execute'] }],
      capabilities: [
        {
          kind: 'condition',
          id: 'example:counter-ready',
          version: '1.0.0',
          description: 'Counter work may begin.',
          arguments: {},
          evaluate: () => true,
        },
        {
          kind: 'condition',
          id: 'example:condition-throws',
          version: '1.0.0',
          description: 'Negative fixture for provider exceptions.',
          arguments: {},
          evaluate() {
            throw new Error('condition exploded');
          },
        },
        {
          kind: 'condition',
          id: 'example:condition-non-boolean',
          version: '1.0.0',
          description: 'Negative fixture for invalid provider results.',
          arguments: {},
          evaluate: () => 'invalid' as unknown as boolean,
        },
        {
          kind: 'skill',
          id: 'example:increment-twice',
          version: '1.0.0',
          description: 'Increment a counter on two separate simulation steps.',
          arguments: { amount: { type: 'number', required: true, minimum: 1, maximum: 4, integer: true } },
          requiredOperations: [{ operationId: 'example:increment-counter', authorization: 'self' }],
          state: {
            version: '1.0.0',
            maximumBytes: 128,
            validate: (value) =>
              Boolean(
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                'completed' in value &&
                value.completed === 1,
              ),
          },
          start(context, args) {
            const result = context.invoke({
              operationId: 'example:increment-counter',
              target: { kind: 'entity', entityId: context.actor.entityId },
              input: { amount: args.amount as number },
            });
            if (!result.ok) return { status: 'failed', reason: result.code };
            return { status: 'running', phase: 'halfway', state: { completed: 1 } };
          },
          continue(context, args, state) {
            const completed = Number((state as { completed?: unknown }).completed);
            const result = context.invoke({
              operationId: 'example:increment-counter',
              target: { kind: 'entity', entityId: context.actor.entityId },
              input: { amount: args.amount as number },
            });
            if (!result.ok) return { status: 'failed', reason: result.code };
            return { status: 'succeeded', phase: 'done', result: { completed: completed + 1 } };
          },
          cancel: () => ({ status: 'cancelled', phase: 'cancelled' }),
        },
        {
          kind: 'skill',
          id: 'example:target-other',
          version: '1.0.0',
          description: 'Negative fixture for unresolved raw target ids.',
          arguments: { targetRef: { type: 'entity-reference', required: true } },
          requiredOperations: [{ operationId: 'example:increment-counter', authorization: 'any' }],
          state: { version: '1.0.0', maximumBytes: 32 },
          start(context) {
            const result = context.invoke({
              operationId: 'example:increment-counter',
              target: { kind: 'entity', entityId: 'bob' },
              input: { amount: 1 },
            });
            return result.ok ? { status: 'succeeded', phase: 'unexpected' } : { status: 'failed', reason: result.code };
          },
          continue: () => ({ status: 'failed', reason: 'unexpected-continue' }),
        },
        undeclaredOperationBehavior(),
      ],
    });
    const extension = definePack({
      id: 'example:behavior-pack',
      version: '1.0.0',
      kind: 'extension',
      dependencies: [{ id: 'seedlands:overworld', version: '1.0.0' }],
      modules: [counter, behavior],
    });
    const composition = assembleWorldPacks([verifiedBehaviorPack(overworld), verifiedBehaviorPack(extension)], {
      approvedPermissions: {
        'seedlands:overworld': OVERWORLD_PRODUCT_PERMISSIONS,
        'example:behavior-pack': [...counter.descriptor.permissions!, ...behavior.descriptor.permissions!],
      },
    });
    const registry = composition.capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY);
    expect(registry.catalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'example:increment-twice',
          kind: 'skill',
          provider: { moduleId: 'example:counter-behavior', version: '1.2.0' },
        }),
      ]),
    );
    expect(() => registry.register({} as never, {} as never)).toThrow(/frozen/i);
    registry.validateDefinition({
      version: 1,
      root: {
        id: 'external-sequence',
        type: 'sequence',
        children: [
          { id: 'ready', type: 'condition', condition: { name: 'example:counter-ready' } },
          { id: 'increment', type: 'action', skill: 'example:increment-twice', args: { amount: 2 } },
        ],
      },
    });

    const authorizer = new WorldResourceAuthorizer(
      {
        principals: [{ id: 'npc-principal', boundEntityId: 'npc-1' }],
        rules: [
          {
            effect: 'allow',
            principal: { ids: ['npc-principal'] },
            resources: ['example.counter'],
            operations: ['read', 'write', 'execute'],
            scope: 'self',
          },
        ],
      },
      composition.resources,
    );
    const operations = createRegisteredOperationRuntime({
      composition,
      authorizer,
      clone: structuredClone,
      state: {
        read(address) {
          if (address.target.kind !== 'entity') throw new Error('unsupported target');
          return { revision, value: state.get(address.target.entityId) ?? 0 };
        },
        commit(observed, writes) {
          if (observed.some((entry) => entry.revision !== revision)) return { ok: false, reason: 'stale' };
          for (const write of writes) {
            if (write.address.target.kind !== 'entity') throw new Error('unsupported target');
            state.set(write.address.target.entityId, write.value);
          }
          return { ok: true, revision: ++revision };
        },
      },
    });
    const execution = operations.bind({
      moduleId: 'example:counter-module',
      principalId: 'npc-principal',
      originalActorId: 'npc-1',
    });
    const context = {
      actor: { entityId: 'npc-1', epoch: 1, lifetime: 1, behaviorRevision: 3, activation: 7 },
      actorState: {
        reference: { entityId: 'npc-1', epoch: 1, lifetime: 1 },
        lifecycle: 'alive',
        controlSource: 'behavior',
        health: 10,
        maxHealth: 10,
        needs: { hunger: 0, maxHunger: 100, hungerMeaning: 'deficit' },
        inventory: { slots: [], selectedSlot: 0, revision: 0 },
      },
      deltaSeconds: 0.1,
      elapsedSeconds: 0.1,
      resolveTarget: () => null,
      allows: () => true,
      standard: {
        evaluate: () => false,
        start: () => ({ status: 'failed', reason: 'not-standard' }),
        continue: () => ({ status: 'failed', reason: 'not-standard' }),
        cancel: () => ({ status: 'cancelled' }),
      },
      invoke(
        origin: { moduleId: string; providerId: string; providerVersion: string },
        request: Parameters<typeof execution.invoke>[0],
      ) {
        expect(origin).toEqual({
          moduleId: 'example:counter-behavior',
          providerId: 'example:increment-twice',
          providerVersion: '1.0.0',
        });
        const provider = composition.moduleBindings[origin.moduleId];
        const owner = composition.registrations.operations.find((entry) => entry.definition.id === request.operationId);
        const resource = owner?.definition.resource;
        if (
          !resource ||
          !provider?.permissions.some((entry) => entry.resource === resource && entry.operations.includes('execute'))
        )
          return {
            ok: false as const,
            code: 'PROVIDER_PERMISSION_DENIED',
            message: 'Provider lacks execute permission.',
          };
        return execution.invoke(request);
      },
    } satisfies BehaviorRuntimeContext;
    expect(registry.catalogForActor(context.actor, context.actorState, () => true)).toEqual(registry.catalog());
    expect(
      registry.catalogForActor(
        { ...context.actor, lifetime: context.actor.lifetime + 1 },
        context.actorState,
        () => true,
      ),
    ).toEqual([]);
    expect(registry.catalogForActor(context.actor, { ...context.actorState, lifecycle: 'dead' }, () => true)).toEqual(
      [],
    );
    expect(
      registry.catalogForActor(context.actor, { ...context.actorState, controlSource: 'player' }, () => true),
    ).toEqual([]);
    expect(registry.evaluate('example:counter-ready', context, {})).toBe(true);
    expect(() => registry.evaluate('example:condition-throws', context, {})).toThrow(/condition exploded/);
    expect(() => registry.evaluate('example:condition-non-boolean', context, {})).toThrow(/non-boolean/);
    expect(() =>
      registry.validateDefinition({
        version: 1,
        root: { id: 'bad-args', type: 'action', skill: 'example:increment-twice', args: { amount: 0 } },
      }),
    ).toThrow(/range|argument/i);
    expect(registry.start('example:target-other', context, { targetRef: 'forged-bob' })).toMatchObject({
      status: 'failed',
      reason: 'BEHAVIOR_TARGET_UNRESOLVED',
    });
    expect(registry.start('example:undeclared-operation', context, {})).toMatchObject({
      status: 'failed',
      reason: 'BEHAVIOR_OPERATION_UNDECLARED',
    });
    expect(() => registry.start('example:increment-twice', { ...context, allows: () => false }, { amount: 2 })).toThrow(
      /capability is unavailable/i,
    );
    const started = registry.start('example:increment-twice', context, { amount: 2 });
    expect(started).toMatchObject({ status: 'running', state: { completed: 1 } });
    if (started.status !== 'running') throw new Error('expected running skill');
    expect(registry.continue('example:increment-twice', context, { amount: 2 }, started.state)).toMatchObject({
      status: 'succeeded',
      result: { completed: 2 },
    });
    expect(state.get('npc-1')).toBe(4);
    expect(() =>
      registry.assertRestorable({
        capabilityId: 'example:increment-twice',
        provider: { moduleId: 'example:counter-behavior', version: '1.2.0' },
        state: { version: '1.0.0', value: { completed: 2 } },
      }),
    ).toThrow(/state|incompatible/i);
  });

  it('rejects unknown capabilities, invalid arguments and incompatible restored provider state', () => {
    const composition = assembleWorldPacks([verifiedBehaviorPack(overworld)], {
      approvedPermissions: { 'seedlands:overworld': OVERWORLD_PRODUCT_PERMISSIONS },
    });
    const registry = composition.capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY);
    const standardCalls: string[] = [];
    const standardContext = {
      actor: { entityId: 'npc-1', epoch: 1, lifetime: 1, behaviorRevision: 1, activation: 1 },
      actorState: {
        reference: { entityId: 'npc-1', epoch: 1, lifetime: 1 },
        lifecycle: 'alive',
        controlSource: 'behavior',
        health: 10,
        maxHealth: 10,
        needs: { hunger: 0, maxHunger: 100, hungerMeaning: 'deficit' },
        inventory: { slots: [], selectedSlot: 0, revision: 0 },
      },
      deltaSeconds: 0.1,
      elapsedSeconds: 0.1,
      resolveTarget: () => null,
      allows: () => true,
      invoke: () => ({ ok: false as const, code: 'UNEXPECTED', message: 'unexpected' }),
      standard: {
        evaluate: () => false,
        start(id: string) {
          standardCalls.push(id);
          return { status: 'running' as const, phase: 'waiting', state: {} };
        },
        continue: () => ({ status: 'failed' as const, reason: 'unexpected' }),
        cancel: () => ({ status: 'cancelled' as const }),
      },
    } satisfies BehaviorRuntimeContext;
    expect(registry.start('wait', standardContext, { seconds: 1 })).toMatchObject({
      status: 'running',
      phase: 'waiting',
    });
    expect(standardCalls).toEqual(['wait']);
    expect(() =>
      registry.validateDefinition({
        version: 1,
        root: { id: 'unknown', type: 'action', skill: 'example:missing' },
      }),
    ).toThrow(/unknown|registered/i);
    expect(() =>
      registry.validateDefinition({
        version: 1,
        root: { id: 'too-much-speech', type: 'action', skill: 'speak', args: { text: 'x'.repeat(281) } },
      }),
    ).toThrow(/range|argument/i);
    expect(() =>
      registry.assertRestorable({
        capabilityId: 'wait',
        provider: { moduleId: 'seedlands:behavior-registry-module', version: '0.9.0' },
        state: { version: '1.0.0', value: { remaining: 1 } },
      }),
    ).toThrow(/provider|version|state/i);
    expect(() => registry.assertRestorable({} as never)).toThrow(/checkpoint|provider|state/i);
  });

  it('isolates throwing and non-boolean external conditions to their actors with observable failures', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'faulty-external-condition',
      createComposition: createFaultyBehaviorComposition,
    });
    try {
      await session.world.clock({ kind: 'pause' });
      const born = await session.world.character({
        kind: 'create',
        profile: { name: 'milestone-failure', personality: 'Condition projection fixture.' },
        position: [0.5, 34, 0.5],
        behaviorTree: {
          goal: {
            description: 'Expose an unavailable milestone without corrupting birth.',
            milestones: [
              {
                id: 'faulty-milestone',
                description: 'External state is currently unavailable.',
                condition: { name: 'example:throws-during-tick' },
              },
            ],
          },
          definition: { version: 1, root: { id: 'milestone-hold', type: 'action', skill: 'hold' } },
        },
      });
      expect(born).toMatchObject({
        ok: true,
        data: {
          kind: 'created',
          character: {
            behaviorTree: {
              runtime: {
                milestones: [
                  {
                    id: 'faulty-milestone',
                    satisfied: false,
                    failure: expect.stringMatching(/condition-provider-failed.*condition tick exploded/),
                  },
                ],
              },
            },
          },
        },
      });
      if (!born.ok || born.data.kind !== 'created') throw new Error('Milestone fixture was not created.');
      const bornId = born.data.character.entityId;
      expect(
        characterActorSnapshot(session.runtime.server.freezeSaveSnapshot(0).gameplay, bornId)?.character,
      ).toMatchObject({ entityId: bornId, behaviorTree: { goal: { description: expect.any(String) } } });
      const beforeInspect = session.runtime.server.freezeSaveSnapshot(0);
      for (let index = 0; index < 2; index += 1) {
        const inspected = await session.world.character({ kind: 'inspect', entityId: bornId });
        expect(inspected).toMatchObject({
          ok: true,
          data: {
            kind: 'state',
            character: {
              behaviorTree: {
                runtime: {
                  milestones: [expect.objectContaining({ id: 'faulty-milestone', failure: expect.any(String) })],
                },
              },
            },
          },
        });
      }
      expect(session.runtime.server.freezeSaveSnapshot(0)).toEqual(beforeInspect);
      const create = async (name: string, condition?: string) => {
        const root = condition
          ? {
              id: `${name}-root`,
              type: 'selector' as const,
              children: [
                { id: `${name}-guarded`, type: 'action' as const, skill: 'hold', guard: { name: condition } },
                { id: `${name}-fallback`, type: 'action' as const, skill: 'hold' },
              ],
            }
          : { id: `${name}-healthy`, type: 'action' as const, skill: 'hold' };
        const result = await session.world.character({
          kind: 'create',
          profile: { name, personality: 'Condition isolation fixture.' },
          position: [0.5, 34, 0.5],
          behaviorTree: { goal: { description: 'Remain isolated.' }, definition: { version: 1, root } },
        });
        if (!result.ok || result.data.kind !== 'created') throw new Error(`Character ${name} was not created.`);
        return result.data.character.entityId;
      };
      const throwing = await create('throwing', 'example:throws-during-tick');
      const invalid = await create('invalid', 'example:invalid-during-tick');
      const healthy = await create('healthy');
      expect(await session.world.clock({ kind: 'advance', elapsedMs: 100 })).toMatchObject({ ok: true });
      for (const [entityId, nodeId] of [
        [throwing, '$guard:throwing-guarded'],
        [invalid, '$guard:invalid-guarded'],
      ] as const) {
        const observed = await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
        if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Observation unavailable.');
        expect(observed.data.observation.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'activity-failed', nodeId, reason: expect.stringMatching(/condition/) }),
            expect.objectContaining({ type: 'activity-started', nodeId: expect.stringMatching(/fallback/) }),
          ]),
        );
      }
      const healthyObservation = await session.world.character({ kind: 'observe', entityId: healthy, sinceCursor: 0 });
      if (!healthyObservation.ok || healthyObservation.data.kind !== 'observation')
        throw new Error('Healthy observation unavailable.');
      expect(healthyObservation.data.observation.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'activity-started', nodeId: 'healthy-healthy' })]),
      );
    } finally {
      await session.dispose();
    }
  }, 30_000);
});
