import { describe, expect, it, vi } from 'vitest';
import { assembleWorldPacks } from '../../src/server/composition/assembly';
import { definePackDefinition } from '../../src/server/composition/pack-definition';
import type {
  ModRegistrationFacade,
  PackDefinition,
  VerifiedPackArtifact,
} from '../../src/server/composition/contracts';
import {
  defineStructureDefinitionV1,
  type StructurePositionV1,
} from '../../src/server/gameplay/modules/structure-definition';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import { defineVoxelGeometryModule } from '../../src/server/gameplay/modules/voxel-geometry-module';
import {
  STRUCTURE_DEFINITIONS_CAPABILITY,
  createStructureDefinitionRegistryV1,
  defineStructureDefinitionModule,
  type StructureDefinitionRegistryV1,
} from '../../src/server/gameplay/modules/structure-definition-module';

const panel = (id = 'sample:panel', firstVoxel = 301, itemId = 'sample:panel-item') =>
  defineStructureDefinitionV1({
    version: 1,
    id,
    rootRole: 'left',
    initialState: 'closed',
    parts: [
      { role: 'left', offset: [0, 0, 0] },
      { role: 'right', offset: [1, 0, 0] },
    ],
    states: [
      {
        id: 'closed',
        variants: { left: firstVoxel, right: firstVoxel + 1 },
        collision: { left: 'blocking', right: 'blocking' },
      },
      {
        id: 'open',
        variants: { left: firstVoxel + 2, right: firstVoxel + 3 },
        collision: { left: 'passable', right: 'passable' },
      },
    ],
    transitions: [
      { id: 'toggle', from: 'closed', to: 'open' },
      { id: 'toggle', from: 'open', to: 'closed' },
    ],
    support: { role: 'left', offset: [0, -1, 0], requirement: 'solid' },
    variantDescriptorKind: 'voxel-semantics',
    placementItemId: itemId,
    dropOwnerRole: 'left',
    drop: { itemId, count: 1 },
  });

