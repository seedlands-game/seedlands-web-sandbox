import { describe, expect, it } from 'vitest';
import {
  defineStructureDefinitionV1,
  resolveStructureRootV1,
  type StructureDefinitionV1,
  type StructurePositionV1,
} from '../../src/server/gameplay/modules/structure-definition';
import {
  buildStructurePlacementCandidateV1,
  buildStructureTransitionCandidateV1,
  prepareStructureMultiEditParticipantV1,
  validateStructureMultiEditCandidateV1,
} from '../../src/server/gameplay/modules/structure-multi-edit-model';

const CLOSED_LOWER = 101;
const CLOSED_UPPER = 102;
const OPEN_LOWER = 103;
const OPEN_UPPER = 104;

const door = () =>
  defineStructureDefinitionV1({
    version: 1,
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
        collision: { lower: 'blocking', upper: 'blocking' },
      },
      {
        id: 'open',
        variants: { lower: OPEN_LOWER, upper: OPEN_UPPER },
        collision: { lower: 'passable', upper: 'passable' },
      },
      {
        id: 'side-open',
        variants: { lower: 105, upper: 106 },
        collision: { lower: 'passable', upper: 'passable' },
      },
    ],
    transitions: [
      { id: 'toggle', from: 'closed', to: 'open' },
      { id: 'toggle', from: 'open', to: 'closed' },
    ],
    legacyStates: [{ stateId: 'closed', variants: { lower: 52, upper: 52 } }],
    support: { role: 'lower', offset: [0, -1, 0], requirement: 'solid' },
    variantDescriptorKind: 'voxel-semantics',
    placementItemId: 'classic:wooden-door',
    dropOwnerRole: 'lower',
    drop: { itemId: 'classic:wooden-door', count: 1 },
  });

const key = (position: StructurePositionV1) => position.join(',');
const closedCells = () =>
  new Map<string, number>([
    ['7,31,-1', CLOSED_LOWER],
    ['7,32,-1', CLOSED_UPPER],
  ]);
const reader = (cells: ReadonlyMap<string, number>) => (position: StructurePositionV1) => cells.get(key(position));
const resolved = (definition: StructureDefinitionV1, cells: ReadonlyMap<string, number>) => {
  const current = resolveStructureRootV1(definition, [7, 31, -1], reader(cells));
  if (!current) throw new Error('Expected a resolved structure fixture.');
  return current;
};

