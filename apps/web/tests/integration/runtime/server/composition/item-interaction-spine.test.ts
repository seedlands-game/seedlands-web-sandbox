import { expect, it } from 'vitest';
import {
  defineContentModule,
  defineInventoryModule,
  defineItemInteractionModule,
  definePack,
  type ItemInteractionDefinition,
  type ModModule,
} from '@seedlands/stdlib/mod-api';
import { assembleProductPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { buildingModules } from '../../../../fixtures/packs/builder/building-content';
import { pack as clicked } from '../../../../fixtures/packs/builder/click-conversion';

const artifact = (pack: ReturnType<typeof definePack>): VerifiedPackArtifact => ({
  ...pack,
  integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
});
const approved = (candidate: VerifiedPackArtifact) => ({
  id: candidate.manifest.id,
  version: candidate.manifest.version,
  integrity: candidate.integrity,
  permissions: candidate.modules.flatMap((module) => module.descriptor.permissions ?? []),
});
const handler = (executionKind: 'actor' | 'system' = 'actor'): ModModule => ({
  descriptor: {
    id: 'sample:fixture-handler',
    version: '1.0.0',
    permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
  },
  register(api) {
    api.registerOperation({
      id: 'sample:fixture-operation',
      resource: 'seedlands.inventory',
      ...(executionKind === 'system' ? { executionKind } : {}),
      run: () => ({ success: true }),
    } as never);
  },
});
const binding = (overrides: Partial<ItemInteractionDefinition> = {}): ItemInteractionDefinition => ({
  id: 'sample:fixture-binding',
  selector: { itemId: 'sample:wood' },
  trigger: 'self',
  operationId: 'sample:fixture-operation',
  presentationKey: 'sample:fixture',
  ...overrides,
});
const assembleFixture = (
  definitions: readonly ItemInteractionDefinition[],
  options: { system?: boolean; permissions?: 'correct' | 'wrong' | 'none' } = {},
) => {
  const candidate = definePack({
    id: 'sample:item-interaction-fixture',
    version: '1.0.0',
    kind: 'playbook',
    modules: [
      ...buildingModules(false),
      handler(options.system ? 'system' : 'actor'),
      defineItemInteractionModule({
        moduleId: 'sample:fixture-interactions',
        definitions,
        permissions:
          options.permissions === 'none'
            ? []
            : [
                {
                  resource: options.permissions === 'wrong' ? 'world.entity' : 'seedlands.inventory',
                  operations: ['execute'],
                },
              ],
      }),
    ],
  });
  const verified = artifact(candidate);
  return assembleProductPacks([verified], { approvedPlaybook: approved(verified) });
};

const assembleFluidPolicyFixture = (input: Readonly<{ fluid: 'empty' | 'water'; trigger?: 'self' | 'voxel' }>) => {
  const candidate = definePack({
    id: 'sample:fluid-policy-fixture',
    version: '1.0.0',
    kind: 'playbook',
    modules: [
      defineContentModule({
        moduleId: 'sample:fluid-policy-content',
        items: [
          {
            id: 'sample:container',
            name: 'Container',
            itemType: 'resource',
            stackLimit: 1,
            capabilities: [{ type: 'fluid-container', fluid: input.fluid }],
          },
        ],
        recipes: [],
        meleeDefinitions: [],
      }),
      defineInventoryModule(),
      handler(),
      defineItemInteractionModule({
        moduleId: 'sample:fluid-policy-interactions',
        permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
        definitions: [
          {
            id: 'sample:fluid-policy-binding',
            selector: { itemId: 'sample:container' },
            trigger: input.trigger ?? 'voxel',
            operationId: 'sample:fixture-operation',
            presentationKey: 'sample:fluid-policy',
            voxelHitPolicy: 'fluid-source',
          },
        ],
      }),
    ],
  });
  const verified = artifact(candidate);
  return assembleProductPacks([verified], { approvedPlaybook: approved(verified) });
};

it('dispatches a non-Classic selected-item interaction without accepting an operation id from the action', async () => {
  const verified = artifact(clicked);
  const session = await HeadlessSession.create({
    seedText: 'non-classic-item-interaction',
    platform: testCorePlatform,
    createComposition: () => assembleProductPacks([verified], { approvedPlaybook: approved(verified) }),
  });
  try {
    await session.world.clock({ kind: 'pause' });
    const playerId = session.runtime.playerId;
    session.runtime.server.giveItem(playerId, { itemId: 'sample:wood', count: 1 });
    const inventory = session.runtime.server.getInventoryPointerView(playerId);
    await expect(
      session.runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'self' },
        expectedSelection: {
          inventoryRevision: inventory.revision,
          modeRevision: 0,
          creativeCatalogRevision: 0,
          selectedSlot: 0,
        },
      }),
    ).resolves.toMatchObject({
      result: {
        success: true,
        handled: true,
        bindingId: 'sample:inspect-wood',
        presentationKey: 'sample:inspect',
        value: { success: true, actorId: playerId, targetKind: 'entity' },
      },
    });
  } finally {
    await session.dispose();
  }
});