const content = (firstVoxel = 301) =>
  defineContentModule({
    moduleId: 'sample:panel-content',
    items: [{ id: 'sample:panel-item', name: 'Panel', stackLimit: 64, itemType: 'block', capabilities: [] }],
    voxels: Array.from({ length: 4 }, (_, index) => ({
      id: `sample:panel-${index}`,
      storageId: firstVoxel + index,
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

const geometryModule = (count = 4) =>
  defineVoxelGeometryModule({
    moduleId: 'sample:panel-geometry',
    descriptors: Array.from({ length: count }, (_, index) => ({
      version: 1 as const,
      voxel: 301 + index,
      boxes: [{ min: [0, 0, 0] as const, max: [1, 1, 1] as const, material: 1 as const }],
      collision: index < 2 ? [{ min: [0, 0, 0] as const, max: [1, 1, 1] as const }] : [],
      occludesFullFace: index < 2,
    })),
  });

const artifactFromPack = (pack: PackDefinition): VerifiedPackArtifact => ({
  ...pack,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
});

const artifact = (module: ReturnType<typeof defineStructureDefinitionModule>): VerifiedPackArtifact =>
  artifactFromPack(
    definePackDefinition({
      id: 'sample:panel-world',
      version: '1.0.0',
      kind: 'playbook',
      modules: [content(), module],
    }),
  );

const key = (position: StructurePositionV1) => position.join(',');
const reader = (cells: ReadonlyMap<string, number>) => (position: StructurePositionV1) => cells.get(key(position));

describe('StructureDefinitionV1 module registry', () => {
  it('registers a frozen non-Classic two-part panel capability resolved by definition id and variant voxel', () => {
    const module = defineStructureDefinitionModule({ moduleId: 'sample:panel-structures', definitions: [panel()] });
    const composition = assembleWorldPacks([artifact(module)]);
    const registry = composition.capability<StructureDefinitionRegistryV1>(STRUCTURE_DEFINITIONS_CAPABILITY);

    expect(registry.require('sample:panel')).toMatchObject({ id: 'sample:panel', rootRole: 'left' });
    expect(registry.resolveVariant(301)).toMatchObject({
      definition: { id: 'sample:panel' },
      stateId: 'closed',
      role: 'left',
    });
    expect(registry.resolveVariant(304)).toMatchObject({
      definition: { id: 'sample:panel' },
      stateId: 'open',
      role: 'right',
    });
    expect(registry.resolveVariant(999)).toBeUndefined();
    expect(registry.list()).toEqual([registry.require('sample:panel')]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(Object.isFrozen(registry.resolveVariant(301))).toBe(true);
    expect(Object.isFrozen(registry.require('sample:panel').states[0]!.variants)).toBe(true);
  });

  it('rejects duplicate definition ids and any globally conflicting variant voxel', () => {
    expect(() => createStructureDefinitionRegistryV1([panel(), panel()])).toThrow(/duplicate.*definition/i);
    expect(() =>
      createStructureDefinitionRegistryV1([
        panel('sample:left', 301, 'sample:left-panel-item'),
        panel('sample:right', 304, 'sample:right-panel-item'),
      ]),
    ).toThrow(/variant voxel 304.*conflicts/i);
    const repeated = panel();
    expect(() =>
      createStructureDefinitionRegistryV1([
        defineStructureDefinitionV1({
          ...repeated,
          states: [
            repeated.states[0]!,
            {
              id: 'open',
              variants: { left: 301, right: 304 },
              collision: { left: 'passable', right: 'passable' },
            },
          ],
        }),
      ]),
    ).toThrow(/variant voxel 301.*conflicts/i);
  });

  it('creates an isolated registry for every assembly instead of sharing mutable world state', () => {
    const module = defineStructureDefinitionModule({ moduleId: 'sample:panel-structures', definitions: [panel()] });
    const verified = artifact(module);
    const first = assembleWorldPacks([verified]).capability<StructureDefinitionRegistryV1>(
      STRUCTURE_DEFINITIONS_CAPABILITY,
    );
    const second = assembleWorldPacks([verified]).capability<StructureDefinitionRegistryV1>(
      STRUCTURE_DEFINITIONS_CAPABILITY,
    );

    expect(first).not.toBe(second);
    expect(first.require('sample:panel')).not.toBe(second.require('sample:panel'));
    expect(first.list()).toEqual(second.list());
    expect(() => Object.assign(first.require('sample:panel').states[0]!.variants, { left: 999 })).toThrow();
    expect(second.resolveVariant(301)?.role).toBe('left');
  });

  it('resolves registered and legacy targets through bounded indexes and rejects incomplete or overlapping matches', () => {
    const legacyPanel = defineStructureDefinitionV1({
      ...panel(),
      legacyStates: [{ stateId: 'closed', variants: { left: 52, right: 52 } }],
    });
    const registry = createStructureDefinitionRegistryV1([legacyPanel]);
    const registered = new Map([
      ['7,31,0', 301],
      ['8,31,0', 302],
    ]);
    expect(registry.resolveTarget([8, 31, 0], reader(registered))).toMatchObject({
      definitionId: 'sample:panel',
      stateId: 'closed',
      source: 'registered',
      root: [7, 31, 0],
    });

    const legacy = new Map([
      ['7,31,0', 52],
      ['8,31,0', 52],
    ]);
    expect(registry.resolveTarget([7, 31, 0], reader(legacy))).toMatchObject({
      source: 'legacy',
      root: [7, 31, 0],
    });
    expect(registry.resolveTarget([8, 31, 0], reader(legacy))).toMatchObject({
      source: 'legacy',
      root: [7, 31, 0],
    });
    expect(registry.resolveTarget([7, 31, 0], reader(new Map([['7,31,0', 52]])))).toBeNull();
    expect(registry.resolveTarget([7, 31, 0], () => undefined)).toBeNull();
    expect(
      registry.resolveTarget(
        [7, 31, 0],
        reader(
          new Map([
            ['7,31,0', 52],
            ['8,31,0', 301],
          ]),
        ),
      ),
    ).toBeNull();
    const overlapping = new Map([
      ['7,31,0', 52],
      ['8,31,0', 52],
      ['9,31,0', 52],
    ]);
    expect(registry.resolveTarget([7, 31, 0], reader(overlapping))).toBeNull();
    expect(registry.resolveTarget([8, 31, 0], reader(overlapping))).toBeNull();
    expect(registry.resolveTarget([9, 31, 0], reader(overlapping))).toBeNull();
  });

  it('fails closed when one legacy voxel can resolve to more than one definition', () => {
    const first = defineStructureDefinitionV1({
      ...panel('sample:first', 301, 'sample:first-item'),
      legacyStates: [{ stateId: 'closed', variants: { left: 52, right: 52 } }],
    });
    const second = defineStructureDefinitionV1({
      ...panel('sample:second', 401, 'sample:second-item'),
      legacyStates: [{ stateId: 'closed', variants: { left: 52, right: 52 } }],
    });
    const registry = createStructureDefinitionRegistryV1([first, second]);
    const cells = new Map([
      ['7,31,0', 52],
      ['8,31,0', 52],
    ]);
    expect(registry.resolveTarget([7, 31, 0], reader(cells))).toBeNull();
    expect(registry.resolveTarget([8, 31, 0], reader(cells))).toBeNull();
  });

  it('provides only the registry capability and never registers items, operations, resources or systems', () => {
    const module = defineStructureDefinitionModule({ moduleId: 'sample:panel-structures', definitions: [panel()] });
    expect(module.descriptor).toEqual({
      id: 'sample:panel-structures',
      version: '1.0.0',
      requires: [
        { id: 'seedlands:items', version: '1.0.0' },
        { id: 'seedlands:voxel-semantics', version: '1.0.0' },
      ],
      provides: [{ id: STRUCTURE_DEFINITIONS_CAPABILITY, version: '1.0.0' }],
    });

    const provideCapability = vi.fn();
    const registerItem = vi.fn();
    const registerOperation = vi.fn();
    const registerSystem = vi.fn();
    const onDefinitionsReady = vi.fn();
    const facade = {
      provideCapability,
      requireCapability: vi.fn(() => ({})),
      onDefinitionsReady,
      registerItem,
      registerOperation,
      registerSystem,
    } as unknown as ModRegistrationFacade;
    module.register(facade);
    expect(provideCapability).toHaveBeenCalledOnce();
    expect(provideCapability).toHaveBeenCalledWith(STRUCTURE_DEFINITIONS_CAPABILITY, expect.any(Object));
    expect(registerItem).not.toHaveBeenCalled();
    expect(registerOperation).not.toHaveBeenCalled();
    expect(registerSystem).not.toHaveBeenCalled();
    expect(onDefinitionsReady).toHaveBeenCalledOnce();
    expect(() =>
      defineStructureDefinitionModule({
        moduleId: 'sample:invalid',
        definitions: [panel()],
        operations: [],
      } as never),
    ).toThrow(/fields/i);
  });

  it('rejects missing voxel semantics and a missing registered-structure geometry capability', () => {
    const missingVoxel = definePackDefinition({
      id: 'sample:missing-voxel-world',
      version: '1.0.0',
      kind: 'playbook',
      modules: [
        defineContentModule({
          moduleId: 'sample:missing-voxel-content',
          items: [{ id: 'sample:panel-item', name: 'Panel', stackLimit: 64, itemType: 'block', capabilities: [] }],
          meleeDefinitions: [],
        }),
        defineStructureDefinitionModule({ moduleId: 'sample:missing-voxel-structures', definitions: [panel()] }),
      ],
    });
    expect(() => assembleWorldPacks([artifactFromPack(missingVoxel)])).toThrow(/variant voxel semantics.*301/i);

    const descriptorDefinition = defineStructureDefinitionV1({
      ...panel(),
      id: 'sample:modeled-panel',
      variantDescriptorKind: 'registered-structure',
    });
    const descriptorPack = definePackDefinition({
      id: 'sample:descriptor-world',
      version: '1.0.0',
      kind: 'playbook',
      modules: [
        content(),
        defineStructureDefinitionModule({
          moduleId: 'sample:descriptor-structures',
          definitions: [descriptorDefinition],
        }),
      ],
    });
    expect(() => assembleWorldPacks([artifactFromPack(descriptorPack)])).toThrow(/voxel-geometry|required capability/i);

    const missingDescriptorPack = definePackDefinition({
      id: 'sample:missing-descriptor-world',
      version: '1.0.0',
      kind: 'playbook',
      modules: [
        content(),
        geometryModule(1),
        defineStructureDefinitionModule({
          moduleId: 'sample:descriptor-structures',
          definitions: [descriptorDefinition],
        }),
      ],
    });
    expect(() => assembleWorldPacks([artifactFromPack(missingDescriptorPack)])).toThrow(
      /variant descriptor is not registered.*302/i,
    );
  });

  it('validates legacy collision semantics before reporting the unavailable descriptor catalog', () => {
    const descriptorDefinition = defineStructureDefinitionV1({
      ...panel(),
      variantDescriptorKind: 'registered-structure',
      legacyStates: [{ stateId: 'closed', variants: { left: 305, right: 306 } }],
    });
    const missingLegacyPack = definePackDefinition({
      id: 'sample:missing-legacy-world',
      version: '1.0.0',
      kind: 'playbook',
      modules: [
        content(),
        geometryModule(),
        defineStructureDefinitionModule({
          moduleId: 'sample:missing-legacy-structures',
          definitions: [descriptorDefinition],
        }),
      ],
    });
    expect(() => assembleWorldPacks([artifactFromPack(missingLegacyPack)])).toThrow(/variant voxel semantics.*305/i);

    const mismatchedContent = defineContentModule({
      moduleId: 'sample:legacy-collision-content',
      items: [{ id: 'sample:panel-item', name: 'Panel', stackLimit: 64, itemType: 'block', capabilities: [] }],
      voxels: Array.from({ length: 6 }, (_, index) => ({
        id: `sample:legacy-panel-${index}`,
        storageId: 301 + index,
        solid: index < 2 || index === 4,
        targetable: true,
        renderable: true,
        meshKind: 'cube' as const,
        emission: 0,
        lightCost: 16,
        faceMaterials: [1, 1, 1, 1, 1, 1] as const,
      })),
      meleeDefinitions: [],
    });
    const pack = definePackDefinition({
      id: 'sample:legacy-collision-world',
      version: '1.0.0',
      kind: 'playbook',
      modules: [
        mismatchedContent,
        geometryModule(),
        defineStructureDefinitionModule({
          moduleId: 'sample:legacy-collision-structures',
          definitions: [descriptorDefinition],
        }),
      ],
    });
    expect(() => assembleWorldPacks([artifactFromPack(pack)])).toThrow(/legacy collision semantics.*right/i);
  });
});