describe('StructureDefinitionV1 detached multi-edit model', () => {
  it('builds one stable cross-Chunk expected/from/to edit for every target-state part', () => {
    const definition = door();
    const cells = closedCells();
    const first = buildStructureTransitionCandidateV1(definition, {
      current: resolved(definition, cells),
      transitionId: 'toggle',
      read: reader(cells),
    });
    const second = buildStructureTransitionCandidateV1(definition, {
      current: resolved(definition, cells),
      transitionId: 'toggle',
      read: reader(cells),
    });

    expect(first).toEqual(second);
    expect(first.edits).toEqual([
      {
        role: 'lower',
        position: [7, 31, -1],
        chunkKey: '0,0,-1',
        expected: CLOSED_LOWER,
        from: CLOSED_LOWER,
        to: OPEN_LOWER,
      },
      {
        role: 'upper',
        position: [7, 32, -1],
        chunkKey: '0,1,-1',
        expected: CLOSED_UPPER,
        from: CLOSED_UPPER,
        to: OPEN_UPPER,
      },
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.edits)).toBe(true);
    expect(first.edits.every(Object.isFrozen)).toBe(true);
  });

  it('rejects unknown reads and expected values that do not match the complete source state', () => {
    const definition = door();
    const unknown = closedCells();
    unknown.delete('7,32,-1');
    expect(() =>
      buildStructureTransitionCandidateV1(definition, {
        current: resolved(definition, closedCells()),
        transitionId: 'toggle',
        read: reader(unknown),
      }),
    ).toThrow(/unknown/i);

    const stale = closedCells();
    stale.set('7,32,-1', OPEN_UPPER);
    expect(() =>
      buildStructureTransitionCandidateV1(definition, {
        current: resolved(definition, closedCells()),
        transitionId: 'toggle',
        read: reader(stale),
      }),
    ).toThrow(/stale/i);
  });

  it('rejects duplicate coordinates and partial edit lists without accepting a subset', () => {
    const definition = door();
    const candidate = buildStructureTransitionCandidateV1(definition, {
      current: resolved(definition, closedCells()),
      transitionId: 'toggle',
      read: reader(closedCells()),
    });
    expect(() =>
      validateStructureMultiEditCandidateV1(
        {
          ...candidate,
          edits: [candidate.edits[0], { ...candidate.edits[1], position: candidate.edits[0]!.position }],
        },
        definition,
      ),
    ).toThrow(/stable footprint|duplicate/i);
    expect(() =>
      validateStructureMultiEditCandidateV1({ ...candidate, edits: candidate.edits.slice(0, 1) }, definition),
    ).toThrow(/partial/i);
  });

  it('rejects candidates whose expected/from/to values or target state are incomplete', () => {
    const definition = door();
    const candidate = buildStructureTransitionCandidateV1(definition, {
      current: resolved(definition, closedCells()),
      transitionId: 'toggle',
      read: reader(closedCells()),
    });
    expect(() =>
      validateStructureMultiEditCandidateV1(
        {
          ...candidate,
          edits: candidate.edits.map((edit, index) => (index === 0 ? { ...edit, expected: OPEN_LOWER } : edit)),
        },
        definition,
      ),
    ).toThrow(/expected.*state/i);
    expect(() =>
      validateStructureMultiEditCandidateV1(
        {
          ...candidate,
          edits: candidate.edits.map((edit, index) => (index === 1 ? { ...edit, to: CLOSED_UPPER } : edit)),
        },
        definition,
      ),
    ).toThrow(/target voxel.*state/i);

    const incomplete = {
      ...definition,
      states: definition.states.map((state) =>
        state.id === 'open' ? { ...state, variants: { lower: OPEN_LOWER } } : state,
      ),
    } as StructureDefinitionV1;
    expect(() =>
      buildStructureTransitionCandidateV1(incomplete, {
        current: resolved(definition, closedCells()),
        transitionId: 'toggle',
        read: reader(closedCells()),
      }),
    ).toThrow(/target.*incomplete/i);
  });

  it('participant revalidates stale or unknown reads and apply only returns the frozen plan', () => {
    const definition = door();
    const cells = closedCells();
    const candidate = buildStructureTransitionCandidateV1(definition, {
      current: resolved(definition, cells),
      transitionId: 'toggle',
      read: reader(cells),
    });
    const participant = prepareStructureMultiEditParticipantV1(definition, candidate, reader(cells));
    participant.validate();
    expect(participant.apply()).toBe(participant.candidate);
    expect(cells).toEqual(closedCells());
    expect(() => participant.apply()).toThrow(/already used/i);

    const staleCells = closedCells();
    const stale = prepareStructureMultiEditParticipantV1(definition, candidate, reader(staleCells));
    staleCells.set('7,32,-1', OPEN_UPPER);
    expect(() => stale.validate()).toThrow(/stale/i);
    expect(staleCells.get('7,31,-1')).toBe(CLOSED_LOWER);

    const unknownCells = closedCells();
    const unknown = prepareStructureMultiEditParticipantV1(definition, candidate, reader(unknownCells));
    unknownCells.delete('7,32,-1');
    expect(() => unknown.validate()).toThrow(/unknown/i);
    expect(unknownCells.get('7,31,-1')).toBe(CLOSED_LOWER);
  });

  it('separates initial placement from transitions and rejects cross-orientation state jumps', () => {
    const definition = door();
    const empty = new Map([
      ['7,31,-1', 0],
      ['7,32,-1', 0],
    ]);
    expect(
      buildStructurePlacementCandidateV1(definition, {
        root: [7, 31, -1],
        expectedVoxel: 0,
        read: reader(empty),
      }),
    ).toMatchObject({ kind: 'placement', fromState: 'closed', toState: 'closed', transitionId: null });
    const transition = buildStructureTransitionCandidateV1(definition, {
      current: resolved(definition, closedCells()),
      transitionId: 'toggle',
      read: reader(closedCells()),
    });
    expect(() => validateStructureMultiEditCandidateV1({ ...transition, toState: 'side-open' }, definition)).toThrow(
      /transition graph/i,
    );

    const legacyCells = new Map([
      ['7,31,-1', 52],
      ['7,32,-1', 52],
    ]);
    const legacy = buildStructureTransitionCandidateV1(definition, {
      current: resolved(definition, legacyCells),
      transitionId: 'toggle',
      read: reader(legacyCells),
    });
    expect(legacy.edits.map(({ from, to }) => [from, to])).toEqual([
      [52, OPEN_LOWER],
      [52, OPEN_UPPER],
    ]);
  });

  it('fails placement before candidate creation when any footprint read is unknown or stale', () => {
    const definition = door();
    const unknown = new Map([['7,31,-1', 0]]);
    expect(() =>
      buildStructurePlacementCandidateV1(definition, {
        root: [7, 31, -1],
        expectedVoxel: 0,
        read: reader(unknown),
      }),
    ).toThrow(/placement read is unknown/i);

    const stale = new Map([
      ['7,31,-1', 0],
      ['7,32,-1', CLOSED_UPPER],
    ]);
    expect(() =>
      buildStructurePlacementCandidateV1(definition, {
        root: [7, 31, -1],
        expectedVoxel: 0,
        read: reader(stale),
      }),
    ).toThrow(/placement expected voxel is stale/i);
  });
});
