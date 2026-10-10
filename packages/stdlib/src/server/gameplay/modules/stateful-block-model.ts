const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const MAX_DEFINITIONS = 256;
const MAX_VARIANTS = 64;
const MAX_COUNTER = 64;
const MAX_NOTE = 255;
const MAX_TEXT_CODE_POINTS = 4_096;
const MAX_TEXT_LINES = 64;
const MAX_POSITION = 30_000_000;
const MAX_CHECKPOINT_ENTRIES = 65_536;

type DefinitionBaseV1 = Readonly<{ version: 1; id: string; voxelVariants: readonly number[] }>;
export type TextBlockDefinitionV1 = DefinitionBaseV1 &
  Readonly<{
    kind: 'text';
    textPolicy: Readonly<{
      voxelVariant: number;
      maxCodePoints: number;
      maxLines: number;
      maxLineCodePoints: number;
    }>;
  }>;
export type CounterBlockDefinitionV1 = DefinitionBaseV1 &
  Readonly<{ kind: 'counter'; counterPolicy: Readonly<{ variantsByRemaining: readonly number[] }> }>;
export type NoteBlockDefinitionV1 = DefinitionBaseV1 &
  Readonly<{
    kind: 'note';
    notePolicy: Readonly<{ voxelVariant: number; minimum: number; maximum: number; initial: number }>;
  }>;
export type ToggleBlockDefinitionV1 = DefinitionBaseV1 &
  Readonly<{
    kind: 'toggle';
    togglePolicy: Readonly<{ offVoxel: number; onVoxel: number; initial: boolean }>;
  }>;
export type StatefulBlockDefinitionV1 =
  TextBlockDefinitionV1 | CounterBlockDefinitionV1 | NoteBlockDefinitionV1 | ToggleBlockDefinitionV1;

export type StatefulBlockDefinitionRegistryV1 = Readonly<{
  get(id: string): StatefulBlockDefinitionV1 | undefined;
  require(id: string): StatefulBlockDefinitionV1;
  resolveVariant(voxel: number): StatefulBlockDefinitionV1 | undefined;
  list(): readonly StatefulBlockDefinitionV1[];
}>;

type StateBaseV1 = Readonly<{
  version: 1;
  definitionId: string;
  position: readonly [number, number, number];
  voxelVariant: number;
  revision: number;
}>;
export type StatefulBlockStateV1 =
  | (StateBaseV1 & Readonly<{ kind: 'text'; text: string }>)
  | (StateBaseV1 & Readonly<{ kind: 'counter'; remaining: number }>)
  | (StateBaseV1 & Readonly<{ kind: 'note'; note: number }>)
  | (StateBaseV1 & Readonly<{ kind: 'toggle'; active: boolean }>);

export type StatefulBlockCheckpointV1 = Readonly<{ version: 1; entries: readonly StatefulBlockStateV1[] }>;

export type StatefulBlockActionV1 =
  | Readonly<{ kind: 'set-text'; expectedRevision: number; text: string }>
  | Readonly<{ kind: 'decrement'; expectedRevision: number }>
  | Readonly<{ kind: 'cycle-note'; expectedRevision: number }>
  | Readonly<{ kind: 'trigger-note'; expectedRevision: number }>
  | Readonly<{ kind: 'toggle'; expectedRevision: number }>;

export type StatefulBlockFactV1 = Readonly<{
  definitionId: string;
  position: readonly [number, number, number];
  revision: number;
}> &
  (
    | Readonly<{ kind: 'text-updated'; text: string }>
    | Readonly<{ kind: 'counter-decremented'; remaining: number; removed: boolean }>
    | Readonly<{ kind: 'note-cycled' | 'note-triggered'; note: number }>
    | Readonly<{ kind: 'toggled'; active: boolean }>
  );

export type StatefulBlockActionResultV1 =
  | Readonly<{ success: true; next: StatefulBlockStateV1 | null; fact: StatefulBlockFactV1 }>
  | Readonly<{
      success: false;
      reason: 'stale-revision' | 'wrong-action' | 'invalid-text' | 'no-change';
    }>;

const exactKeys = (value: Record<string, unknown>, expected: readonly string[], label: string): void => {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key)))
    throw new TypeError(`${label} fields are invalid.`);
};

