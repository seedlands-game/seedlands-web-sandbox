import { CHUNK_SIZE, chunkKey, floorDiv } from '../../../world/voxel';

const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const LOCAL_ID = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_PARTS = 64;
const MAX_STATES = 64;
const MAX_TRANSITIONS = 64;
const MAX_OFFSET = 64;
const MAX_VOXEL = 65_535;

export type StructureOffsetV1 = readonly [number, number, number];
export type StructurePositionV1 = readonly [number, number, number];

export type StructurePartDefinitionV1 = Readonly<{
  role: string;
  offset: StructureOffsetV1;
}>;

export type StructureStateDefinitionV1 = Readonly<{
  id: string;
  variants: Readonly<Record<string, number>>;
  collision: Readonly<Record<string, 'blocking' | 'passable'>>;
}>;

export type StructureTransitionDefinitionV1 = Readonly<{
  id: string;
  from: string;
  to: string;
}>;
export type StructureLegacyStateDefinitionV1 = Readonly<{
  stateId: string;
  variants: Readonly<Record<string, number>>;
}>;

export type StructureDefinitionV1 = Readonly<{
  version: 1;
  id: string;
  rootRole: string;
  initialState: string;
  parts: readonly StructurePartDefinitionV1[];
  states: readonly StructureStateDefinitionV1[];
  transitions: readonly StructureTransitionDefinitionV1[];
  legacyStates: readonly StructureLegacyStateDefinitionV1[];
  support: Readonly<{ role: string; offset: StructureOffsetV1; requirement: 'solid' }>;
  variantDescriptorKind: 'voxel-semantics' | 'registered-structure';
  placementItemId: string;
  dropOwnerRole: string;
  drop: Readonly<{ itemId: string; count: number }>;
}>;

export type StructureFootprintPartV1 = Readonly<{
  role: string;
  offset: StructureOffsetV1;
  position: StructurePositionV1;
  voxel: number;
  chunkKey: string;
}>;

export type StructureCellReaderV1 = (position: StructurePositionV1) => number | undefined;

export type ResolvedStructureV1 = Readonly<{
  definitionId: string;
  stateId: string;
  source: 'registered' | 'legacy';
  root: StructurePositionV1;
  parts: readonly StructureFootprintPartV1[];
}>;

export type StructureDefinitionInputV1 = Readonly<{
  version: 1;
  id: string;
  rootRole: string;
  initialState: string;
  parts: readonly Readonly<{ role: string; offset: readonly number[] }>[];
  states: readonly Readonly<{
    id: string;
    variants: Readonly<Record<string, number>>;
    collision: Readonly<Record<string, 'blocking' | 'passable'>>;
  }>[];
  transitions: readonly StructureTransitionDefinitionV1[];
  legacyStates?: readonly Readonly<{ stateId: string; variants: Readonly<Record<string, number>> }>[];
  support: Readonly<{ role: string; offset: readonly number[]; requirement: 'solid' }>;
  variantDescriptorKind: 'voxel-semantics' | 'registered-structure';
  placementItemId: string;
  dropOwnerRole: string;
  drop: Readonly<{ itemId: string; count: number }>;
}>;

const localId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !LOCAL_ID.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
};

const cloneOffset = (value: readonly number[], label: string): StructureOffsetV1 => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((coordinate) => Number.isSafeInteger(coordinate) && Math.abs(coordinate) <= MAX_OFFSET)
  )
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([value[0], value[1], value[2]]) as StructureOffsetV1;
};

const clonePosition = (value: readonly number[], label: string): StructurePositionV1 => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger))
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([value[0], value[1], value[2]]) as StructurePositionV1;
};

const validateVoxel = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_VOXEL)
    throw new TypeError(`${label} is invalid.`);
  return value as number;
};

const offsetKey = (value: StructureOffsetV1): string => value.join(',');
const positionKey = (value: StructurePositionV1): string => value.join(',');

const stateById = (definition: StructureDefinitionV1, stateId: string): StructureStateDefinitionV1 => {
  const state = definition.states.find((candidate) => candidate.id === stateId);
  if (!state) throw new RangeError(`Unknown structure state: ${stateId}`);
  return state;
};

