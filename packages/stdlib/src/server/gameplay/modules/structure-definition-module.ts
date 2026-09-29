import type { ModModule } from '../../composition/contracts';
import {
  defineStructureDefinitionV1,
  structureFootprintV1,
  type ResolvedStructureV1,
  type StructureCellReaderV1,
  type StructureDefinitionV1,
  type StructurePositionV1,
} from './structure-definition';
import { ITEMS_CAPABILITY, VOXEL_SEMANTICS_CAPABILITY } from './content-capabilities';
import { VOXEL_GEOMETRY_CAPABILITY } from './voxel-geometry-module';
import type { VoxelGeometryRegistryV1 } from '../../../world/voxel-geometry';

export const STRUCTURE_DEFINITIONS_CAPABILITY = 'seedlands:structure-definitions';
const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const MAX_DEFINITIONS = 256;
const MAX_TARGET_PATTERNS_PER_VOXEL = 256;

export type StructureVariantResolutionV1 = Readonly<{
  definition: StructureDefinitionV1;
  stateId: string;
  role: string;
}>;

export type StructureDefinitionRegistryV1 = Readonly<{
  get(id: string): StructureDefinitionV1 | undefined;
  require(id: string): StructureDefinitionV1;
  resolveVariant(voxel: number): StructureVariantResolutionV1 | undefined;
  resolveTarget(position: StructurePositionV1, read: StructureCellReaderV1): ResolvedStructureV1 | null;
  resolvePlacementItem(itemId: string): StructureDefinitionV1 | undefined;
  list(): readonly StructureDefinitionV1[];
}>;

export type StructureDefinitionModuleOptions = Readonly<{
  moduleId: string;
  definitions: readonly StructureDefinitionV1[];
}>;

const exactKeys = (value: object, expected: readonly string[], label: string): void => {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key)))
    throw new TypeError(`${label} fields are invalid.`);
};

const cloneDefinition = (definition: StructureDefinitionV1): StructureDefinitionV1 =>
  defineStructureDefinitionV1({
    version: definition.version,
    id: definition.id,
    rootRole: definition.rootRole,
    initialState: definition.initialState,
    parts: definition.parts.map((part) => ({ role: part.role, offset: [...part.offset] })),
    states: definition.states.map((state) => ({
      id: state.id,
      variants: { ...state.variants },
      collision: { ...state.collision },
    })),
    transitions: definition.transitions.map((transition) => ({ ...transition })),
    legacyStates: definition.legacyStates.map((state) => ({ stateId: state.stateId, variants: { ...state.variants } })),
    support: { ...definition.support, offset: [...definition.support.offset] },
    variantDescriptorKind: definition.variantDescriptorKind,
    placementItemId: definition.placementItemId,
    dropOwnerRole: definition.dropOwnerRole,
    drop: { ...definition.drop },
  });

type IndexedTargetPattern = Readonly<{
  definition: StructureDefinitionV1;
  stateId: string;
  source: ResolvedStructureV1['source'];
  role: string;
  variants: Readonly<Record<string, number>>;
}>;

const positionKey = (position: StructurePositionV1): string => position.join(',');
const targetKey = (target: ResolvedStructureV1): string =>
  `${target.definitionId}\u0000${target.source}\u0000${target.stateId}\u0000${positionKey(target.root)}`;

const resolvePattern = (
  pattern: IndexedTargetPattern,
  selected: StructurePositionV1,
  read: StructureCellReaderV1,
): ResolvedStructureV1 | null => {
  const selectedPart = pattern.definition.parts.find(({ role }) => role === pattern.role)!;
  const root = Object.freeze([
    selected[0] - selectedPart.offset[0],
    selected[1] - selectedPart.offset[1],
    selected[2] - selectedPart.offset[2],
  ]) as StructurePositionV1;
  const parts = Object.freeze(
    structureFootprintV1(pattern.definition, root, pattern.stateId).map((part) =>
      Object.freeze({ ...part, voxel: pattern.variants[part.role]! }),
    ),
  );
  if (!parts.every((part) => read(part.position) === part.voxel)) return null;
  return Object.freeze({
    definitionId: pattern.definition.id,
    stateId: pattern.stateId,
    source: pattern.source,
    root,
    parts,
  });
};

