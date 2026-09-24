import {
  structureFootprintV1,
  transitionStructureStateV1,
  type StructureCellReaderV1,
  type StructureDefinitionV1,
  type StructurePositionV1,
  type ResolvedStructureV1,
} from './structure-definition';

const MAX_STRUCTURE_EDITS = 64;
const MAX_VOXEL = 65_535;

export type StructureVoxelEditCandidateV1 = Readonly<{
  role: string;
  position: StructurePositionV1;
  chunkKey: string;
  expected: number;
  from: number;
  to: number;
}>;

export type StructureMultiEditCandidateV1 = Readonly<{
  version: 1;
  kind: 'transition' | 'placement';
  definitionId: string;
  root: StructurePositionV1;
  fromState: string;
  toState: string;
  transitionId: string | null;
  edits: readonly StructureVoxelEditCandidateV1[];
}>;

/** A detached participant. apply() authorizes the frozen plan but never writes world state. */
export type PreparedStructureMultiEditParticipantV1 = Readonly<{
  candidate: StructureMultiEditCandidateV1;
  validate(): void;
  apply(): StructureMultiEditCandidateV1;
}>;

export type PreparedStructureVoxelBatchV1<Result = unknown> = Readonly<{
  validate(): void;
  apply(): Result;
}>;

export type StructureMultiEditHostV1<Result = unknown> = Readonly<{
  prepareVoxelEdits(
    actorId: string,
    edits: readonly StructureVoxelEditCandidateV1[],
  ): PreparedStructureVoxelBatchV1<Result>;
}>;

const positionKey = (position: StructurePositionV1): string => position.join(',');

const clonePosition = (raw: unknown, label: string): StructurePositionV1 => {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(Number.isSafeInteger))
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([raw[0], raw[1], raw[2]]) as StructurePositionV1;
};

const voxel = (raw: unknown, label: string): number => {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0 || (raw as number) > MAX_VOXEL)
    throw new TypeError(`${label} is invalid.`);
  return raw as number;
};

const exactKeys = (raw: object, expected: readonly string[], label: string): void => {
  const keys = Object.keys(raw);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key)))
    throw new TypeError(`${label} fields are invalid.`);
};

const definitionFootprint = (
  definition: StructureDefinitionV1,
  root: StructurePositionV1,
  stateId: string,
  label: string,
) => {
  const footprint = structureFootprintV1(definition, root, stateId);
  if (
    footprint.length !== definition.parts.length ||
    footprint.length === 0 ||
    footprint.length > MAX_STRUCTURE_EDITS ||
    footprint.some((part) => !Number.isSafeInteger(part.voxel) || part.voxel < 1 || part.voxel > MAX_VOXEL)
  )
    throw new TypeError(`${label} structure state is incomplete.`);
  return footprint;
};

const sourcePatterns = (
  definition: StructureDefinitionV1,
  root: StructurePositionV1,
  stateId: string,
): readonly (readonly number[])[] => {
  const footprint = definitionFootprint(definition, root, stateId, 'Source');
  return Object.freeze([
    Object.freeze(footprint.map(({ voxel }) => voxel)),
    ...definition.legacyStates
      .filter((state) => state.stateId === stateId)
      .map((state) => Object.freeze(footprint.map(({ role }) => state.variants[role]!))),
  ]);
};