const namespaced = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !NAMESPACE_ID.test(value))
    throw new TypeError(`${label} must be namespace-qualified.`);
  return value;
};

const integer = (value: unknown, minimum: number, maximum: number, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    throw new TypeError(`${label} is invalid.`);
  return value as number;
};

const position = (value: unknown): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError('Stateful block position is invalid.');
  return Object.freeze(
    value.map((coordinate) => integer(coordinate, -MAX_POSITION, MAX_POSITION, 'Stateful block coordinate')),
  ) as readonly [number, number, number];
};

const variants = (value: unknown): readonly number[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VARIANTS)
    throw new TypeError('Stateful block voxel variants are invalid.');
  const result = value.map((voxel) => integer(voxel, 1, 65_535, 'Stateful block voxel variant'));
  if (new Set(result).size !== result.length) throw new TypeError('Stateful block voxel variants are duplicated.');
  return Object.freeze(result);
};

const sameSet = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

export function defineStatefulBlockV1(raw: unknown): StatefulBlockDefinitionV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('Stateful block definition is invalid.');
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || !['text', 'counter', 'note', 'toggle'].includes(value.kind as string))
    throw new TypeError('Stateful block definition version or kind is invalid.');
  const id = namespaced(value.id, 'Stateful block definition id');
  const voxelVariants = variants(value.voxelVariants);
  if (value.kind === 'text') {
    exactKeys(value, ['version', 'id', 'kind', 'voxelVariants', 'textPolicy'], 'Text block definition');
    if (!value.textPolicy || typeof value.textPolicy !== 'object' || Array.isArray(value.textPolicy))
      throw new TypeError('Text block policy is invalid.');
    const policy = value.textPolicy as Record<string, unknown>;
    exactKeys(policy, ['voxelVariant', 'maxCodePoints', 'maxLines', 'maxLineCodePoints'], 'Text block policy');
    const textPolicy = Object.freeze({
      voxelVariant: integer(policy.voxelVariant, 1, 65_535, 'Text block voxel variant'),
      maxCodePoints: integer(policy.maxCodePoints, 1, MAX_TEXT_CODE_POINTS, 'Text block maximum code points'),
      maxLines: integer(policy.maxLines, 1, MAX_TEXT_LINES, 'Text block maximum lines'),
      maxLineCodePoints: integer(
        policy.maxLineCodePoints,
        1,
        MAX_TEXT_CODE_POINTS,
        'Text block maximum line code points',
      ),
    });
    if (!sameSet(voxelVariants, [textPolicy.voxelVariant]))
      throw new TypeError('Text block policy must cover its voxel variant set exactly.');
    return Object.freeze({ version: 1, id, kind: 'text', voxelVariants, textPolicy });
  }
  if (value.kind === 'counter') {
    exactKeys(value, ['version', 'id', 'kind', 'voxelVariants', 'counterPolicy'], 'Counter block definition');
    if (!value.counterPolicy || typeof value.counterPolicy !== 'object' || Array.isArray(value.counterPolicy))
      throw new TypeError('Counter block policy is invalid.');
    const policy = value.counterPolicy as Record<string, unknown>;
    exactKeys(policy, ['variantsByRemaining'], 'Counter block policy');
    const variantsByRemaining = variants(policy.variantsByRemaining);
    if (variantsByRemaining.length > MAX_COUNTER || !sameSet(voxelVariants, variantsByRemaining))
      throw new TypeError('Counter block policy must cover its voxel variant set exactly.');
    return Object.freeze({
      version: 1,
      id,
      kind: 'counter',
      voxelVariants,
      counterPolicy: Object.freeze({ variantsByRemaining }),
    });
  }
  if (value.kind === 'note') {
    exactKeys(value, ['version', 'id', 'kind', 'voxelVariants', 'notePolicy'], 'Note block definition');
    if (!value.notePolicy || typeof value.notePolicy !== 'object' || Array.isArray(value.notePolicy))
      throw new TypeError('Note block policy is invalid.');
    const policy = value.notePolicy as Record<string, unknown>;
    exactKeys(policy, ['voxelVariant', 'minimum', 'maximum', 'initial'], 'Note block policy');
    const minimum = integer(policy.minimum, 0, MAX_NOTE, 'Note minimum');
    const maximum = integer(policy.maximum, minimum, MAX_NOTE, 'Note maximum');
    const notePolicy = Object.freeze({
      voxelVariant: integer(policy.voxelVariant, 1, 65_535, 'Note block voxel variant'),
      minimum,
      maximum,
      initial: integer(policy.initial, minimum, maximum, 'Initial note'),
    });
    if (!sameSet(voxelVariants, [notePolicy.voxelVariant]))
      throw new TypeError('Note block policy must cover its voxel variant set exactly.');
    return Object.freeze({ version: 1, id, kind: 'note', voxelVariants, notePolicy });
  }
  exactKeys(value, ['version', 'id', 'kind', 'voxelVariants', 'togglePolicy'], 'Toggle block definition');
  if (!value.togglePolicy || typeof value.togglePolicy !== 'object' || Array.isArray(value.togglePolicy))
    throw new TypeError('Toggle block policy is invalid.');
  const policy = value.togglePolicy as Record<string, unknown>;
  exactKeys(policy, ['offVoxel', 'onVoxel', 'initial'], 'Toggle block policy');
  if (typeof policy.initial !== 'boolean') throw new TypeError('Toggle block policy initial state must be boolean.');
  const togglePolicy = Object.freeze({
    offVoxel: integer(policy.offVoxel, 1, 65_535, 'Toggle off voxel'),
    onVoxel: integer(policy.onVoxel, 1, 65_535, 'Toggle on voxel'),
    initial: policy.initial,
  });
  if (!sameSet(voxelVariants, [togglePolicy.offVoxel, togglePolicy.onVoxel]))
    throw new TypeError('Toggle block policy must cover its voxel variant set exactly.');
  return Object.freeze({ version: 1, id, kind: 'toggle', voxelVariants, togglePolicy });
}

