import { describe, expect, it } from 'vitest';
import { definePack, type ModModule, type ModuleInvocationValue } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, createRegisteredOperationRuntime } from '@seedlands/game-core/server/composition/host-api';
import type { RegisteredStatePort } from '../../../packages/game-core/src/server/composition/operation-contracts';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { createGameplayContent } from '../../../packages/game-core/src/server/gameplay/gameplay-content';
import { defineContentModule } from '../../../packages/game-core/src/server/gameplay/modules/content-module';
import { defineInventoryModule } from '../../../packages/game-core/src/server/gameplay/modules/inventory-module';
import {
  INVENTORY_ACTOR_COMPONENT,
  INVENTORY_ITEM_COMPONENT,
  INVENTORY_ITEM_RESOURCE,
  INVENTORY_RESOURCE,
  buildInventoryActionCandidate,
  inventoryActorAddress,
  inventoryItemAddress,
  type InventoryActionCandidateRequest,
  type InventoryActorProjectionV1,
  type InventoryWorldItemProjectionV1,
} from '../../../packages/game-core/src/server/gameplay/modules/inventory-action-model';
import { defineInventoryActionsModule } from '../../../packages/game-core/src/server/gameplay/modules/inventory-actions-module';

const itemDefinitions = [
  { id: 'test:wood', name: 'Wood', itemType: 'resource' as const, stackLimit: 8, capabilities: [] },
  { id: 'test:plank', name: 'Plank', itemType: 'resource' as const, stackLimit: 8, capabilities: [] },
  {
    id: 'test:berry',
    name: 'Berry',
    itemType: 'food' as const,
    stackLimit: 8,
    capabilities: [{ type: 'consume' as const, hungerRestore: 4 }],
  },
  {
    id: 'test:tool',
    name: 'Tool',
    itemType: 'tool' as const,
    stackLimit: 1,
    durability: { max: 10 },
    capabilities: [],
  },
] as const;
const recipeDefinitions = [
  { id: 'test:planks', inputs: [{ itemId: 'test:wood', count: 1 }], outputs: [{ itemId: 'test:plank', count: 2 }] },
] as const;
const content = createGameplayContent({ items: itemDefinitions, recipes: recipeDefinitions, meleeDefinitions: [] });

const actor = (
  entityId: string,
  kind: InventoryActorProjectionV1['kind'] = 'player',
  overrides: Partial<InventoryActorProjectionV1> = {},
): InventoryActorProjectionV1 => ({
  version: 1,
  reference: { entityId, epoch: 3, lifetime: entityId === 'alice' ? 4 : 5 },
  kind,
  slots: [{ itemId: 'test:wood', count: 2 }, { itemId: 'test:berry', count: 2 }, null, null],
  equipment: { selectedSlot: 0, hotbarSize: 2 },
  lifecycle: 'alive',
  needs: { hunger: 10, maxHunger: 20, meaning: 'satiety' },
  ...overrides,
});
const item = (
  entityId = 'item-1',
  stack: InventoryWorldItemProjectionV1['stack'] = { itemId: 'test:wood', count: 2 },
): InventoryWorldItemProjectionV1 => ({
  version: 1,
  reference: { entityId, epoch: 3, lifetime: 9 },
  position: [1, 2, 3],
  stack,
});

