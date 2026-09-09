import { describe, expect, it } from 'vitest';
import { definePack, type ModModule, type ModuleInvocationValue } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, createRegisteredOperationRuntime } from '@seedlands/game-core/server/composition/host-api';
import type { RegisteredStatePort } from '../../../packages/game-core/src/server/composition/operation-contracts';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { createGameplayContent } from '../../../packages/game-core/src/server/gameplay/gameplay-content';
import { defineContentModule } from '../../../packages/game-core/src/server/gameplay/modules/content-module';
import {
  BLOCK_ACTOR_COMPONENT,
  BLOCK_ACTOR_RESOURCE,
  BLOCK_CLOCK_RESOURCE,
  BLOCK_PARTITIONS,
  BLOCK_VOXEL_COMPONENT,
  BLOCK_VOXEL_RESOURCE,
  BLOCK_WORLD_COMPONENT,
  blockActorAddress,
  blockVoxelAddress,
  blockWorldAddress,
  validateBlockWorldProjection,
  type BlockActorProjectionV1,
  type BlockBreakActionV1,
  type BlockVoxelProjectionV1,
} from '../../../packages/game-core/src/server/gameplay/modules/block-action-model';
import {
  buildBlockActionCandidate,
  buildBlockAdvanceUpdates,
  defineBlockActionsModule,
} from '../../../packages/game-core/src/server/gameplay/modules/block-actions-module';
import { defineBlockRulesModule } from '../../../packages/game-core/src/server/gameplay/modules/block-rules-module';
import { Voxel } from '../../../packages/game-core/src/world/voxel';

const itemDefinitions = [
  {
    id: 'test:dirt-block',
    storageId: 'dirt-block',
    name: 'Dirt',
    itemType: 'block' as const,
    stackLimit: 8,
    capabilities: [{ type: 'place' as const, voxel: Voxel.Dirt }],
  },
  {
    id: 'test:stone-block',
    storageId: 'stone-block',
    name: 'Stone',
    itemType: 'block' as const,
    stackLimit: 8,
    capabilities: [],
  },
  {
    id: 'test:pickaxe',
    name: 'Pickaxe',
    itemType: 'tool' as const,
    stackLimit: 1,
    capabilities: [{ type: 'mine' as const, tool: 'pickaxe' as const, multiplier: 6 }],
  },
] as const;
const content = createGameplayContent({
  items: itemDefinitions.map((definition) => ({
    ...definition,
    id: 'storageId' in definition ? definition.storageId : definition.id,
  })),
  recipes: [],
  meleeDefinitions: [],
});
const position = [2, 3, 4] as const;
const origin = {
  version: 1 as const,
  principalSubject: 'test:alice',
  provenance: { packId: 'test:block-pack', moduleId: 'seedlands:block-actions-module' },
  originalActor: { entityId: 'alice', lifetime: 4 },
};
const breakAction = (overrides: Partial<BlockBreakActionV1> = {}): BlockBreakActionV1 => ({
  position,
  voxel: Voxel.Stone,
  elapsedSeconds: 0.2,
  requiredSeconds: 0.4,
  origin,
  ...overrides,
});
const actor = (overrides: Partial<BlockActorProjectionV1> = {}): BlockActorProjectionV1 => ({
  version: 1,
  reference: { entityId: 'alice', epoch: 2, lifetime: 4 },
  kind: 'player',
  position: [...position],
  lifecycle: 'alive',
  mode: { value: 'survival', revision: 3 },
  slots: [{ itemId: 'test:pickaxe', count: 1 }, { itemId: 'dirt-block', count: 2 }, null, null],
  equipment: { selectedSlot: 0, hotbarSize: 2 },
  creativeCatalog: { hotbar: ['dirt-block', null], selectedSlot: 0 },
  breakAction: null,
  ...overrides,
});
const voxel = (value: number = Voxel.Stone): BlockVoxelProjectionV1 => ({ version: 1, position, voxel: value });