export function createStructureDefinitionRegistryV1(
  inputs: readonly StructureDefinitionV1[],
): StructureDefinitionRegistryV1 {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_DEFINITIONS)
    throw new TypeError('Structure definitions are invalid.');
  const definitions = new Map<string, StructureDefinitionV1>();
  const variants = new Map<number, StructureVariantResolutionV1>();
  const registeredTargets = new Map<number, IndexedTargetPattern>();
  const legacyTargets = new Map<number, IndexedTargetPattern[]>();
  const placementItems = new Map<string, StructureDefinitionV1>();
  for (const input of inputs) {
    const definition = cloneDefinition(input);
    if (definitions.has(definition.id)) throw new TypeError(`Duplicate structure definition: ${definition.id}`);
    if (placementItems.has(definition.placementItemId))
      throw new TypeError(`Duplicate structure placement item: ${definition.placementItemId}`);
    definitions.set(definition.id, definition);
    placementItems.set(definition.placementItemId, definition);
    for (const state of definition.states)
      for (const part of definition.parts) {
        const voxel = state.variants[part.role]!;
        const previous = variants.get(voxel);
        if (previous)
          throw new TypeError(
            `Structure variant voxel ${voxel} conflicts between ${previous.definition.id}/${previous.stateId}/${previous.role} and ${definition.id}/${state.id}/${part.role}.`,
          );
        variants.set(
          voxel,
          Object.freeze({
            definition,
            stateId: state.id,
            role: part.role,
          }),
        );
        registeredTargets.set(
          voxel,
          Object.freeze({
            definition,
            stateId: state.id,
            source: 'registered',
            role: part.role,
            variants: state.variants,
          }),
        );
      }
    for (const state of definition.legacyStates)
      for (const part of definition.parts) {
        const voxel = state.variants[part.role]!;
        const candidates = legacyTargets.get(voxel) ?? [];
        if (candidates.length >= MAX_TARGET_PATTERNS_PER_VOXEL)
          throw new TypeError(`Structure legacy target candidates exceed the per-voxel limit: ${voxel}`);
        candidates.push(
          Object.freeze({
            definition,
            stateId: state.stateId,
            source: 'legacy',
            role: part.role,
            variants: state.variants,
          }),
        );
        legacyTargets.set(voxel, candidates);
      }
  }
  for (const candidates of legacyTargets.values()) Object.freeze(candidates);
  const ordered = Object.freeze([...definitions.values()].sort((left, right) => left.id.localeCompare(right.id)));
  const patternsForVoxel = (voxel: number): readonly IndexedTargetPattern[] => {
    const registered = registeredTargets.get(voxel);
    const legacy = legacyTargets.get(voxel) ?? [];
    return registered ? [registered, ...legacy] : legacy;
  };
  const resolveTarget = (position: StructurePositionV1, read: StructureCellReaderV1): ResolvedStructureV1 | null => {
    const selectedVoxel = read(position);
    if (selectedVoxel === undefined) return null;
    const matches = new Map<string, ResolvedStructureV1>();
    for (const pattern of patternsForVoxel(selectedVoxel)) {
      const target = resolvePattern(pattern, position, read);
      if (target) matches.set(targetKey(target), target);
    }
    if (matches.size !== 1) return null;

    const resolved = matches.values().next().value!;
    for (const part of resolved.parts) {
      for (const pattern of patternsForVoxel(part.voxel)) {
        const overlapping = resolvePattern(pattern, part.position, read);
        if (overlapping) matches.set(targetKey(overlapping), overlapping);
      }
    }
    return matches.size === 1 ? resolved : null;
  };
  return Object.freeze({
    get: (id: string) => definitions.get(id),
    require: (id: string) => {
      const definition = definitions.get(id);
      if (!definition) throw new RangeError(`Unknown structure definition: ${id}`);
      return definition;
    },
    resolveVariant: (voxel: number) => variants.get(voxel),
    resolveTarget,
    resolvePlacementItem: (itemId: string) => placementItems.get(itemId),
    list: () => ordered,
  });
}

