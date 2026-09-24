import { describe, expect, it } from 'vitest';
import {
  defineStructureDefinitionV1,
  resolveStructureRootV1,
  structureFootprintV1,
  transitionStructureStateV1,
  type StructureDefinitionV1,
  type StructurePositionV1,
} from '../../src/server/gameplay/modules/structure-definition';

const CLOSED_LOWER = 101;
const CLOSED_UPPER = 102;
const OPEN_LOWER = 103;
const OPEN_UPPER = 104;

const doorInput = () => ({
  version: 1 as const,
  id: 'classic:wooden-door',
  rootRole: 'lower',
  initialState: 'closed',
  parts: [
    { role: 'upper', offset: [0, 1, 0] },
    { role: 'lower', offset: [0, 0, 0] },
  ],
  states: [
    {
      id: 'closed',
      variants: { lower: CLOSED_LOWER, upper: CLOSED_UPPER },
      collision: { lower: 'blocking' as const, upper: 'blocking' as const },
    },
    {
      id: 'open',
      variants: { lower: OPEN_LOWER, upper: OPEN_UPPER },
      collision: { lower: 'passable' as const, upper: 'passable' as const },
    },
  ],
  transitions: [
    { id: 'toggle', from: 'closed', to: 'open' },
    { id: 'toggle', from: 'open', to: 'closed' },
  ],
  legacyStates: [{ stateId: 'closed', variants: { lower: 52, upper: 52 } }],
  support: { role: 'lower', offset: [0, -1, 0], requirement: 'solid' as const },
  variantDescriptorKind: 'voxel-semantics' as const,
  placementItemId: 'classic:wooden-door',
  dropOwnerRole: 'lower',
  drop: { itemId: 'classic:wooden-door', count: 1 },
});

const door = (): StructureDefinitionV1 => defineStructureDefinitionV1(doorInput());
const positionKey = (position: StructurePositionV1) => position.join(',');
const reader = (cells: ReadonlyMap<string, number>) => (position: StructurePositionV1) =>
  cells.get(positionKey(position));