function setup(withRules = false) {
  const contentModule = defineContentModule({
    moduleId: 'test:content',
    items: itemDefinitions,
    recipes: recipeDefinitions,
    meleeDefinitions: [],
  });
  const legacyInventory = defineInventoryModule();
  const actions = defineInventoryActionsModule();
  const observedCandidates: unknown[] = [];
  const ruleTrace: string[] = [];
  const rules: ModModule = {
    descriptor: {
      id: 'test:inventory-action-rules',
      version: '1.0.0',
      requires: [{ id: 'seedlands:inventory-actions', version: '1.0.0' }],
      permissions: [{ resource: INVENTORY_RESOURCE, operations: ['read', 'execute'] }],
    },
    register(api) {
      api.registerRule({
        id: 'test:select-before',
        operationId: 'seedlands:inventory-select',
        stage: 'before',
        apply() {
          ruleTrace.push('before');
          return { input: { slot: 1 } };
        },
      });
      api.registerRule({
        id: 'test:select-after',
        operationId: 'seedlands:inventory-select',
        stage: 'after',
        apply(_context, input, _state, candidate) {
          ruleTrace.push('after');
          expect(input).toEqual({ slot: 1 });
          expect(candidate).toMatchObject({ kind: 'select', args: { slot: 1 }, equipment: { selectedSlot: 1 } });
        },
      });
    },
  };
  const modules = [contentModule, legacyInventory, actions, ...(withRules ? [rules] : [])];
  const pack = definePack({ id: 'test:inventory-pack', version: '1.0.0', kind: 'playbook', modules });
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
    { approvedPermissions: { 'test:inventory-pack': actions.descriptor.permissions! } },
  );
  const projections = new Map<string, ModuleInvocationValue>([
    [JSON.stringify(inventoryActorAddress('alice')), actor('alice')],
    [JSON.stringify(inventoryActorAddress('npc-1')), actor('npc-1', 'npc')],
    [JSON.stringify(inventoryItemAddress('item-1')), item()],
  ]);
  const state: RegisteredStatePort = {
    read(address) {
      const value = projections.get(JSON.stringify(address));
      if (value === undefined) throw new Error(`missing projection ${JSON.stringify(address)}`);
      return { revision: 7, value };
    },
    prepareCommit(_observed, writes, execution) {
      expect(writes).toEqual([]);
      observedCandidates.push(execution.candidateValue);
      return {
        ok: true,
        revision: 7,
        value: execution.candidateValue,
        validate() {},
        apply() {},
      };
    },
    commit() {
      throw new Error('Inventory actions must use the inspected no-write prepare path.');
    },
  };
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [
        { id: 'human', boundEntityId: 'alice' },
        { id: 'npc-script', boundEntityId: 'npc-1' },
      ],
      rules: [
        { effect: 'allow', resources: [INVENTORY_RESOURCE], operations: ['read', 'write', 'execute'], scope: 'self' },
        { effect: 'allow', resources: [INVENTORY_ITEM_RESOURCE], operations: ['read', 'execute'], scope: 'any' },
      ],
    },
    composition.resources,
  );
  const runtime = createRegisteredOperationRuntime({ composition, authorizer, clone: structuredClone, state });
  return {
    composition,
    projections,
    observedCandidates,
    ruleTrace,
    player: runtime.bind({
      moduleId: 'seedlands:inventory-actions-module',
      principalId: 'human',
      originalActorId: 'alice',
    }),
    npc: runtime.bind({
      moduleId: 'seedlands:inventory-actions-module',
      principalId: 'npc-script',
      originalActorId: 'npc-1',
    }),
  };
}

describe('detached inventory action candidates', () => {
  it.each([
    ['select', { slot: 1 }, undefined],
    ['move', { source: 0, target: 2 }, undefined],
    ['consume', { slot: 1 }, undefined],
    ['craft', { recipeId: 'test:planks' }, undefined],
    ['drop', { slot: 0, count: 1 }, undefined],
    ['pickup', undefined, item()],
  ] as const)('uses the same %s semantics for ordinary player and NPC projections', (kind, input, worldItem) => {
    const build = (kindOfActor: InventoryActorProjectionV1['kind']) =>
      buildInventoryActionCandidate(
        content,
        (kind === 'pickup'
          ? { kind, actor: actor('same-actor', kindOfActor), item: worldItem, input }
          : { kind, actor: actor('same-actor', kindOfActor), input }) as InventoryActionCandidateRequest,
      );
    const player = build('player');
    const npc = build('npc');
    expect(npc).toEqual(player);
    expect(Object.isFrozen(player)).toBe(true);
    expect(Object.isFrozen(player.slots)).toBe(true);
    expect(Object.isFrozen(player.result)).toBe(true);
  });

  it('strictly rejects invalid input, missing items, full pickup, and dead actors without changing projections', () => {
    const projection = actor('alice');
    const before = structuredClone(projection);
    expect(() =>
      buildInventoryActionCandidate(content, { kind: 'select', actor: projection, input: { slot: 2 } }),
    ).toThrow('invalid-slot');
    expect(() =>
      buildInventoryActionCandidate(content, { kind: 'drop', actor: projection, input: { slot: 0, count: 3 } }),
    ).toThrow('missing-items');
    expect(() =>
      buildInventoryActionCandidate(content, {
        kind: 'pickup',
        actor: actor('alice', 'player', {
          slots: Array.from({ length: 4 }, () => ({ itemId: 'test:plank', count: 8 })),
        }),
        item: item(),
        input: undefined,
      }),
    ).toThrow('inventory-full');
    expect(() =>
      buildInventoryActionCandidate(content, {
        kind: 'move',
        actor: actor('alice', 'player', { lifecycle: 'dead' }),
        input: { source: 0, target: 2 },
      }),
    ).toThrow('actor-dead');
    expect(() =>
      buildInventoryActionCandidate(content, { kind: 'select', actor: projection, input: { slot: 1, actorId: 'bob' } }),
    ).toThrow('invalid fields');
    expect(projection).toEqual(before);
  });

  it('preserves durable item instances in move, drop, and pickup intents', () => {
    const tool = { itemId: 'test:tool', count: 1, instance: { durability: 6 } } as const;
    const projection = actor('alice', 'player', { slots: [tool, null, null, null] });
    const moved = buildInventoryActionCandidate(content, {
      kind: 'move',
      actor: projection,
      input: { source: 0, target: 2 },
    });
    expect(moved.slots[2]).toEqual(tool);
    const dropped = buildInventoryActionCandidate(content, {
      kind: 'drop',
      actor: projection,
      input: { slot: 0, count: 1 },
    });
    expect(dropped.dropIntent?.stack).toEqual(tool);
    const pickedUp = buildInventoryActionCandidate(content, {
      kind: 'pickup',
      actor: actor('alice', 'player', { slots: [null, null, null, null] }),
      item: item('tool-item', tool),
      input: undefined,
    });
    expect(pickedUp.pickupIntent?.stack).toEqual(tool);
    expect(pickedUp.slots[0]).toEqual(tool);
  });

  it('emits the same immutable pickup intent for a duplicate snapshot and leaves both snapshots untouched', () => {
    const actorProjection = actor('alice');
    const itemProjection = item();
    const before = structuredClone({ actorProjection, itemProjection });
    const first = buildInventoryActionCandidate(content, {
      kind: 'pickup',
      actor: actorProjection,
      item: itemProjection,
      input: undefined,
    });
    const duplicate = buildInventoryActionCandidate(content, {
      kind: 'pickup',
      actor: actorProjection,
      item: itemProjection,
      input: undefined,
    });
    expect(duplicate).toEqual(first);
    expect(duplicate.pickupIntent?.reference).toEqual(itemProjection.reference);
    expect({ actorProjection, itemProjection }).toEqual(before);
  });
});