export function defineStructureDefinitionModule(options: StructureDefinitionModuleOptions): ModModule {
  if (!options || typeof options !== 'object') throw new TypeError('Structure definition module options are invalid.');
  exactKeys(options, ['moduleId', 'definitions'], 'Structure definition module options');
  if (typeof options.moduleId !== 'string' || !NAMESPACE_ID.test(options.moduleId))
    throw new TypeError('Structure definition module id must be namespace-qualified.');
  const source = createStructureDefinitionRegistryV1(options.definitions).list();
  const requiresGeometry = source.some(({ variantDescriptorKind }) => variantDescriptorKind === 'registered-structure');
  return Object.freeze({
    descriptor: Object.freeze({
      id: options.moduleId,
      version: '1.0.0',
      requires: Object.freeze([
        Object.freeze({ id: ITEMS_CAPABILITY, version: '1.0.0' }),
        Object.freeze({ id: VOXEL_SEMANTICS_CAPABILITY, version: '1.0.0' }),
        ...(requiresGeometry ? [Object.freeze({ id: VOXEL_GEOMETRY_CAPABILITY, version: '1.0.0' })] : []),
      ]),
      provides: Object.freeze([Object.freeze({ id: STRUCTURE_DEFINITIONS_CAPABILITY, version: '1.0.0' })]),
    }),
    register(api) {
      api.requireCapability(ITEMS_CAPABILITY);
      api.requireCapability(VOXEL_SEMANTICS_CAPABILITY);
      const geometry = requiresGeometry
        ? api.requireCapability<VoxelGeometryRegistryV1>(VOXEL_GEOMETRY_CAPABILITY)
        : undefined;
      const registry = createStructureDefinitionRegistryV1(source);
      api.provideCapability(STRUCTURE_DEFINITIONS_CAPABILITY, registry);
      api.onDefinitionsReady(() => {
        const content = api.readContentDefinitions();
        const voxels = new Map(content.voxels.map((voxel) => [voxel.storageId, voxel]));
        const items = new Set(content.items.map(({ id }) => id));
        for (const definition of registry.list()) {
          if (!items.has(definition.placementItemId))
            throw new TypeError(`Structure placement item is not registered: ${definition.placementItemId}`);
          if (!items.has(definition.drop.itemId))
            throw new TypeError(`Structure drop item is not registered: ${definition.drop.itemId}`);
          for (const state of definition.states)
            for (const part of definition.parts) {
              const variant = state.variants[part.role]!;
              const semantic = voxels.get(variant);
              if (!semantic)
                throw new TypeError(
                  `Structure variant voxel semantics are not registered: ${definition.id}/${variant}`,
                );
              if (semantic.solid !== (state.collision[part.role] === 'blocking'))
                throw new TypeError(
                  `Structure collision semantics do not match: ${definition.id}/${state.id}/${part.role}`,
                );
              if (definition.variantDescriptorKind === 'registered-structure') {
                const descriptor = geometry?.get(variant);
                if (!descriptor)
                  throw new TypeError(`Structure variant descriptor is not registered: ${definition.id}/${variant}`);
                if (descriptor.collision.length > 0 !== (state.collision[part.role] === 'blocking'))
                  throw new TypeError(
                    `Structure descriptor collision does not match: ${definition.id}/${state.id}/${part.role}`,
                  );
                if (descriptor.boxes.some((box) => !semantic.faceMaterials.includes(box.material)))
                  throw new TypeError(
                    `Structure descriptor material does not match: ${definition.id}/${state.id}/${part.role}`,
                  );
              }
            }
          for (const legacy of definition.legacyStates) {
            const state = definition.states.find(({ id }) => id === legacy.stateId)!;
            for (const part of definition.parts) {
              const variant = legacy.variants[part.role]!;
              const semantic = voxels.get(variant);
              if (!semantic)
                throw new TypeError(
                  `Structure variant voxel semantics are not registered: ${definition.id}/${variant}`,
                );
              if (semantic.solid !== (state.collision[part.role] === 'blocking'))
                throw new TypeError(
                  `Structure legacy collision semantics do not match: ${definition.id}/${legacy.stateId}/${part.role}`,
                );
            }
          }
        }
      });
    },
  });
}