export function createStatefulBlockDefinitionRegistryV1(inputs: readonly unknown[]): StatefulBlockDefinitionRegistryV1 {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_DEFINITIONS)
    throw new TypeError('Stateful block definitions are invalid.');
  const byId = new Map<string, StatefulBlockDefinitionV1>();
  const byVariant = new Map<number, StatefulBlockDefinitionV1>();
  for (const input of inputs) {
    const definition = defineStatefulBlockV1(input);
    if (byId.has(definition.id)) throw new TypeError(`Duplicate stateful block definition: ${definition.id}`);
    for (const voxel of definition.voxelVariants) {
      const previous = byVariant.get(voxel);
      if (previous)
        throw new TypeError(`Stateful block voxel ${voxel} conflicts between ${previous.id} and ${definition.id}.`);
      byVariant.set(voxel, definition);
    }
    byId.set(definition.id, definition);
  }
  const ordered = Object.freeze([...byId.values()].sort((left, right) => left.id.localeCompare(right.id)));
  return Object.freeze({
    get: (id: string) => byId.get(id),
    require: (id: string) => {
      const definition = byId.get(id);
      if (!definition) throw new RangeError(`Unknown stateful block definition: ${id}`);
      return definition;
    },
    resolveVariant: (voxel: number) => byVariant.get(voxel),
    list: () => ordered,
  });
}

const validText = (text: string, definition: TextBlockDefinitionV1): boolean => {
  if (text.includes('\r') || [...text].some((character) => character !== '\n' && character < ' ')) return false;
  const lines = text.split('\n');
  return (
    [...text].length <= definition.textPolicy.maxCodePoints &&
    lines.length <= definition.textPolicy.maxLines &&
    lines.every((line) => [...line].length <= definition.textPolicy.maxLineCodePoints)
  );
};

export function createStatefulBlockStateV1(
  definition: StatefulBlockDefinitionV1,
  at: readonly number[],
): StatefulBlockStateV1 {
  const base = { version: 1 as const, definitionId: definition.id, position: position(at), revision: 0 };
  if (definition.kind === 'text')
    return Object.freeze({ ...base, kind: 'text', voxelVariant: definition.textPolicy.voxelVariant, text: '' });
  if (definition.kind === 'counter') {
    const remaining = definition.counterPolicy.variantsByRemaining.length;
    return Object.freeze({
      ...base,
      kind: 'counter',
      voxelVariant: definition.counterPolicy.variantsByRemaining[remaining - 1]!,
      remaining,
    });
  }
  if (definition.kind === 'note')
    return Object.freeze({
      ...base,
      kind: 'note',
      voxelVariant: definition.notePolicy.voxelVariant,
      note: definition.notePolicy.initial,
    });
  return Object.freeze({
    ...base,
    kind: 'toggle',
    voxelVariant: definition.togglePolicy.initial ? definition.togglePolicy.onVoxel : definition.togglePolicy.offVoxel,
    active: definition.togglePolicy.initial,
  });
}