export function validateStructureMultiEditCandidateV1(
  raw: unknown,
  definition: StructureDefinitionV1,
): StructureMultiEditCandidateV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('Structure multi-edit candidate is invalid.');
  exactKeys(
    raw,
    ['version', 'kind', 'definitionId', 'root', 'fromState', 'toState', 'transitionId', 'edits'],
    'Structure candidate',
  );
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || value.definitionId !== definition.id)
    throw new TypeError('Structure candidate identity is invalid.');
  if (typeof value.fromState !== 'string' || typeof value.toState !== 'string')
    throw new TypeError('Structure candidate states are invalid.');
  if (value.kind === 'transition' && value.fromState === value.toState)
    throw new TypeError('Structure transition candidate must change state.');
  if (value.kind === 'transition') {
    if (typeof value.transitionId !== 'string') throw new TypeError('Structure transition candidate id is invalid.');
    if (transitionStructureStateV1(definition, value.fromState, value.transitionId) !== value.toState)
      throw new TypeError('Structure transition candidate does not follow the transition graph.');
  } else if (value.kind === 'placement') {
    if (
      value.transitionId !== null ||
      value.fromState !== definition.initialState ||
      value.toState !== definition.initialState
    )
      throw new TypeError('Structure placement candidate must target the initial state.');
  } else throw new TypeError('Structure candidate kind is invalid.');
  const root = clonePosition(value.root, 'Structure candidate root');
  const from = definitionFootprint(definition, root, value.fromState, 'Source');
  const to = definitionFootprint(definition, root, value.toState, 'Target');
  if (!Array.isArray(value.edits) || value.edits.length !== definition.parts.length)
    throw new TypeError('Structure candidate edits are partial or oversized.');

  const targetByRole = new Map(to.map((part) => [part.role, part]));
  const coordinates = new Set<string>();
  const roles = new Set<string>();
  const edits = value.edits.map((rawEdit, index) => {
    if (!rawEdit || typeof rawEdit !== 'object' || Array.isArray(rawEdit))
      throw new TypeError('Structure candidate edit is invalid.');
    exactKeys(rawEdit, ['role', 'position', 'chunkKey', 'expected', 'from', 'to'], 'Structure candidate edit');
    const edit = rawEdit as Record<string, unknown>;
    const source = from[index]!;
    const target = targetByRole.get(source.role);
    const position = clonePosition(edit.position, 'Structure candidate edit position');
    if (
      typeof edit.role !== 'string' ||
      edit.role !== source.role ||
      !target ||
      typeof edit.chunkKey !== 'string' ||
      edit.chunkKey !== source.chunkKey ||
      positionKey(position) !== positionKey(source.position)
    )
      throw new TypeError('Structure candidate edit does not match its stable footprint.');
    const expected = voxel(edit.expected, 'Structure candidate expected voxel');
    const fromVoxel = voxel(edit.from, 'Structure candidate source voxel');
    const toVoxel = voxel(edit.to, 'Structure candidate target voxel');
    if (expected !== fromVoxel || toVoxel !== target.voxel)
      throw new TypeError('Structure candidate expected, source or target voxel does not match its state.');
    const coordinate = positionKey(position);
    if (coordinates.has(coordinate) || roles.has(edit.role))
      throw new TypeError('Structure candidate contains a duplicate coordinate or role.');
    coordinates.add(coordinate);
    roles.add(edit.role);
    return Object.freeze({
      role: edit.role,
      position,
      chunkKey: edit.chunkKey,
      expected,
      from: fromVoxel,
      to: toVoxel,
    });
  });
  if (value.kind === 'transition') {
    const actual = edits.map(({ from }) => from);
    if (
      !sourcePatterns(definition, root, value.fromState).some((pattern) =>
        pattern.every((voxel, index) => voxel === actual[index]),
      )
    )
      throw new TypeError('Structure transition source does not match a registered or legacy state pattern.');
  } else {
    const expectedVoxel = edits[0]!.expected;
    if (!edits.every((edit) => edit.expected === expectedVoxel && edit.from === expectedVoxel))
      throw new TypeError('Structure placement source voxels must use one expected replaceable value.');
  }
  return Object.freeze({
    version: 1,
    kind: value.kind,
    definitionId: definition.id,
    root,
    fromState: value.fromState,
    toState: value.toState,
    transitionId: value.transitionId,
    edits: Object.freeze(edits),
  });
}

export function assertStructureMultiEditReadsV1(
  candidate: StructureMultiEditCandidateV1,
  read: StructureCellReaderV1,
): void {
  for (const edit of candidate.edits) {
    const current = read(edit.position);
    if (current === undefined) throw new Error(`Structure candidate read is unknown: ${positionKey(edit.position)}`);
    if (current !== edit.expected)
      throw new Error(`Structure candidate expected voxel is stale: ${positionKey(edit.position)}`);
  }
}