it('rejects an unbound item and a stale inventory revision without changing state', async () => {
  const verified = artifact(clicked);
  const session = await HeadlessSession.create({
    seedText: 'non-classic-item-interaction-rejections',
    platform: testCorePlatform,
    createComposition: () => assembleProductPacks([verified], { approvedPlaybook: approved(verified) }),
  });
  try {
    await session.world.clock({ kind: 'pause' });
    const playerId = session.runtime.playerId;
    const empty = session.runtime.server.getInventoryPointerView(playerId);
    await expect(
      session.runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'self' },
        expectedSelection: {
          inventoryRevision: empty.revision,
          modeRevision: 0,
          creativeCatalogRevision: 0,
          selectedSlot: 0,
        },
      }),
    ).resolves.toMatchObject({ result: { success: false, reason: 'no-selected-item' } });
    expect(session.runtime.server.getInventoryPointerView(playerId)).toEqual(empty);

    session.runtime.server.giveItem(playerId, { itemId: 'sample:stone', count: 1 });
    const before = session.runtime.server.getInventoryPointerView(playerId);
    const gameplayRevision = session.runtime.server.gameplayRevision;
    await expect(
      session.runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'self' },
        expectedSelection: {
          inventoryRevision: before.revision,
          modeRevision: 0,
          creativeCatalogRevision: 0,
          selectedSlot: 0,
        },
      }),
    ).resolves.toMatchObject({ result: { success: false, reason: 'item-no-interaction' } });
    expect(session.runtime.server.getInventoryPointerView(playerId)).toEqual(before);
    expect(session.runtime.server.gameplayRevision).toBe(gameplayRevision);

    await expect(
      session.runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'self' },
        expectedSelection: {
          inventoryRevision: before.revision + 1,
          modeRevision: 0,
          creativeCatalogRevision: 0,
          selectedSlot: 0,
        },
      }),
    ).resolves.toMatchObject({ result: { success: false, reason: 'stale-selection' } });
    expect(session.runtime.server.getInventoryPointerView(playerId)).toEqual(before);
    expect(session.runtime.server.gameplayRevision).toBe(gameplayRevision);

    expect(session.runtime.server.applyDamage('fixture', playerId, 100, 'fixture')).toEqual({ success: true });
    const dead = session.runtime.server.getInventoryPointerView(playerId);
    await expect(
      session.runtime.performAction({
        type: 'interact',
        intent: 'use',
        target: { kind: 'self' },
        expectedSelection: {
          inventoryRevision: dead.revision,
          modeRevision: 0,
          creativeCatalogRevision: 0,
          selectedSlot: 0,
        },
      }),
    ).resolves.toMatchObject({ result: { success: false, reason: 'player-dead' } });
    expect(session.runtime.server.getInventoryPointerView(playerId)).toEqual(dead);
  } finally {
    await session.dispose();
  }
});

it.each([
  ['unknown item', [binding({ selector: { itemId: 'sample:missing' } })], {}, /unknown item/i],
  ['missing operation', [binding({ operationId: 'sample:missing-operation' })], {}, /operation is missing/i],
  [
    'duplicate id',
    [binding(), binding({ selector: { itemId: 'sample:stone' }, trigger: 'entity' })],
    {},
    /duplicate item interaction/i,
  ],
  [
    'duplicate trigger',
    [binding(), binding({ id: 'sample:second-binding' })],
    {},
    /item.*trigger|interaction.*conflict/i,
  ],
  ['wrong resource execute permission', [binding()], { permissions: 'wrong' }, /execute permission/i],
  ['system operation', [binding()], { system: true }, /actor-executable/i],
] as const)('rejects %s while freezing item interactions', (_name, definitions, options, message) => {
  expect(() => assembleFixture(definitions, options)).toThrow(message);
});

it('freezes fluid-source only for voxel interactions selected by an empty fluid container', () => {
  expect(
    assembleFluidPolicyFixture({ fluid: 'empty' })
      .capability<import('@seedlands/stdlib/mod-api').ItemInteractionRegistryV1>('seedlands:item-interactions')
      .list(),
  ).toEqual([
    expect.objectContaining({
      definition: expect.objectContaining({ voxelHitPolicy: 'fluid-source' }),
      itemId: 'sample:container',
    }),
  ]);
  expect(() => assembleFluidPolicyFixture({ fluid: 'water' })).toThrow(/empty fluid-container/i);
  expect(() => assembleFluidPolicyFixture({ fluid: 'empty', trigger: 'self' })).toThrow(/voxel.*policy/i);
  expect(() =>
    defineItemInteractionModule({
      moduleId: 'sample:invalid-fluid-policy',
      definitions: [
        {
          ...binding({ trigger: 'voxel' }),
          voxelHitPolicy: 'client-choice',
        } as unknown as ItemInteractionDefinition,
      ],
    }),
  ).toThrow(/voxel hit policy/i);
});

it('rejects extra fields and accessors instead of copying untrusted interaction definitions', () => {
  expect(() =>
    defineItemInteractionModule({
      moduleId: 'sample:extra-field-interaction',
      definitions: [{ ...binding(), extra: true } as unknown as ItemInteractionDefinition],
    }),
  ).toThrow(/fields/i);

  let accessed = false;
  const accessor = { ...binding({ trigger: 'voxel' }) } as Record<string, unknown>;
  Object.defineProperty(accessor, 'voxelHitPolicy', {
    enumerable: true,
    get() {
      accessed = true;
      return 'fluid-source';
    },
  });
  expect(() =>
    defineItemInteractionModule({
      moduleId: 'sample:accessor-interaction',
      definitions: [accessor as unknown as ItemInteractionDefinition],
    }),
  ).toThrow(/fields/i);
  expect(accessed).toBe(false);
});
