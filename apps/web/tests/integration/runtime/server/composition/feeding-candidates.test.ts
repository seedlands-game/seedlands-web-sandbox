import { describe, expect, it } from 'vitest';
import { definePack, type ModModule, type ModuleInvocationValue } from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks, createRegisteredOperationRuntime } from '@seedlands/stdlib/host';
import type { RegisteredStatePort } from '../../../../../../../packages/stdlib/src/server/composition/operation-contracts';
import { WorldResourceAuthorizer } from '../../../../../../../packages/stdlib/src/server/harness/world-authorization';
import { createGameplayContent } from '../../../../../../../packages/stdlib/src/server/gameplay/gameplay-content';
import { defineContentModule } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/content-module';
import {
  FEEDING_ACTOR_COMPONENT,
  FEEDING_ACTOR_RESOURCE,
  FEEDING_CONSUME_WORLD_ITEM_OPERATION,
  FEEDING_ITEM_COMPONENT,
  FEEDING_ITEM_RESOURCE,
  buildFeedingCandidate,
  feedingActorAddress,
  feedingItemAddress,
  type FeedingActorProjectionV1,
  type FeedingItemProjectionV1,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/feeding-model';
import { defineFeedingActionsModule } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/feeding-actions-module';
import {
  defineFeedingRulesModule,
  type FeedingRulesModuleOptions,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/feeding-rules-module';

const itemDefinitions = [
  {
    id: 'test:berry',
    name: 'Berry',
    itemType: 'food' as const,
    stackLimit: 8,
    capabilities: [{ type: 'consume' as const, hungerRestore: 4 }],
  },
  { id: 'test:stone', name: 'Stone', itemType: 'resource' as const, stackLimit: 8, capabilities: [] },
] as const;
const content = createGameplayContent({ items: itemDefinitions, recipes: [], meleeDefinitions: [] });

const actor = (overrides: Partial<FeedingActorProjectionV1> = {}): FeedingActorProjectionV1 => ({
  version: 1,
  reference: { entityId: 'grazer', epoch: 3, lifetime: 4 },
  position: [0, 1, 0],
  lifecycle: 'alive',
  active: true,
  archetype: 'grazer',
  needs: { hunger: 60, maxHunger: 100, meaning: 'deficit' },
  ...overrides,
});

const item = (count = 2, overrides: Partial<FeedingItemProjectionV1> = {}): FeedingItemProjectionV1 => ({
  version: 1,
  reference: { entityId: 'berry-drop', epoch: 3, lifetime: 9 },
  position: [0.5, 1, 0],
  stack: { itemId: 'test:berry', count },
  ...overrides,
});

const defaultRules = (overrides: Partial<FeedingRulesModuleOptions> = {}) =>
  defineFeedingRulesModule({
    moduleId: 'test:feeding-rules',
    eligibleArchetypes: ['grazer'],
    deficitThreshold: 50,
    restore: 'full',
    ...overrides,
  });

type SetupOptions = Readonly<{
  grants?: boolean;
  rules?: ModModule;
  extra?: readonly ModModule[];
  actorProjection?: FeedingActorProjectionV1;
  itemProjection?: FeedingItemProjectionV1;
}>;

function setup(options: SetupOptions = {}) {
  const contentModule = defineContentModule({
    moduleId: 'test:feeding-content',
    items: itemDefinitions,
    recipes: [],
    meleeDefinitions: [],
  });
  const needs: ModModule = {
    descriptor: {
      id: 'test:needs-provider',
      version: '1.0.0',
      provides: [{ id: 'seedlands:needs', version: '1.0.0' }],
    },
    register(api) {
      api.provideCapability('seedlands:needs', Object.freeze({ version: 1 }));
    },
  };
  const actions = defineFeedingActionsModule();
  const rules = options.rules ?? defaultRules();
  const modules = [contentModule, needs, actions, rules, ...(options.extra ?? [])];
  const selected = definePack({ id: 'test:feeding-pack', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...selected,
        integrity: {
          algorithm: 'sha256' as const,
          manifestDigest: 'a'.repeat(64),
          entryDigest: 'b'.repeat(64),
          resources: [],
        },
      },
    ],
    { approvedPermissions: { 'test:feeding-pack': modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const projections = new Map<string, ModuleInvocationValue>([
    [JSON.stringify(feedingActorAddress('grazer')), options.actorProjection ?? actor()],
    [JSON.stringify(feedingItemAddress('berry-drop')), options.itemProjection ?? item()],
  ]);
  let prepareCount = 0;
  const state: RegisteredStatePort = {
    read(address) {
      const value = projections.get(JSON.stringify(address));
      if (value === undefined) throw new Error(`missing projection ${JSON.stringify(address)}`);
      return { revision: 7, value };
    },
    prepareCommit(_observed, writes, execution) {
      expect(writes).toEqual([]);
      prepareCount += 1;
      return {
        ok: true,
        revision: 7,
        value: execution.candidateValue,
        validate() {},
        apply() {},
      };
    },
    commit() {
      throw new Error('Feeding must use the inspected no-write prepare path.');
    },
  };
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'consumer', subject: 'test:grazer', kind: 'actor', boundEntityId: 'grazer' }],
      rules:
        options.grants === false
          ? []
          : [
              {
                effect: 'allow',
                resources: [FEEDING_ACTOR_RESOURCE],
                operations: ['read', 'execute'],
                scope: 'self',
              },
              {
                effect: 'allow',
                resources: [FEEDING_ITEM_RESOURCE],
                operations: ['read', 'execute'],
                scope: 'any',
              },
            ],
    },
    composition.resources,
  );
  const execution = createRegisteredOperationRuntime({ composition, authorizer, clone: structuredClone, state }).bind({
    moduleId: 'seedlands:feeding-actions-module',
    principalId: 'consumer',
    originalActorId: 'grazer',
  });
  return { composition, execution, projections, prepareCount: () => prepareCount };
}

