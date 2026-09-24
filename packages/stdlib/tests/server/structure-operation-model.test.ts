import { describe, expect, it } from 'vitest';
import {
  defineStructureDefinitionV1,
  type StructurePositionV1,
} from '../../src/server/gameplay/modules/structure-definition';
import { createStructureDefinitionRegistryV1 } from '../../src/server/gameplay/modules/structure-definition-module';
import {
  buildStructureBreakCandidateV1,
  buildStructurePlaceCandidateV1,
  buildStructureToggleCandidateV1,
  StructureOperationModelError,
} from '../../src/server/gameplay/modules/structure-operation-model';

const orientations = ['north', 'east', 'south', 'west'] as const;
const variants = Object.fromEntries(
  orientations.flatMap((orientation, index) => [
    [`${orientation}-closed`, { lower: 101 + index * 4, upper: 102 + index * 4 }],
    [`${orientation}-open`, { lower: 103 + index * 4, upper: 104 + index * 4 }],
  ]),
);
const definition = defineStructureDefinitionV1({
  version: 1,
  id: 'sample:door',
  rootRole: 'lower',
  initialState: 'north-closed',
  parts: [
    { role: 'lower', offset: [0, 0, 0] },
    { role: 'upper', offset: [0, 1, 0] },
  ],
  states: orientations.flatMap((orientation) => [
    {
      id: `${orientation}-closed`,
      variants: variants[`${orientation}-closed`]!,
      collision: { lower: 'blocking' as const, upper: 'blocking' as const },
    },
    {
      id: `${orientation}-open`,
      variants: variants[`${orientation}-open`]!,
      collision: { lower: 'passable' as const, upper: 'passable' as const },
    },
  ]),
  transitions: orientations.flatMap((orientation) => [
    { id: 'toggle', from: `${orientation}-closed`, to: `${orientation}-open` },
    { id: 'toggle', from: `${orientation}-open`, to: `${orientation}-closed` },
  ]),
  legacyStates: [{ stateId: 'north-closed', variants: { lower: 52, upper: 52 } }],
  support: { role: 'lower', offset: [0, -1, 0], requirement: 'solid' },
  variantDescriptorKind: 'voxel-semantics',
  placementItemId: 'sample:door-item',
  dropOwnerRole: 'lower',
  drop: { itemId: 'sample:door-item', count: 1 },
});
const registry = createStructureDefinitionRegistryV1([definition]);
const key = (position: readonly number[]) => position.join(',');
const read = (cells: ReadonlyMap<string, number>) => (position: StructurePositionV1) => cells.get(key(position));
const placed = (stateId: string) =>
  new Map([
    ['7,31,0', variants[stateId]!.lower],
    ['7,32,0', variants[stateId]!.upper],
    ['7,30,0', 3],
  ]);
const placeInput = (mode: 'survival' | 'creative', overrides: Record<string, unknown> = {}) => ({
  actor: { actorId: 'player', mode, selectedItemDefinitionId: 'sample:door-item' },
  root: [7, 31, 0] as StructurePositionV1,
  stateId: 'north-closed',
  read: read(
    new Map([
      ['7,31,0', 0],
      ['7,32,0', 0],
      ['7,30,0', 3],
    ]),
  ),
  isReplaceable: (voxel: number) => voxel === 0,
  isSolid: (voxel: number) => voxel === 3,
  collides: () => false,
  ...overrides,
});
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as StructureOperationModelError).code;
  }
  return null;
};