export function defineStructureDefinitionV1(input: StructureDefinitionInputV1): StructureDefinitionV1 {
  if (!input || input.version !== 1) throw new TypeError('Structure definition version is invalid.');
  if (typeof input.id !== 'string' || !NAMESPACE_ID.test(input.id))
    throw new TypeError('Structure id must be namespace-qualified.');
  if (!Array.isArray(input.parts) || input.parts.length === 0 || input.parts.length > MAX_PARTS)
    throw new TypeError('Structure parts are invalid.');
  if (!Array.isArray(input.states) || input.states.length === 0 || input.states.length > MAX_STATES)
    throw new TypeError('Structure states are invalid.');
  if (!Array.isArray(input.transitions) || input.transitions.length > MAX_TRANSITIONS)
    throw new TypeError('Structure transitions are invalid.');
  if (
    input.legacyStates !== undefined &&
    (!Array.isArray(input.legacyStates) || input.legacyStates.length > MAX_STATES)
  )
    throw new TypeError('Structure legacy states are invalid.');

  const roles = new Set<string>();
  const offsets = new Set<string>();
  const parts = input.parts.map((source, index) => {
    const role = localId(source.role, `Structure part ${index} role`);
    const offset = cloneOffset(source.offset, `Structure part ${role} offset`);
    if (roles.has(role)) throw new TypeError(`Duplicate structure part role: ${role}`);
    if (offsets.has(offsetKey(offset))) throw new TypeError(`Duplicate structure part offset: ${offsetKey(offset)}`);
    roles.add(role);
    offsets.add(offsetKey(offset));
    return Object.freeze({ role, offset });
  });

  const rootRole = localId(input.rootRole, 'Structure root role');
  const rootPart = parts.find((part) => part.role === rootRole);
  if (!rootPart) throw new TypeError(`Unknown structure root role: ${rootRole}`);
  if (offsetKey(rootPart.offset) !== '0,0,0') throw new TypeError('Structure root role must use offset 0,0,0.');
  const supportRole = localId(input.support?.role, 'Structure support role');
  if (!roles.has(supportRole) || input.support?.requirement !== 'solid')
    throw new TypeError('Structure support policy is invalid.');
  const support = Object.freeze({
    role: supportRole,
    offset: cloneOffset(input.support.offset, 'Structure support offset'),
    requirement: 'solid' as const,
  });
  if (offsets.has(offsetKey(support.offset)))
    throw new TypeError('Structure support offset must not overlap a structure part.');
  if (input.variantDescriptorKind !== 'voxel-semantics' && input.variantDescriptorKind !== 'registered-structure')
    throw new TypeError('Structure variant descriptor kind is invalid.');
  if (typeof input.placementItemId !== 'string' || !NAMESPACE_ID.test(input.placementItemId))
    throw new TypeError('Structure placement item id is invalid.');
  const dropOwnerRole = localId(input.dropOwnerRole, 'Structure drop owner role');
  if (!roles.has(dropOwnerRole)) throw new TypeError(`Unknown structure drop owner role: ${dropOwnerRole}`);
  if (
    !input.drop ||
    typeof input.drop.itemId !== 'string' ||
    !NAMESPACE_ID.test(input.drop.itemId) ||
    !Number.isSafeInteger(input.drop.count) ||
    input.drop.count <= 0 ||
    input.drop.count > 64
  )
    throw new TypeError('Structure drop mapping is invalid.');
  const drop = Object.freeze({ itemId: input.drop.itemId, count: input.drop.count });

  const stateIds = new Set<string>();
  const states = input.states.map((source, index) => {
    const id = localId(source.id, `Structure state ${index} id`);
    if (stateIds.has(id)) throw new TypeError(`Duplicate structure state: ${id}`);
    stateIds.add(id);
    if (!source.variants || typeof source.variants !== 'object' || Array.isArray(source.variants))
      throw new TypeError(`Structure state ${id} variants are invalid.`);
    const keys = Object.keys(source.variants);
    if (keys.length !== roles.size || keys.some((role) => !roles.has(role)))
      throw new TypeError(`Structure state ${id} must define every known part role exactly once.`);
    if (!source.collision || typeof source.collision !== 'object' || Array.isArray(source.collision))
      throw new TypeError(`Structure state ${id} collision contract is invalid.`);
    const collisionKeys = Object.keys(source.collision);
    if (
      collisionKeys.length !== roles.size ||
      collisionKeys.some((role) => !roles.has(role)) ||
      collisionKeys.some((role) => !['blocking', 'passable'].includes(source.collision[role]!))
    )
      throw new TypeError(`Structure state ${id} collision contract must define every part role exactly once.`);
    const variants = Object.fromEntries(
      parts.map((part) => [part.role, validateVoxel(source.variants[part.role], `Structure state ${id} variant`)]),
    );
    const collision = Object.fromEntries(parts.map((part) => [part.role, source.collision[part.role]]));
    return Object.freeze({ id, variants: Object.freeze(variants), collision: Object.freeze(collision) });
  });

  const initialState = localId(input.initialState, 'Structure initial state');
  if (!stateIds.has(initialState)) throw new TypeError(`Unknown structure initial state: ${initialState}`);
  const legacyStates = (input.legacyStates ?? []).map((source, index) => {
    const stateId = localId(source.stateId, `Structure legacy state ${index} id`);
    if (!stateIds.has(stateId)) throw new TypeError(`Structure legacy state references an unknown state: ${stateId}`);
    if (!source.variants || typeof source.variants !== 'object' || Array.isArray(source.variants))
      throw new TypeError(`Structure legacy state ${stateId} variants are invalid.`);
    const keys = Object.keys(source.variants);
    if (keys.length !== roles.size || keys.some((role) => !roles.has(role)))
      throw new TypeError(`Structure legacy state ${stateId} must define every known part role exactly once.`);
    return Object.freeze({
      stateId,
      variants: Object.freeze(
        Object.fromEntries(
          parts.map((part) => [
            part.role,
            validateVoxel(source.variants[part.role], `Structure legacy state ${stateId} variant`),
          ]),
        ),
      ),
    });
  });
  const transitionSources = new Set<string>();
  const transitions = input.transitions.map((source, index) => {
    const id = localId(source.id, `Structure transition ${index} id`);
    const from = localId(source.from, `Structure transition ${id} from`);
    const to = localId(source.to, `Structure transition ${id} to`);
    if (!stateIds.has(from) || !stateIds.has(to))
      throw new TypeError(`Structure transition ${id} references an unknown state.`);
    if (from === to) throw new TypeError(`Structure transition ${id} must change state.`);
    const sourceKey = `${id}\u0000${from}`;
    if (transitionSources.has(sourceKey))
      throw new TypeError(`Duplicate structure transition source: ${id} from ${from}`);
    transitionSources.add(sourceKey);
    return Object.freeze({ id, from, to });
  });

  return Object.freeze({
    version: 1,
    id: input.id,
    rootRole,
    initialState,
    parts: Object.freeze(parts),
    states: Object.freeze(states),
    transitions: Object.freeze(transitions),
    legacyStates: Object.freeze(legacyStates),
    support,
    variantDescriptorKind: input.variantDescriptorKind,
    placementItemId: input.placementItemId,
    dropOwnerRole,
    drop,
  });
}