describe('registered inventory action module', () => {
  it('registers separate actor and item projections and returns no-write candidates for actor and pickup targets', () => {
    const world = setup();
    expect(world.composition.registrations.states.map(({ definition }) => definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: INVENTORY_ACTOR_COMPONENT, resource: INVENTORY_RESOURCE }),
        expect.objectContaining({ id: INVENTORY_ITEM_COMPONENT, resource: INVENTORY_ITEM_RESOURCE }),
      ]),
    );
    expect(
      world.player.invoke({
        operationId: 'seedlands:inventory-move',
        target: { kind: 'entity', entityId: 'alice' },
        input: { source: 0, target: 2 },
      }),
    ).toMatchObject({ ok: true, value: { kind: 'move', actorId: 'alice', args: { source: 0, target: 2 } } });
    expect(
      world.player.invoke({
        operationId: 'seedlands:inventory-pickup',
        target: { kind: 'entity', entityId: 'item-1' },
      }),
    ).toMatchObject({
      ok: true,
      value: { kind: 'pickup', actorId: 'alice', pickupIntent: { reference: { entityId: 'item-1' } } },
    });
    expect(world.observedCandidates).toHaveLength(2);
  });

  it('keeps actor inventory authorization self-scoped while allowing pickup of an item target', () => {
    const world = setup();
    expect(
      world.player.invoke({
        operationId: 'seedlands:inventory-move',
        target: { kind: 'entity', entityId: 'npc-1' },
        input: { source: 0, target: 2 },
      }),
    ).toMatchObject({ ok: false });
    expect(
      world.player.invoke({
        operationId: 'seedlands:inventory-pickup',
        target: { kind: 'entity', entityId: 'item-1' },
      }),
    ).toMatchObject({ ok: true });
    world.projections.set(JSON.stringify(inventoryActorAddress('alice')), actor('forged-actor'));
    expect(
      world.player.invoke({
        operationId: 'seedlands:inventory-select',
        target: { kind: 'entity', entityId: 'alice' },
        input: { slot: 1 },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
  });

  it('runs before transformations and after validation around the frozen no-write candidate', () => {
    const world = setup(true);
    const result = world.player.invoke({
      operationId: 'seedlands:inventory-select',
      target: { kind: 'entity', entityId: 'alice' },
      input: { slot: 0 },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result).toMatchObject({ ok: true, value: { args: { slot: 1 }, equipment: { selectedSlot: 1 } } });
    expect(world.ruleTrace).toEqual(['before', 'after']);
  });
});
