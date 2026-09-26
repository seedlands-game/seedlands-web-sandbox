import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import {
  STRUCTURE_DEFINITIONS_CAPABILITY,
  createStructureDefinitionRegistryV1,
  defineContentModule,
  definePack,
  defineStructureDefinitionModule,
  defineStructureDefinitionV1,
  type StructureDefinitionRegistryV1,
} from '@seedlands/stdlib/mod-api';

const panel = (id: string, lower: number, itemId = 'sample:panel-item') =>
  defineStructureDefinitionV1({
    version: 1,
    id,
    rootRole: 'base',
    initialState: 'closed',
    parts: [
      { role: 'base', offset: [0, 0, 0] },
      { role: 'cap', offset: [0, 1, 0] },
    ],
    states: [
      {
        id: 'closed',
        variants: { base: lower, cap: lower + 1 },
        collision: { base: 'blocking', cap: 'blocking' },
      },
      {
        id: 'open',
        variants: { base: lower + 2, cap: lower + 3 },
        collision: { base: 'passable', cap: 'passable' },
      },
    ],
    transitions: [
      { id: 'toggle', from: 'closed', to: 'open' },
      { id: 'toggle', from: 'open', to: 'closed' },
    ],
    support: { role: 'base', offset: [0, -1, 0], requirement: 'solid' },
    variantDescriptorKind: 'voxel-semantics',
    placementItemId: itemId,
    dropOwnerRole: 'base',
    drop: { itemId, count: 1 },
  });

const content = (lower: number) =>
  defineContentModule({
    moduleId: 'sample:structure-content',
    items: [{ id: 'sample:panel-item', name: 'Panel', stackLimit: 64, itemType: 'block', capabilities: [] }],
    voxels: Array.from({ length: 4 }, (_, index) => ({
      id: `sample:panel-${index}`,
      storageId: lower + index,
      solid: index < 2,
      targetable: true,
      renderable: true,
      meshKind: 'cube' as const,
      emission: 0,
      lightCost: index < 2 ? 16 : 1,
      faceMaterials: [1, 1, 1, 1, 1, 1] as const,
    })),
    meleeDefinitions: [],
  });

const artifact = (definitions: readonly ReturnType<typeof panel>[]): VerifiedPackArtifact => {
  const pack = definePack({
    id: 'sample:structure-world',
    version: '1.0.0',
    kind: 'playbook',
    modules: [
      content(definitions[0]!.states[0]!.variants.base),
      defineStructureDefinitionModule({ moduleId: 'sample:structure-module', definitions }),
    ],
  });
  return {
    ...pack,
    integrity: {
      algorithm: 'sha256',
      manifestDigest: 'a'.repeat(64),
      entryDigest: 'b'.repeat(64),
      resources: [],
    },
  };
};

describe('public Structure definition spine', () => {
  it('assembles a non-Classic panel and resolves every variant through the public capability', () => {
    const composition = assembleWorldPacks([artifact([panel('sample:sliding-panel', 500)])]);
    const registry = composition.capability<StructureDefinitionRegistryV1>(STRUCTURE_DEFINITIONS_CAPABILITY);
    expect(registry.require('sample:sliding-panel')).toMatchObject({ rootRole: 'base', initialState: 'closed' });
    expect([500, 501, 502, 503].map((voxel) => registry.resolveVariant(voxel))).toEqual([
      expect.objectContaining({ stateId: 'closed', role: 'base' }),
      expect.objectContaining({ stateId: 'closed', role: 'cap' }),
      expect.objectContaining({ stateId: 'open', role: 'base' }),
      expect.objectContaining({ stateId: 'open', role: 'cap' }),
    ]);
    const cells = new Map([
      ['7,31,0', 500],
      ['7,32,0', 501],
    ]);
    expect(registry.resolveTarget([7, 32, 0], ([x, y, z]) => cells.get(`${x},${y},${z}`))).toMatchObject({
      definitionId: 'sample:sliding-panel',
      stateId: 'closed',
      source: 'registered',
      root: [7, 31, 0],
    });
  });

  it('rejects duplicate definition identities and cross-definition variant conflicts before assembly', () => {
    const first = panel('sample:first-panel', 500);
    expect(() => createStructureDefinitionRegistryV1([first, first])).toThrow(/duplicate.*definition/i);
    expect(() =>
      createStructureDefinitionRegistryV1([first, panel('sample:second-panel', 503, 'sample:second-panel-item')]),
    ).toThrow(/variant voxel 503.*conflicts/i);
  });

  it('rejects modeled variants when the required geometry capability is missing', () => {
    const definition = panel('sample:modeled-panel', 500);
    const modeled = defineStructureDefinitionV1({
      ...definition,
      variantDescriptorKind: 'registered-structure',
    });

    expect(() => assembleWorldPacks([artifact([modeled])])).toThrow(/voxel-geometry|required capability/i);
  });
});