describe('StructureDefinitionV1 two-cell door model', () => {
  it('validates a namespace-qualified id and deeply freezes a detached definition', () => {
    const source = doorInput();
    const definition = defineStructureDefinitionV1(source);
    source.parts[0]!.offset[1] = 9;
    source.states[0]!.variants.lower = 999;

    expect(definition).toMatchObject({
      version: 1,
      id: 'classic:wooden-door',
      rootRole: 'lower',
      initialState: 'closed',
    });
    expect(definition.parts[0]!.offset).toEqual([0, 1, 0]);
    expect(definition.states[0]!.variants.lower).toBe(CLOSED_LOWER);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.parts)).toBe(true);
    expect(Object.isFrozen(definition.parts[0])).toBe(true);
    expect(Object.isFrozen(definition.parts[0]!.offset)).toBe(true);
    expect(Object.isFrozen(definition.states[0]!.variants)).toBe(true);
    expect(Object.isFrozen(definition.states[0]!.collision)).toBe(true);
    expect(definition).toMatchObject({
      support: { role: 'lower', offset: [0, -1, 0], requirement: 'solid' },
      variantDescriptorKind: 'voxel-semantics',
      placementItemId: 'classic:wooden-door',
      dropOwnerRole: 'lower',
      drop: { itemId: 'classic:wooden-door', count: 1 },
    });
    expect(() => defineStructureDefinitionV1({ ...doorInput(), id: 'wooden-door' })).toThrow(/namespace/i);
  });

  it('rejects duplicate roles, duplicate offsets and an unknown or displaced root role', () => {
    const input = doorInput();
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        parts: [...input.parts, { role: 'lower', offset: [1, 0, 0] }],
      }),
    ).toThrow(/duplicate.*role/i);
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        parts: [...input.parts, { role: 'hinge', offset: [0, 1, 0] }],
      }),
    ).toThrow(/duplicate.*offset/i);
    expect(() => defineStructureDefinitionV1({ ...input, rootRole: 'missing' })).toThrow(/unknown.*root/i);
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        parts: [
          { role: 'lower', offset: [1, 0, 0] },
          { role: 'upper', offset: [1, 1, 0] },
        ],
      }),
    ).toThrow(/root.*0,0,0/i);
  });

  it('rejects duplicate and unknown states plus incomplete or extra state variants', () => {
    const input = doorInput();
    expect(() => defineStructureDefinitionV1({ ...input, states: [...input.states, input.states[0]!] })).toThrow(
      /duplicate.*state/i,
    );
    expect(() => defineStructureDefinitionV1({ ...input, initialState: 'missing' })).toThrow(/unknown.*initial/i);
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        states: [{ id: 'closed', variants: { lower: CLOSED_LOWER }, collision: { lower: 'blocking' } }],
        initialState: 'closed',
        transitions: [],
      }),
    ).toThrow(/every known part/i);
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        states: [
          {
            id: 'closed',
            variants: { lower: CLOSED_LOWER, upper: CLOSED_UPPER, hinge: 105 },
            collision: { lower: 'blocking', upper: 'blocking' },
          },
        ],
        initialState: 'closed',
        transitions: [],
      }),
    ).toThrow(/every known part/i);
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        legacyStates: Array.from({ length: 65 }, () => input.legacyStates[0]!),
      }),
    ).toThrow(/legacy states.*invalid/i);
  });

  it('rejects invalid support, collision and single-owner drop contracts', () => {
    const input = doorInput();
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        support: { role: 'missing', offset: [0, -1, 0], requirement: 'solid' },
      }),
    ).toThrow(/support policy/i);
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        support: { role: 'lower', offset: [0, 0, 0], requirement: 'solid' },
      }),
    ).toThrow(/support offset.*overlap/i);
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        states: input.states.map((state) =>
          state.id === 'closed' ? { ...state, collision: { lower: 'blocking' as const } } : state,
        ),
      }),
    ).toThrow(/collision contract.*every part/i);
    expect(() => defineStructureDefinitionV1({ ...input, dropOwnerRole: 'upper-missing' })).toThrow(
      /unknown.*drop owner/i,
    );
    expect(() => defineStructureDefinitionV1({ ...input, drop: { ...input.drop, count: 0 } })).toThrow(/drop mapping/i);
  });

  it('resolves both directions of a toggle and rejects duplicate or unknown transition sources', () => {
    const definition = door();
    expect(transitionStructureStateV1(definition, 'closed', 'toggle')).toBe('open');
    expect(transitionStructureStateV1(definition, 'open', 'toggle')).toBe('closed');
    expect(() => transitionStructureStateV1(definition, 'missing', 'toggle')).toThrow(/unknown.*state/i);
    expect(() => transitionStructureStateV1(definition, 'closed', 'missing')).toThrow(/unknown.*transition/i);

    const input = doorInput();
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        transitions: [...input.transitions, input.transitions[0]!],
      }),
    ).toThrow(/duplicate.*transition source/i);
    expect(() =>
      defineStructureDefinitionV1({
        ...input,
        transitions: [{ id: 'toggle', from: 'missing', to: 'open' }],
      }),
    ).toThrow(/unknown state/i);
  });

  it('sorts a cross-Chunk footprint deterministically without declaration-order dependence', () => {
    const definition = door();
    const first = structureFootprintV1(definition, [7, 31, -1], 'closed');
    const second = structureFootprintV1(definition, [7, 31, -1], 'closed');

    expect(first).toEqual(second);
    expect(first.map(({ chunkKey }) => chunkKey)).toEqual(['0,0,-1', '0,1,-1']);
    expect(first.map(({ role }) => role)).toEqual(['lower', 'upper']);
    expect(first.map(({ position }) => position)).toEqual([
      [7, 31, -1],
      [7, 32, -1],
    ]);
    expect(first.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('resolves the same root from either half and fails closed for isolated, mismatched or unknown cells', () => {
    const definition = door();
    const complete = new Map([
      ['7,31,-1', CLOSED_LOWER],
      ['7,32,-1', CLOSED_UPPER],
    ]);
    const lower = resolveStructureRootV1(definition, [7, 31, -1], reader(complete));
    const upper = resolveStructureRootV1(definition, [7, 32, -1], reader(complete));
    expect(lower).toEqual(upper);
    expect(lower).toMatchObject({
      definitionId: 'classic:wooden-door',
      stateId: 'closed',
      source: 'registered',
      root: [7, 31, -1],
    });
    const legacy = new Map([
      ['7,31,-1', 52],
      ['7,32,-1', 52],
    ]);
    expect(resolveStructureRootV1(definition, [7, 32, -1], reader(legacy))).toMatchObject({
      stateId: 'closed',
      source: 'legacy',
      root: [7, 31, -1],
    });

    expect(resolveStructureRootV1(definition, [7, 31, -1], reader(new Map([['7,31,-1', CLOSED_LOWER]])))).toBeNull();
    expect(
      resolveStructureRootV1(
        definition,
        [7, 32, -1],
        reader(
          new Map([
            ['7,31,-1', OPEN_LOWER],
            ['7,32,-1', CLOSED_UPPER],
          ]),
        ),
      ),
    ).toBeNull();
    expect(resolveStructureRootV1(definition, [7, 31, -1], () => undefined)).toBeNull();
    expect(resolveStructureRootV1(definition, [7, 31, -1], () => 999)).toBeNull();
  });
});