const consume = (world: ReturnType<typeof setup>, input?: Readonly<{ existingActionId: string }>) =>
  world.execution.invoke({
    operationId: FEEDING_CONSUME_WORLD_ITEM_OPERATION,
    target: { kind: 'entity', entityId: 'berry-drop' },
    ...(input ? { input } : {}),
  });

describe('pure Feeding candidate', () => {
  it.each([
    ['satiety', 10, 14],
    ['deficit', 10, 6],
  ] as const)('bounds %s hunger and preserves a partial stack', (meaning, hunger, expected) => {
    const candidate = buildFeedingCandidate(content, {
      actor: actor({ needs: { hunger, maxHunger: 20, meaning } }),
      item: item(2),
      input: { existingActionId: null, hungerRestore: 4 },
    });
    expect(candidate).toMatchObject({
      kind: 'consume-world-item',
      previousStack: { itemId: 'test:berry', count: 2 },
      nextStack: { itemId: 'test:berry', count: 1 },
      hungerBefore: hunger,
      hungerAfter: expected,
      existingActionId: null,
      result: { success: true, consumedEntityId: 'berry-drop', count: 1 },
    });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.previousStack)).toBe(true);
    expect(Object.isFrozen(candidate.nextStack)).toBe(true);
    expect(candidate.previousStack).not.toBe(candidate.nextStack);
  });

  it('removes only the final unit and retains an existing Action identity', () => {
    expect(
      buildFeedingCandidate(content, {
        actor: actor(),
        item: item(1),
        input: { existingActionId: 'eat-7', hungerRestore: 60 },
      }),
    ).toMatchObject({ previousStack: { count: 1 }, nextStack: null, hungerAfter: 0, existingActionId: 'eat-7' });
  });

  it('strictly rejects invalid actors, items, effective input, and shared mutable projection data', () => {
    expect(() =>
      buildFeedingCandidate(content, {
        actor: actor({ lifecycle: 'dead' }),
        item: item(),
        input: { existingActionId: null, hungerRestore: 4 },
      }),
    ).toThrow('actor-dead');
    expect(() =>
      buildFeedingCandidate(content, {
        actor: actor({ active: false }),
        item: item(),
        input: { existingActionId: null, hungerRestore: 4 },
      }),
    ).toThrow('actor-inactive');
    expect(() =>
      buildFeedingCandidate(content, {
        actor: actor(),
        item: item(2, { stack: { itemId: 'test:stone', count: 2 } }),
        input: { existingActionId: null, hungerRestore: 4 },
      }),
    ).toThrow('item-not-food');
    expect(() =>
      buildFeedingCandidate(content, {
        actor: actor(),
        item: item(),
        input: { existingActionId: null, hungerRestore: 4, extra: true },
      }),
    ).toThrow(/fields/i);

    const sharedPosition = [0.5, 1, 0] as [number, number, number];
    const stack = { itemId: 'test:berry', count: 2 };
    const candidate = buildFeedingCandidate(content, {
      actor: actor({ position: sharedPosition }),
      item: item(2, { position: sharedPosition, stack }),
      input: { existingActionId: null, hungerRestore: 4 },
    });
    sharedPosition[0] = 99;
    stack.count = 7;
    expect(candidate.position).toEqual([0.5, 1, 0]);
    expect(candidate.previousStack).toEqual({ itemId: 'test:berry', count: 2 });
  });
});