function setup(
  options: {
    rules?: boolean;
    veto?: boolean;
    actor?: BlockActorProjectionV1;
    voxel?: number;
    rulesModule?: ModModule;
  } = {},
) {
  const contentModule = defineContentModule({
    moduleId: 'test:content',
    items: itemDefinitions,
    recipes: [],
    meleeDefinitions: [],
  });
  const actions = defineBlockActionsModule();
  const rules = options.rulesModule ?? defineBlockRulesModule({ moduleId: 'test:default-block-rules' });
  const veto: ModModule = {
    descriptor: {
      id: 'test:block-veto',
      version: '1.0.0',
      requires: [{ id: 'seedlands:block-actions', version: '1.0.0' }],
      permissions: [{ resource: BLOCK_VOXEL_RESOURCE, operations: ['read', 'execute'] }],
    },
    register(api) {
      api.registerRule({
        id: 'test:block-veto/place',
        operationId: 'seedlands:block-place',
        stage: 'after',
        apply: () => ({ reject: 'test-veto' }),
      });
    },
  };
  const modules = [
    contentModule,
    actions,
    ...(options.rules === false ? [] : [rules]),
    ...(options.veto ? [veto] : []),
  ];
  const pack = definePack({ id: 'test:block-pack', version: '1.0.0', kind: 'playbook', modules });
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
    { approvedPermissions: { 'test:block-pack': actions.descriptor.permissions! } },
  );
  const actorProjection = options.actor ?? actor();
  const voxelProjection = voxel(options.voxel);
  const projections = new Map<string, ModuleInvocationValue>([
    [JSON.stringify(blockActorAddress('alice')), actorProjection],
    [JSON.stringify(blockVoxelAddress(position)), voxelProjection],
  ]);
  for (let partition = 0; partition < BLOCK_PARTITIONS; partition++)
    projections.set(JSON.stringify(blockWorldAddress(partition)), {
      version: 1,
      partition,
      entries:
        partition === 0 ? [{ reference: actorProjection.reference, breakAction: actorProjection.breakAction }] : [],
    });
  const candidates: ModuleInvocationValue[] = [];
  const state: RegisteredStatePort = {
    read(address) {
      const value = projections.get(JSON.stringify(address));
      if (value === undefined) throw new Error(`missing projection ${JSON.stringify(address)}`);
      return { revision: 5, value };
    },
    prepareCommit(_observed, writes, execution) {
      expect(writes).toEqual([]);
      candidates.push(execution.candidateValue);
      return {
        ok: true,
        revision: 5,
        value: execution.candidateValue,
        validate() {},
        apply() {},
      };
    },
    commit() {
      throw new Error('Block candidates must use inspected prepareCommit.');
    },
  };
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [
        { id: 'human', subject: 'test:alice', boundEntityId: 'alice' },
        { id: 'clock', subject: 'test:block-clock', kind: 'system' },
      ],
      rules: [
        { effect: 'allow', resources: [BLOCK_ACTOR_RESOURCE], operations: ['read', 'execute'], scope: 'self' },
        { effect: 'allow', resources: [BLOCK_VOXEL_RESOURCE], operations: ['read', 'execute'], scope: 'any' },
        { effect: 'allow', resources: [BLOCK_CLOCK_RESOURCE], operations: ['read', 'execute'], scope: 'any' },
      ],
    },
    composition.resources,
  );
  const runtime = createRegisteredOperationRuntime({ composition, authorizer, clone: structuredClone, state });
  return {
    composition,
    projections,
    candidates,
    actor: runtime.bind({
      moduleId: 'seedlands:block-actions-module',
      principalId: 'human',
      originalActorId: 'alice',
    }),
    system: runtime.bind({
      kind: 'system',
      moduleId: 'seedlands:block-actions-module',
      principalId: 'clock',
      systemId: 'seedlands:block-system',
    }),
  };
}