describe('pure Structure operation candidates', () => {
  it.each(
    orientations.flatMap((orientation) =>
      (['survival', 'creative'] as const).map((mode) => [orientation, mode] as const),
    ),
  )('builds a complete %s %s placement plan', (orientation, mode) => {
    const plan = buildStructurePlaceCandidateV1(registry, placeInput(mode, { stateId: `${orientation}-closed` }));
    expect(plan).toMatchObject({
      kind: 'place',
      definitionId: 'sample:door',
      toState: `${orientation}-closed`,
      mode,
      consume: mode === 'survival' ? { itemDefinitionId: 'sample:door-item', count: 1 } : null,
      drop: null,
      support: { position: [7, 30, 0], expected: 3 },
    });
    expect(plan.edits).toEqual([
      expect.objectContaining({
        role: 'lower',
        position: [7, 31, 0],
        expected: 0,
        to: variants[`${orientation}-closed`]!.lower,
      }),
      expect.objectContaining({
        role: 'upper',
        position: [7, 32, 0],
        expected: 0,
        to: variants[`${orientation}-closed`]!.upper,
      }),
    ]);
  });

  it.each([
    ['unknown-cell', { read: () => undefined }, 'structure-unavailable'],
    [
      'occupied',
      {
        read: read(
          new Map([
            ['7,31,0', 4],
            ['7,32,0', 0],
            ['7,30,0', 3],
          ]),
        ),
      },
      'structure-target-occupied',
    ],
    [
      'support-unknown',
      {
        read: read(
          new Map([
            ['7,31,0', 0],
            ['7,32,0', 0],
          ]),
        ),
      },
      'structure-unavailable',
    ],
    [
      'support-invalid',
      {
        read: read(
          new Map([
            ['7,31,0', 0],
            ['7,32,0', 0],
            ['7,30,0', 0],
          ]),
        ),
      },
      'structure-support-invalid',
    ],
    ['collision', { collides: () => true }, 'structure-player-collision'],
  ] as const)('rejects placement %s', (_label, overrides, expected) => {
    expect(code(() => buildStructurePlaceCandidateV1(registry, placeInput('survival', overrides)))).toBe(expected);
  });

  it.each(
    orientations.flatMap((orientation) =>
      (['closed', 'open'] as const).flatMap((state) =>
        (['lower', 'upper'] as const).map((role) => [orientation, state, role] as const),
      ),
    ),
  )('toggles %s-%s from its %s part without changing orientation', (orientation, state, role) => {
    const cells = placed(`${orientation}-${state}`);
    const hit: StructurePositionV1 = role === 'lower' ? [7, 31, 0] : [7, 32, 0];
    const plan = buildStructureToggleCandidateV1(registry, {
      actor: { actorId: 'player', mode: 'survival' },
      hit,
      transitionId: 'toggle',
      read: read(cells),
      collides: () => false,
    });
    expect(plan).toMatchObject({
      kind: 'toggle',
      fromState: `${orientation}-${state}`,
      toState: `${orientation}-${state === 'closed' ? 'open' : 'closed'}`,
    });
    expect(plan.edits).toHaveLength(2);
  });

  it('rejects closing collision and transition graph bypass', () => {
    expect(
      code(() =>
        buildStructureToggleCandidateV1(registry, {
          actor: { actorId: 'player', mode: 'survival' },
          hit: [7, 31, 0],
          transitionId: 'toggle',
          read: read(placed('north-open')),
          collides: () => true,
        }),
      ),
    ).toBe('structure-player-collision');
    expect(
      code(() =>
        buildStructureToggleCandidateV1(registry, {
          actor: { actorId: 'player', mode: 'survival' },
          hit: [7, 31, 0],
          transitionId: 'missing',
          read: read(placed('north-closed')),
          collides: () => false,
        }),
      ),
    ).toBe('structure-transition-invalid');
  });

  it.each([
    [
      'unknown',
      new Map([
        ['7,31,0', 101],
        ['7,30,0', 3],
      ]),
      'structure-unavailable',
    ],
    [
      'stale',
      new Map([
        ['7,31,0', 101],
        ['7,32,0', 104],
        ['7,30,0', 3],
      ]),
      'structure-malformed',
    ],
  ] as const)('fails a %s toggle target before producing a plan', (_label, cells, expected) => {
    expect(
      code(() =>
        buildStructureToggleCandidateV1(registry, {
          actor: { actorId: 'player', mode: 'survival' },
          hit: [7, 31, 0],
          transitionId: 'toggle',
          read: read(cells),
          collides: () => false,
        }),
      ),
    ).toBe(expected);
  });

  it.each(
    orientations.flatMap((orientation) =>
      (['closed', 'open'] as const).flatMap((state) =>
        (['lower', 'upper'] as const).map((role) => [orientation, state, role] as const),
      ),
    ),
  )('breaks all %s-%s parts from the %s half with one survival drop', (orientation, state, role) => {
    const hit: StructurePositionV1 = role === 'lower' ? [7, 31, 0] : [7, 32, 0];
    const plan = buildStructureBreakCandidateV1(registry, {
      actor: { actorId: 'player', mode: 'survival' },
      hit,
      read: read(placed(`${orientation}-${state}`)),
    });
    expect(plan.edits.map(({ to }) => to)).toEqual([0, 0]);
    expect(plan.drop).toEqual({
      ownerRole: 'lower',
      position: [7, 31, 0],
      itemDefinitionId: 'sample:door-item',
      count: 1,
    });
  });

  it('uses no drop in creative and handles only a unique legal legacy pair', () => {
    const legacy = new Map([
      ['7,31,0', 52],
      ['7,32,0', 52],
      ['7,30,0', 3],
    ]);
    expect(
      buildStructureBreakCandidateV1(registry, {
        actor: { actorId: 'player', mode: 'creative' },
        hit: [7, 32, 0],
        read: read(legacy),
      }).drop,
    ).toBeNull();
    expect(
      buildStructureToggleCandidateV1(registry, {
        actor: { actorId: 'player', mode: 'survival' },
        hit: [7, 31, 0],
        transitionId: 'toggle',
        read: read(legacy),
        collides: () => false,
      }),
    ).toMatchObject({ fromState: 'north-closed', toState: 'north-open' });
    const isolated = new Map([
      ['7,29,0', 3],
      ['7,31,0', 52],
      ['7,32,0', 0],
      ['7,30,0', 3],
    ]);
    const triple = new Map([
      ['7,30,0', 52],
      ['7,31,0', 52],
      ['7,32,0', 52],
      ['7,29,0', 3],
    ]);
    expect(
      code(() =>
        buildStructureBreakCandidateV1(registry, {
          actor: { actorId: 'player', mode: 'survival' },
          hit: [7, 31, 0],
          read: read(isolated),
        }),
      ),
    ).toBe('structure-malformed');
    expect(
      code(() =>
        buildStructureBreakCandidateV1(registry, {
          actor: { actorId: 'player', mode: 'survival' },
          hit: [7, 31, 0],
          read: read(triple),
        }),
      ),
    ).toBe('structure-malformed');
  });
});
