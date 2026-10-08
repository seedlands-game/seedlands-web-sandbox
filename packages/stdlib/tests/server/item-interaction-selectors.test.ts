import { expect, it } from 'vitest';
import {
  defineContentModule,
  defineInventoryModule,
  defineItemInteractionModule,
  definePack,
  type ItemInteractionDefinition,
  type ModItemDefinition,
  type ModModule,
} from '../../src/server/composition/mod-api';
import { assembleProductPacks } from '../../src/server/composition/product-playbooks';
import type { VerifiedPackArtifact } from '../../src/server/composition/contracts';

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

const defaultItems: readonly ModItemDefinition[] = [
  {
    id: 'sample:hoe-one',
    storageId: 'sample:stored-hoe-one',
    name: 'Hoe One',
    stackLimit: 1,
    capabilities: [{ type: 'till' }],
  },
  { id: 'sample:hoe-two', name: 'Hoe Two', stackLimit: 1, capabilities: [{ type: 'till' }] },
  { id: 'sample:stone', name: 'Stone', stackLimit: 64, capabilities: [] },
];

const content = (items: readonly ModItemDefinition[] = defaultItems) =>
  defineContentModule({
    moduleId: 'sample:till-content',
    items,
    meleeDefinitions: [],
  });

const operation: ModModule = {
  descriptor: {
    id: 'sample:till-handler',
    version: '1.0.0',
    permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
  },
  register(api) {
    api.registerOperation({
      id: 'sample:till-operation',
      resource: 'seedlands.inventory',
      run: () => ({ success: true }),
    });
  },
};

const assembleCapabilitySelector = (
  definitions: readonly ItemInteractionDefinition[] = [
    {
      id: 'sample:till-binding',
      selector: { capability: 'till' },
      trigger: 'self',
      operationId: 'sample:till-operation',
      presentationKey: 'sample:till',
    } as unknown as ItemInteractionDefinition,
  ],
  items: readonly ModItemDefinition[] = defaultItems,
  afterModuleSnapshot?: () => void,
) => {
  const permissions = [{ resource: 'seedlands.inventory', operations: ['execute'] as const }];
  const deferredInteractions: ModModule = {
    descriptor: {
      id: 'sample:till-interactions',
      version: '1.0.0',
      provides: [{ id: 'seedlands:item-interactions', version: '1.0.0' }],
      permissions,
    },
    register(api) {
      // Defer construction into the real pack registration lifecycle so this
      // exercises composition's item-definition freeze, not a private registry.
      const module = defineItemInteractionModule({
        moduleId: 'sample:till-interactions',
        definitions,
        permissions,
      });
      afterModuleSnapshot?.();
      module.register(api);
    },
  };
  const candidate = definePack({
    id: 'sample:till-selector-pack',
    version: '1.0.0',
    kind: 'playbook',
    modules: [content(items), defineInventoryModule(), operation, deferredInteractions],
  });
  const verified = artifact(candidate);
  return assembleProductPacks([verified], { approvedPlaybook: approved(verified) });
};

const selectorDefinition = (
  id: string,
  selector: unknown,
  overrides: Partial<ItemInteractionDefinition> = {},
): ItemInteractionDefinition =>
  ({
    id,
    selector,
    trigger: 'self',
    operationId: 'sample:till-operation',
    presentationKey: 'sample:till',
    ...overrides,
  }) as unknown as ItemInteractionDefinition;

it('expands a capability selector through the real Pack composition registry', () => {
  const composition = assembleCapabilitySelector();
  const registry =
    composition.capability<import('../../src/server/composition/mod-api').ItemInteractionRegistryV1>(
      'seedlands:item-interactions',
    );

  expect(registry.list().map(({ definition, itemId }) => [definition.id, itemId])).toEqual([
    ['sample:till-binding', 'sample:hoe-two'],
    ['sample:till-binding', 'sample:stored-hoe-one'],
  ]);
  expect(registry.resolve('sample:stored-hoe-one', 'self')).toMatchObject({ itemId: 'sample:stored-hoe-one' });
  expect(registry.resolve('sample:hoe-two', 'self')).toMatchObject({ itemId: 'sample:hoe-two' });
  expect(registry.resolve('sample:stone', 'self')).toBeNull();
  expect(Object.isFrozen(registry.list())).toBe(true);
  expect(Object.isFrozen(registry.list()[0]!.definition.selector)).toBe(true);
});

it('orders expanded bindings by definition id and then canonical storage item id', () => {
  const composition = assembleCapabilitySelector([
    selectorDefinition('sample:z-till-self', { capability: 'till' }),
    selectorDefinition('sample:a-till-voxel', { capability: 'till' }, { trigger: 'voxel' }),
  ]);
  const registry =
    composition.capability<import('../../src/server/composition/mod-api').ItemInteractionRegistryV1>(
      'seedlands:item-interactions',
    );

  expect(registry.list().map(({ definition, itemId }) => [definition.id, itemId])).toEqual([
    ['sample:a-till-voxel', 'sample:hoe-two'],
    ['sample:a-till-voxel', 'sample:stored-hoe-one'],
    ['sample:z-till-self', 'sample:hoe-two'],
    ['sample:z-till-self', 'sample:stored-hoe-one'],
  ]);
});