export function validateStatefulBlockStateV1(
  raw: unknown,
  registry: StatefulBlockDefinitionRegistryV1,
): StatefulBlockStateV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Stateful block state is invalid.');
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || typeof value.definitionId !== 'string' || typeof value.kind !== 'string')
    throw new TypeError('Stateful block state identity is invalid.');
  const definition = registry.require(value.definitionId);
  const base = {
    version: 1 as const,
    definitionId: definition.id,
    position: position(value.position),
    voxelVariant: integer(value.voxelVariant, 1, 65_535, 'Stateful block state voxel'),
    revision: integer(value.revision, 0, Number.MAX_SAFE_INTEGER, 'Stateful block revision'),
  };
  if (definition.kind !== value.kind) throw new TypeError('Stateful block state kind does not match its definition.');
  if (definition.kind === 'text') {
    exactKeys(
      value,
      ['version', 'definitionId', 'position', 'voxelVariant', 'revision', 'kind', 'text'],
      'Text block state',
    );
    if (
      typeof value.text !== 'string' ||
      !validText(value.text, definition) ||
      base.voxelVariant !== definition.textPolicy.voxelVariant
    )
      throw new TypeError('Text block state is invalid.');
    return Object.freeze({ ...base, kind: 'text', text: value.text });
  }
  if (definition.kind === 'counter') {
    exactKeys(
      value,
      ['version', 'definitionId', 'position', 'voxelVariant', 'revision', 'kind', 'remaining'],
      'Counter block state',
    );
    const remaining = integer(
      value.remaining,
      1,
      definition.counterPolicy.variantsByRemaining.length,
      'Counter remaining',
    );
    if (base.voxelVariant !== definition.counterPolicy.variantsByRemaining[remaining - 1])
      throw new TypeError('Counter block voxel does not match remaining count.');
    return Object.freeze({ ...base, kind: 'counter', remaining });
  }
  if (definition.kind === 'note') {
    exactKeys(
      value,
      ['version', 'definitionId', 'position', 'voxelVariant', 'revision', 'kind', 'note'],
      'Note block state',
    );
    const note = integer(value.note, definition.notePolicy.minimum, definition.notePolicy.maximum, 'Note value');
    if (base.voxelVariant !== definition.notePolicy.voxelVariant) throw new TypeError('Note block voxel is invalid.');
    return Object.freeze({ ...base, kind: 'note', note });
  }
  exactKeys(
    value,
    ['version', 'definitionId', 'position', 'voxelVariant', 'revision', 'kind', 'active'],
    'Toggle block state',
  );
  if (typeof value.active !== 'boolean') throw new TypeError('Toggle block state is invalid.');
  const expectedVoxel = value.active ? definition.togglePolicy.onVoxel : definition.togglePolicy.offVoxel;
  if (base.voxelVariant !== expectedVoxel) throw new TypeError('Toggle block voxel does not match its state.');
  return Object.freeze({ ...base, kind: 'toggle', active: value.active });
}

const factBase = (state: StatefulBlockStateV1) => ({
  definitionId: state.definitionId,
  position: state.position,
  revision: state.revision + 1,
});