describe('registered Feeding mechanism and default Rules', () => {
  it('registers independent projections and derives a frozen no-write candidate', () => {
    const world = setup();
    expect(world.composition.registrations.states.map(({ definition }) => definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: FEEDING_ACTOR_COMPONENT, resource: FEEDING_ACTOR_RESOURCE }),
        expect.objectContaining({ id: FEEDING_ITEM_COMPONENT, resource: FEEDING_ITEM_RESOURCE }),
      ]),
    );
    expect(consume(world, { existingActionId: 'eat-7' })).toMatchObject({
      ok: true,
      value: {
        kind: 'consume-world-item',
        hungerBefore: 60,
        hungerAfter: 0,
        existingActionId: 'eat-7',
      },
    });
    expect(world.prepareCount()).toBe(1);
  });

  it('rejects missing grants and an after veto before host preparation', () => {
    const denied = setup({ grants: false });
    expect(consume(denied)).toMatchObject({ ok: false });
    expect(denied.prepareCount()).toBe(0);

    const veto: ModModule = {
      descriptor: {
        id: 'test:feeding-veto',
        version: '1.0.0',
        permissions: [{ resource: FEEDING_ITEM_RESOURCE, operations: ['execute'] }],
      },
      register(api) {
        api.registerRule({
          id: 'test:feeding-veto',
          operationId: FEEDING_CONSUME_WORLD_ITEM_OPERATION,
          stage: 'after',
          apply: () => ({ reject: 'protected-food' }),
        });
      },
    };
    const rejected = setup({ extra: [veto] });
    expect(consume(rejected)).toMatchObject({ ok: false, code: 'RULE_REJECTED', message: 'protected-food' });
    expect(rejected.prepareCount()).toBe(0);
  });

  it('rejects actor and item projection identities that do not match the bound request', () => {
    const forgedActor = setup({ actorProjection: actor({ reference: { entityId: 'other', epoch: 3, lifetime: 4 } }) });
    expect(consume(forgedActor)).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    expect(forgedActor.prepareCount()).toBe(0);

    const forgedItem = setup({
      itemProjection: item(2, { reference: { entityId: 'other-drop', epoch: 3, lifetime: 9 } }),
    });
    expect(consume(forgedItem)).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    expect(forgedItem.prepareCount()).toBe(0);
  });

  it('deep snapshots explicit policy and rejects invalid configuration', () => {
    const eligibleArchetypes = ['grazer'];
    const rules = defaultRules({ eligibleArchetypes, restore: 'food' });
    eligibleArchetypes[0] = 'night-stalker';
    expect(consume(setup({ rules }))).toMatchObject({ ok: true, value: { hungerAfter: 56 } });

    for (const options of [
      { moduleId: '', eligibleArchetypes: ['grazer'], deficitThreshold: 50, restore: 'full' },
      { moduleId: 'test:bad', eligibleArchetypes: ['grazer', 'grazer'], deficitThreshold: 50, restore: 'full' },
      { moduleId: 'test:bad', eligibleArchetypes: ['grazer'], deficitThreshold: -1, restore: 'full' },
      { moduleId: 'test:bad', eligibleArchetypes: ['grazer'], deficitThreshold: 50, restore: 'some' },
    ])
      expect(() => defineFeedingRulesModule(options as FeedingRulesModuleOptions)).toThrow();
  });
});