it('freezes a detached selector snapshot before Pack registration completes', () => {
  const rawSelector = { capability: 'till' };
  const composition = assembleCapabilitySelector(
    [selectorDefinition('sample:detached-till', rawSelector)],
    defaultItems,
    () => {
      rawSelector.capability = 'mine';
    },
  );
  const registry =
    composition.capability<import('../../src/server/composition/mod-api').ItemInteractionRegistryV1>(
      'seedlands:item-interactions',
    );

  expect(registry.list().map(({ itemId }) => itemId)).toEqual(['sample:hoe-two', 'sample:stored-hoe-one']);
  expect(registry.list()[0]!.definition.selector).toEqual({ capability: 'till' });
});

it.each([
  [
    'unknown item',
    [selectorDefinition('sample:unknown-item', { itemId: 'sample:missing' })],
    defaultItems,
    /unknown item/i,
  ],
  [
    'unmatched capability',
    [selectorDefinition('sample:missing-capability', { capability: 'not-a-capability' })],
    defaultItems,
    /matches no item/i,
  ],
])('rejects %s when the Pack registry freezes', (_label, definitions, items, expected) => {
  expect(() => assembleCapabilitySelector(definitions, items)).toThrow(expected);
});

it('fails closed when an item selector overlaps an expanded capability selector', () => {
  expect(() =>
    assembleCapabilitySelector([
      selectorDefinition('sample:all-till', { capability: 'till' }),
      selectorDefinition('sample:specific-hoe', { itemId: 'sample:hoe-one' }),
    ]),
  ).toThrow(/item\/trigger conflict/i);
});

it('rejects two capability bindings that would claim the same item and trigger', () => {
  expect(() =>
    assembleCapabilitySelector([
      selectorDefinition('sample:first-till', { capability: 'till' }),
      selectorDefinition('sample:second-till', { capability: 'till' }),
    ]),
  ).toThrow(/item\/trigger conflict/i);
});

it('fails closed on storageId aliases before they can produce ambiguous interaction keys', () => {
  const items: readonly ModItemDefinition[] = [
    ...defaultItems,
    { id: 'sample:stored-hoe-one', name: 'Alias collision', stackLimit: 1, capabilities: [] },
  ];
  expect(() =>
    assembleCapabilitySelector(
      [
        selectorDefinition('sample:all-till', { capability: 'till' }),
        selectorDefinition('sample:storage-id-lookup', { itemId: 'sample:stored-hoe-one' }),
      ],
      items,
    ),
  ).toThrow(/duplicate item storage ID/i);
});

it('does not let a fluid-source policy expand through the fluid-container capability', () => {
  const items: readonly ModItemDefinition[] = [
    {
      id: 'sample:empty-container',
      name: 'Empty container',
      stackLimit: 1,
      capabilities: [{ type: 'fluid-container', fluid: 'empty' }],
    },
    {
      id: 'sample:water-container',
      name: 'Water container',
      stackLimit: 1,
      capabilities: [{ type: 'fluid-container', fluid: 'water' }],
    },
  ];
  expect(() =>
    assembleCapabilitySelector(
      [
        selectorDefinition(
          'sample:fluid-source',
          { capability: 'fluid-container' },
          { trigger: 'voxel', voxelHitPolicy: 'fluid-source' },
        ),
      ],
      items,
    ),
  ).toThrow(/empty fluid-container/i);
  expect(() =>
    assembleCapabilitySelector(
      [
        selectorDefinition(
          'sample:empty-source',
          { itemId: 'sample:empty-container' },
          { trigger: 'voxel', voxelHitPolicy: 'fluid-source' },
        ),
      ],
      items,
    ),
  ).not.toThrow();
});

it('rejects malformed capability selectors, accessor fields, symbols, and extra keys', () => {
  const definition = (selector: object) => selectorDefinition('sample:malformed', selector);
  expect(() =>
    defineItemInteractionModule({
      moduleId: 'sample:bad-capability',
      definitions: [definition({ capability: 'not a capability!' })],
    }),
  ).toThrow(/selector is invalid/i);
  expect(() =>
    defineItemInteractionModule({
      moduleId: 'sample:bad-selector-extra',
      definitions: [definition({ capability: 'till', extra: true })],
    }),
  ).toThrow(/selector is invalid/i);
  const symbolSelector = { capability: 'till', [Symbol('unexpected')]: true };
  expect(() =>
    defineItemInteractionModule({ moduleId: 'sample:bad-selector-symbol', definitions: [definition(symbolSelector)] }),
  ).toThrow(/selector is invalid/i);
  let accessed = false;
  const accessorSelector = {};
  Object.defineProperty(accessorSelector, 'capability', {
    enumerable: true,
    get() {
      accessed = true;
      return 'till';
    },
  });
  expect(() =>
    defineItemInteractionModule({
      moduleId: 'sample:bad-selector-accessor',
      definitions: [definition(accessorSelector)],
    }),
  ).toThrow(/selector is invalid/i);
  expect(accessed).toBe(false);
});