describe('pure Block candidates', () => {
  it('retains progress and durable origin when beginning the same survival target', () => {
    const current = breakAction();
    const candidate = buildBlockActionCandidate(content, {
      kind: 'begin',
      actor: actor({ breakAction: current }),
      voxel: voxel(),
      input: {
        position,
        expectedVoxel: Voxel.Stone,
        creative: false,
        requiredSeconds: 0.4,
        modeRevision: 3,
      },
    });
    expect(candidate).toMatchObject({
      kind: 'begin',
      actorId: 'alice',
      breakAction: current,
      voxelEdit: null,
      result: { success: true, requiredSeconds: 0.4 },
    });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.breakAction)).toBe(true);
    expect(candidate.breakAction && Object.isFrozen(candidate.breakAction.origin)).toBe(true);
  });

  it('keeps creative inventory while survival placement consumes exactly one selected item', () => {
    const creative = setup({
      actor: actor({
        mode: { value: 'creative', revision: 4 },
        slots: [{ itemId: 'dirt-block', count: 2 }, null, null, null],
      }),
      voxel: Voxel.Air,
    });
    const creativeResult = creative.actor.invoke({
      operationId: 'seedlands:block-place',
      target: { kind: 'voxel', position },
      input: { position },
    });
    expect(creativeResult).toMatchObject({
      ok: true,
      value: {
        kind: 'place',
        slots: [{ itemId: 'dirt-block', count: 2 }, null, null, null],
        voxelEdit: { position, fromVoxel: Voxel.Air, toVoxel: Voxel.Dirt },
      },
    });

    const survival = setup({
      actor: actor({
        slots: [{ itemId: 'dirt-block', count: 2 }, null, null, null],
        equipment: { selectedSlot: 0, hotbarSize: 2 },
      }),
      voxel: Voxel.Air,
    });
    expect(
      survival.actor.invoke({
        operationId: 'seedlands:block-place',
        target: { kind: 'voxel', position },
        input: { position },
      }),
    ).toMatchObject({
      ok: true,
      value: { kind: 'place', slots: [{ itemId: 'dirt-block', count: 1 }, null, null, null] },
    });
  });

  it('advances the break state, then finish clears it and cannot finish an updated empty state twice', () => {
    const current = breakAction();
    const world = setup({ actor: actor({ breakAction: current }) });
    const advanced = world.system.invoke({
      operationId: 'seedlands:block-advance',
      target: { kind: 'world' },
      input: { seconds: 0.2 },
    });
    expect(advanced).toMatchObject({
      ok: true,
      value: { kind: 'advance', seconds: 0.2, cancelActorIds: [] },
    });
    const updates = buildBlockAdvanceUpdates([{ reference: actor().reference, breakAction: current }], {
      seconds: 0.2,
      cancelActorIds: [],
    });
    expect(updates).toMatchObject([
      { reference: { entityId: 'alice' }, previous: current, next: { elapsedSeconds: 0.4 }, ready: true },
    ]);
    const next = updates[0]!.next;
    expect(next).not.toBeNull();
    world.projections.set(JSON.stringify(blockActorAddress('alice')), actor({ breakAction: next }));
    const finished = world.actor.invoke({
      operationId: 'seedlands:block-finish',
      target: { kind: 'voxel', position },
      input: { position },
    });
    if (!finished.ok) throw new Error(JSON.stringify(finished));
    expect(finished).toMatchObject({
      ok: true,
      value: {
        kind: 'finish',
        breakAction: null,
        voxelEdit: { position, fromVoxel: Voxel.Stone, toVoxel: Voxel.Air },
        dropIntent: { position: [2.5, 3.5, 4.5], stack: { itemId: 'stone-block', count: 1 } },
      },
    });
    world.projections.set(JSON.stringify(blockActorAddress('alice')), actor({ breakAction: null }));
    world.projections.set(JSON.stringify(blockVoxelAddress(position)), voxel(Voxel.Air));
    expect(
      world.actor.invoke({
        operationId: 'seedlands:block-finish',
        target: { kind: 'voxel', position },
        input: { position },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
  });

  it('finishes bare-hand stone on the same threshold for fractional and bulk clocks', () => {
    const initial = breakAction({ elapsedSeconds: 0, requiredSeconds: 2.4 });
    const advance = (current: BlockBreakActionV1, seconds: number) =>
      buildBlockAdvanceUpdates([{ reference: actor().reference, breakAction: current }], { seconds })[0]!;
    let current = initial;
    for (let frame = 0; frame < 47; frame++) {
      const update = advance(current, 0.05);
      expect(update.ready).toBe(false);
      current = update.next!;
    }
    const fractional = advance(current, 0.05);
    const bulk = [0.8, 0.8, 0.8].reduce((state, seconds) => advance(state, seconds).next!, initial);
    expect(fractional.next).toEqual(bulk);
    expect(fractional.ready).toBe(true);
  });

  it('snapshots nested rule drops before assembly and caller mutation', () => {
    const drop = { itemId: 'stone-block', count: 1 };
    const rulesModule = defineBlockRulesModule({
      moduleId: 'test:default-block-rules',
      voxelDefinitions: [
        { voxel: Voxel.Stone, hardnessSeconds: 2.4, preferredTool: 'pickaxe', drop, replaceable: false },
      ],
    });
    drop.itemId = 'dirt-block';
    drop.count = 2;
    const world = setup({ rulesModule, actor: actor({ breakAction: breakAction({ elapsedSeconds: 0.4 }) }) });
    expect(
      world.actor.invoke({
        operationId: 'seedlands:block-finish',
        target: { kind: 'voxel', position },
        input: { position },
      }),
    ).toMatchObject({ ok: true, value: { dropIntent: { stack: { itemId: 'stone-block', count: 1 } } } });
  });

  it('supports bounded explicit clock cancellation and rejects duplicates', () => {
    const world = setup({ actor: actor({ breakAction: breakAction() }) });
    expect(
      world.system.invoke({
        operationId: 'seedlands:block-advance',
        target: { kind: 'world' },
        input: { seconds: 0, cancelActorIds: ['alice'] },
      }),
    ).toMatchObject({
      ok: true,
      value: { kind: 'advance', seconds: 0, cancelActorIds: ['alice'] },
    });
    expect(
      buildBlockAdvanceUpdates([{ reference: actor().reference, breakAction: breakAction() }], {
        seconds: 0,
        cancelActorIds: ['alice'],
      }),
    ).toMatchObject([{ reference: { entityId: 'alice' }, previous: expect.any(Object), next: null, ready: false }]);
    expect(
      world.system.invoke({
        operationId: 'seedlands:block-advance',
        target: { kind: 'world' },
        input: { seconds: 0, cancelActorIds: ['alice', 'alice'] },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
  });
});

describe('registered Block operations and rules', () => {
  it('registers independent resources and uses the exact bound actor and voxel target', () => {
    const world = setup();
    expect(world.composition.registrations.states.map(({ definition }) => definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: BLOCK_ACTOR_COMPONENT, resource: BLOCK_ACTOR_RESOURCE }),
        expect.objectContaining({ id: BLOCK_VOXEL_COMPONENT, resource: BLOCK_VOXEL_RESOURCE }),
        expect.objectContaining({ id: BLOCK_WORLD_COMPONENT, resource: BLOCK_CLOCK_RESOURCE }),
      ]),
    );
    expect(
      world.actor.invoke({
        operationId: 'seedlands:block-begin',
        target: { kind: 'voxel', position },
        input: { position },
      }),
    ).toMatchObject({ ok: true, value: { kind: 'begin', actorId: 'alice', result: { requiredSeconds: 0.4 } } });
    expect(
      world.actor.invoke({
        operationId: 'seedlands:block-begin',
        target: { kind: 'voxel', position: [3, 3, 4] },
        input: { position },
      }),
    ).toMatchObject({ ok: false });
  });

  it('strictly rejects extra fields, fractional coordinates, duplicate world entries, and missing rules', () => {
    const world = setup();
    expect(
      world.actor.invoke({
        operationId: 'seedlands:block-begin',
        target: { kind: 'voxel', position },
        input: { position, voxel: 999 },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    expect(
      world.actor.invoke({
        operationId: 'seedlands:block-place',
        target: { kind: 'voxel', position: [2.5, 3, 4] },
        input: { position: [2.5, 3, 4] },
      }),
    ).toMatchObject({ ok: false });
    expect(() =>
      validateBlockWorldProjection({
        version: 1,
        partition: 0,
        entries: [
          { reference: actor().reference, breakAction: null },
          { reference: actor().reference, breakAction: null },
        ],
      }),
    ).toThrow();
    const missing = setup({ rules: false });
    expect(
      missing.actor.invoke({
        operationId: 'seedlands:block-begin',
        target: { kind: 'voxel', position },
        input: { position },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
  });

  it('lets an ordinary after rule veto discard the candidate without state writes', () => {
    const world = setup({
      veto: true,
      voxel: Voxel.Air,
      actor: actor({
        slots: [{ itemId: 'dirt-block', count: 2 }, null, null, null],
        equipment: { selectedSlot: 0, hotbarSize: 2 },
      }),
    });
    const result = world.actor.invoke({
      operationId: 'seedlands:block-place',
      target: { kind: 'voxel', position },
      input: { position },
    });
    if (!result.ok && result.code === 'OPERATION_FAILED') throw new Error(JSON.stringify(result));
    expect(result).toMatchObject({ ok: false, code: 'RULE_REJECTED' });
    expect(world.candidates).toHaveLength(0);
  });
});