export function transitionStructureStateV1(
  definition: StructureDefinitionV1,
  stateId: string,
  transitionId: string,
): string {
  stateById(definition, stateId);
  localId(transitionId, 'Structure transition id');
  const transition = definition.transitions.find(
    (candidate) => candidate.id === transitionId && candidate.from === stateId,
  );
  if (!transition) throw new RangeError(`Unknown structure transition ${transitionId} from ${stateId}`);
  return transition.to;
}

export function structureFootprintV1(
  definition: StructureDefinitionV1,
  root: StructurePositionV1,
  stateId: string,
): readonly StructureFootprintPartV1[] {
  const frozenRoot = clonePosition(root, 'Structure root');
  const state = stateById(definition, stateId);
  const parts = definition.parts.map((part) => {
    const position = clonePosition(
      [frozenRoot[0] + part.offset[0], frozenRoot[1] + part.offset[1], frozenRoot[2] + part.offset[2]],
      'Structure part position',
    );
    const chunk = [
      floorDiv(position[0], CHUNK_SIZE),
      floorDiv(position[1], CHUNK_SIZE),
      floorDiv(position[2], CHUNK_SIZE),
    ] as const;
    return {
      value: Object.freeze({
        role: part.role,
        offset: part.offset,
        position,
        voxel: state.variants[part.role]!,
        chunkKey: chunkKey(...chunk),
      }),
      chunk,
    };
  });
  parts.sort(({ value: left, chunk: leftChunk }, { value: right, chunk: rightChunk }) => {
    for (let axis = 0; axis < 3; axis += 1) {
      const chunkOrder = leftChunk[axis] - rightChunk[axis];
      if (chunkOrder) return chunkOrder;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const positionOrder = left.position[axis] - right.position[axis];
      if (positionOrder) return positionOrder;
    }
    return left.role.localeCompare(right.role);
  });
  return Object.freeze(parts.map(({ value }) => value));
}

export function resolveStructureRootV1(
  definition: StructureDefinitionV1,
  selected: StructurePositionV1,
  read: StructureCellReaderV1,
): ResolvedStructureV1 | null {
  const selectedPosition = clonePosition(selected, 'Selected structure position');
  const selectedVoxel = read(selectedPosition);
  if (selectedVoxel === undefined) return null;
  const matches: ResolvedStructureV1[] = [];
  const candidates = [
    ...definition.states.map((state) => ({
      source: 'registered' as const,
      stateId: state.id,
      variants: state.variants,
    })),
    ...definition.legacyStates.map((state) => ({
      source: 'legacy' as const,
      stateId: state.stateId,
      variants: state.variants,
    })),
  ];
  for (const state of candidates) {
    for (const part of definition.parts) {
      if (state.variants[part.role] !== selectedVoxel) continue;
      const root = clonePosition(
        [
          selectedPosition[0] - part.offset[0],
          selectedPosition[1] - part.offset[1],
          selectedPosition[2] - part.offset[2],
        ],
        'Resolved structure root',
      );
      const registered = structureFootprintV1(definition, root, state.stateId);
      const footprint = Object.freeze(
        registered.map((entry) => Object.freeze({ ...entry, voxel: state.variants[entry.role]! })),
      );
      if (!footprint.every((entry) => read(entry.position) === entry.voxel)) continue;
      if (
        matches.some(
          (match) =>
            match.source === state.source &&
            match.stateId === state.stateId &&
            positionKey(match.root) === positionKey(root),
        )
      )
        continue;
      matches.push(
        Object.freeze({
          definitionId: definition.id,
          stateId: state.stateId,
          source: state.source,
          root,
          parts: footprint,
        }),
      );
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}