const buildTransitionCandidate = (
  definition: StructureDefinitionV1,
  input: Readonly<{
    current: ResolvedStructureV1;
    toState: string;
    transitionId: string;
    read: StructureCellReaderV1;
  }>,
): StructureMultiEditCandidateV1 => {
  if (input.current.definitionId !== definition.id)
    throw new TypeError('Resolved structure does not match the transition definition.');
  const from = input.current.parts;
  const to = definitionFootprint(definition, input.current.root, input.toState, 'Target');
  if (from.length !== definition.parts.length) throw new TypeError('Resolved structure footprint is incomplete.');
  const targetByRole = new Map(to.map((part) => [part.role, part]));
  const observed = new Map<string, number>();
  for (const source of from) {
    const current = input.read(source.position);
    if (current === undefined) throw new Error(`Structure candidate read is unknown: ${positionKey(source.position)}`);
    if (current !== source.voxel)
      throw new Error(`Structure candidate expected voxel is stale: ${positionKey(source.position)}`);
    observed.set(source.role, current);
  }
  const candidate = validateStructureMultiEditCandidateV1(
    {
      version: 1,
      kind: 'transition',
      definitionId: definition.id,
      root: input.current.root,
      fromState: input.current.stateId,
      toState: input.toState,
      transitionId: input.transitionId,
      edits: from.map((source) => ({
        role: source.role,
        position: source.position,
        chunkKey: source.chunkKey,
        expected: observed.get(source.role),
        from: source.voxel,
        to: targetByRole.get(source.role)?.voxel,
      })),
    },
    definition,
  );
  assertStructureMultiEditReadsV1(candidate, input.read);
  return candidate;
};

export function buildStructureTransitionCandidateV1(
  definition: StructureDefinitionV1,
  input: Readonly<{
    current: ResolvedStructureV1;
    transitionId: string;
    read: StructureCellReaderV1;
  }>,
): StructureMultiEditCandidateV1 {
  const toState = transitionStructureStateV1(definition, input.current.stateId, input.transitionId);
  return buildTransitionCandidate(definition, {
    current: input.current,
    toState,
    transitionId: input.transitionId,
    read: input.read,
  });
}

export function buildStructurePlacementCandidateV1(
  definition: StructureDefinitionV1,
  input: Readonly<{ root: StructurePositionV1; expectedVoxel: number; read: StructureCellReaderV1 }>,
): StructureMultiEditCandidateV1 {
  const to = definitionFootprint(definition, input.root, definition.initialState, 'Initial');
  const observed = new Map<string, number>();
  for (const target of to) {
    const current = input.read(target.position);
    if (current === undefined) throw new Error(`Structure placement read is unknown: ${positionKey(target.position)}`);
    if (current !== input.expectedVoxel)
      throw new Error(`Structure placement expected voxel is stale: ${positionKey(target.position)}`);
    observed.set(target.role, current);
  }
  const candidate = validateStructureMultiEditCandidateV1(
    {
      version: 1,
      kind: 'placement',
      definitionId: definition.id,
      root: input.root,
      fromState: definition.initialState,
      toState: definition.initialState,
      transitionId: null,
      edits: to.map((target) => ({
        role: target.role,
        position: target.position,
        chunkKey: target.chunkKey,
        expected: observed.get(target.role),
        from: input.expectedVoxel,
        to: target.voxel,
      })),
    },
    definition,
  );
  return candidate;
}

export function prepareStructureMultiEditParticipantV1(
  definition: StructureDefinitionV1,
  candidate: StructureMultiEditCandidateV1,
  read: StructureCellReaderV1,
): PreparedStructureMultiEditParticipantV1 {
  const frozen = validateStructureMultiEditCandidateV1(candidate, definition);
  assertStructureMultiEditReadsV1(frozen, read);
  let validated = false;
  let used = false;
  return Object.freeze({
    candidate: frozen,
    validate() {
      if (used) throw new Error('Prepared structure multi-edit was already used.');
      validated = false;
      assertStructureMultiEditReadsV1(frozen, read);
      validated = true;
    },
    apply() {
      if (used) throw new Error('Prepared structure multi-edit was already used.');
      if (!validated) throw new Error('Prepared structure multi-edit requires validation.');
      assertStructureMultiEditReadsV1(frozen, read);
      used = true;
      return frozen;
    },
  });
}