export function buildStatefulBlockActionCandidateV1(
  definition: StatefulBlockDefinitionV1,
  current: StatefulBlockStateV1,
  action: StatefulBlockActionV1,
): StatefulBlockActionResultV1 {
  const registry = createStatefulBlockDefinitionRegistryV1([definition]);
  const state = validateStatefulBlockStateV1(current, registry);
  if (!action || !Number.isSafeInteger(action.expectedRevision) || action.expectedRevision !== state.revision)
    return Object.freeze({ success: false, reason: 'stale-revision' });
  const nextRevision = state.revision + 1;
  if (nextRevision > Number.MAX_SAFE_INTEGER) throw new RangeError('Stateful block revision is exhausted.');
  if (definition.kind === 'text' && state.kind === 'text') {
    if (action.kind !== 'set-text') return Object.freeze({ success: false, reason: 'wrong-action' });
    if (typeof action.text !== 'string' || !validText(action.text, definition))
      return Object.freeze({ success: false, reason: 'invalid-text' });
    if (action.text === state.text) return Object.freeze({ success: false, reason: 'no-change' });
    const next = Object.freeze({ ...state, revision: nextRevision, text: action.text });
    return Object.freeze({
      success: true,
      next,
      fact: Object.freeze({ ...factBase(state), kind: 'text-updated', text: action.text }),
    });
  }
  if (definition.kind === 'counter' && state.kind === 'counter') {
    if (action.kind !== 'decrement') return Object.freeze({ success: false, reason: 'wrong-action' });
    const remaining = state.remaining - 1;
    const next =
      remaining === 0
        ? null
        : Object.freeze({
            ...state,
            revision: nextRevision,
            remaining,
            voxelVariant: definition.counterPolicy.variantsByRemaining[remaining - 1]!,
          });
    return Object.freeze({
      success: true,
      next,
      fact: Object.freeze({
        ...factBase(state),
        kind: 'counter-decremented',
        remaining,
        removed: remaining === 0,
      }),
    });
  }
  if (definition.kind === 'note' && state.kind === 'note') {
    if (action.kind !== 'cycle-note' && action.kind !== 'trigger-note')
      return Object.freeze({ success: false, reason: 'wrong-action' });
    const note =
      action.kind === 'cycle-note'
        ? state.note === definition.notePolicy.maximum
          ? definition.notePolicy.minimum
          : state.note + 1
        : state.note;
    const next = Object.freeze({ ...state, revision: nextRevision, note });
    return Object.freeze({
      success: true,
      next,
      fact: Object.freeze({
        ...factBase(state),
        kind: action.kind === 'cycle-note' ? 'note-cycled' : 'note-triggered',
        note,
      }),
    });
  }
  if (definition.kind === 'toggle' && state.kind === 'toggle') {
    if (action.kind !== 'toggle') return Object.freeze({ success: false, reason: 'wrong-action' });
    const active = !state.active;
    const next = Object.freeze({
      ...state,
      revision: nextRevision,
      active,
      voxelVariant: active ? definition.togglePolicy.onVoxel : definition.togglePolicy.offVoxel,
    });
    return Object.freeze({
      success: true,
      next,
      fact: Object.freeze({ ...factBase(state), kind: 'toggled', active }),
    });
  }
  return Object.freeze({ success: false, reason: 'wrong-action' });
}

const positionKey = (value: readonly [number, number, number]): string => value.join(',');

export function restoreStatefulBlockCheckpointV1(
  raw: unknown,
  registry: StatefulBlockDefinitionRegistryV1,
): StatefulBlockCheckpointV1 {
  if (raw === undefined) return Object.freeze({ version: 1, entries: Object.freeze([]) });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('Stateful block checkpoint is invalid.');
  const value = raw as Record<string, unknown>;
  exactKeys(value, ['version', 'entries'], 'Stateful block checkpoint');
  if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_CHECKPOINT_ENTRIES)
    throw new TypeError('Stateful block checkpoint is invalid.');
  const positions = new Set<string>();
  const entries = value.entries.map((entry) => {
    const state = validateStatefulBlockStateV1(entry, registry);
    const key = positionKey(state.position);
    if (positions.has(key)) throw new TypeError(`Duplicate stateful block position: ${key}`);
    positions.add(key);
    return state;
  });
  entries.sort((left, right) => {
    for (let axis = 0; axis < 3; axis += 1) {
      const order = left.position[axis] - right.position[axis];
      if (order) return order;
    }
    return left.definitionId.localeCompare(right.definitionId);
  });
  return Object.freeze({ version: 1, entries: Object.freeze(entries) });
}

export const snapshotStatefulBlockCheckpointV1 = (
  entries: readonly StatefulBlockStateV1[],
  registry: StatefulBlockDefinitionRegistryV1,
): StatefulBlockCheckpointV1 => restoreStatefulBlockCheckpointV1({ version: 1, entries }, registry);
