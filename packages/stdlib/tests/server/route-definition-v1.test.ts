import { describe, expect, it } from 'vitest';
import {
  advanceRouteSegmentV1,
  defineRouteDefinitionV1,
  resolveRouteSegmentV1,
  type RouteDefinitionV1,
  type RouteEndpointV1,
  type RouteNeighborStateV1,
  type RouteSideV1,
} from '../../src/server/gameplay/modules/route-definition';

const endpoint = (side: RouteSideV1, elevation: -1 | 0 | 1 = 0): RouteEndpointV1 => ({ side, elevation });
const edgePair = (entry: RouteEndpointV1, exit: RouteEndpointV1, curve: 'line' | 'quarter') => [
  { entry, exit, curve, slopeDelta: (exit.elevation - entry.elevation) as -1 | 0 | 1 },
  { entry: exit, exit: entry, curve, slopeDelta: (entry.elevation - exit.elevation) as -1 | 0 | 1 },
];
const variant = (id: string, entry: RouteEndpointV1, exit: RouteEndpointV1, curve: 'line' | 'quarter') => ({
  variant: `sample:${id}`,
  edges: edgePair(entry, exit, curve),
});

const input = () => ({
  version: 1 as const,
  family: 'sample:guideway',
  variants: [
    variant('north-south', endpoint('south'), endpoint('north'), 'line'),
    variant('east-west', endpoint('west'), endpoint('east'), 'line'),
    variant('north-east', endpoint('north'), endpoint('east'), 'quarter'),
    variant('east-south', endpoint('east'), endpoint('south'), 'quarter'),
    variant('south-west', endpoint('south'), endpoint('west'), 'quarter'),
    variant('west-north', endpoint('west'), endpoint('north'), 'quarter'),
    variant('ascending-north', endpoint('south'), endpoint('north', 1), 'line'),
    variant('ascending-east', endpoint('west'), endpoint('east', 1), 'line'),
    variant('ascending-south', endpoint('north'), endpoint('south', 1), 'line'),
    variant('ascending-west', endpoint('east'), endpoint('west', 1), 'line'),
  ],
  placementTieBreaks: [
    {
      connected: [endpoint('north'), endpoint('east'), endpoint('south')],
      variant: 'sample:north-south',
    },
  ],
});

const route = (): RouteDefinitionV1 => defineRouteDefinitionV1(input());
const endpointKey = (value: RouteEndpointV1) => `${value.side}:${value.elevation}`;

const neighbors = (
  definition: RouteDefinitionV1,
  connected: readonly RouteEndpointV1[],
  unknown: readonly RouteEndpointV1[] = [],
) => {
  const states = new Map<string, RouteNeighborStateV1>();
  for (const variant of definition.variants)
    for (const edge of variant.edges) {
      states.set(endpointKey(edge.entry), 'disconnected');
      states.set(endpointKey(edge.exit), 'disconnected');
    }
  for (const value of connected) states.set(endpointKey(value), 'connected');
  for (const value of unknown) states.set(endpointKey(value), 'unknown');
  return [...states].map(([key, state]) => {
    const [side, elevation] = key.split(':');
    return { endpoint: endpoint(side as RouteSideV1, Number(elevation) as -1 | 0 | 1), state };
  });
};

const segment = (definition: RouteDefinitionV1, entry: RouteEndpointV1, connected: readonly RouteEndpointV1[]) => {
  const result = resolveRouteSegmentV1(definition, { entry, neighbors: neighbors(definition, connected) });
  expect(result.status).toBe('segment');
  if (result.status !== 'segment') throw new Error(`Expected segment, received ${result.status}`);
  return result.segment;
};

describe('RouteDefinitionV1', () => {
  it('freezes generic family, variants, directed edges and placement tie-breaks without Classic identities', () => {
    const definition = route();
    expect(definition.family).toBe('sample:guideway');
    expect(definition.variants).toHaveLength(10);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.variants)).toBe(true);
    expect(definition.variants.every((entry) => entry.edges.length === 2 && Object.isFrozen(entry.edges))).toBe(true);
    expect(() => defineRouteDefinitionV1({ ...input(), family: 'rail' })).toThrow(/namespace/i);
    expect(() =>
      defineRouteDefinitionV1({ ...input(), variants: [...input().variants, input().variants[0]!] }),
    ).toThrow(/duplicate.*variant/i);
    const invalidReverse = input();
    expect(() =>
      defineRouteDefinitionV1({
        ...invalidReverse,
        variants: [
          {
            variant: 'sample:invalid-reverse',
            edges: [
              { entry: endpoint('south'), exit: endpoint('north', 1), curve: 'line', slopeDelta: 1 },
              { entry: endpoint('north', 1), exit: endpoint('east'), curve: 'line', slopeDelta: -1 },
            ],
          },
        ],
        placementTieBreaks: [],
      }),
    ).toThrow(/opposite|bidirectional/i);
    expect(() =>
      defineRouteDefinitionV1({
        ...input(),
        variants: [
          {
            variant: 'sample:invalid-slope',
            edges: [
              { entry: endpoint('south'), exit: endpoint('north', 1), curve: 'line', slopeDelta: 0 },
              { entry: endpoint('north', 1), exit: endpoint('south'), curve: 'line', slopeDelta: 0 },
            ],
          },
        ],
        placementTieBreaks: [],
      }),
    ).toThrow(/slope delta/i);
  });

  it.each([
    ['sample:north-south', endpoint('south'), endpoint('north')],
    ['sample:east-west', endpoint('west'), endpoint('east')],
  ] as const)('resolves flat straight %s in both directions', (expected, first, second) => {
    const definition = route();
    expect(segment(definition, first, [first, second]).variant).toBe(expected);
    expect(segment(definition, second, [first, second]).variant).toBe(expected);
  });

  it.each([
    ['sample:north-east', endpoint('north'), endpoint('east')],
    ['sample:east-south', endpoint('east'), endpoint('south')],
    ['sample:south-west', endpoint('south'), endpoint('west')],
    ['sample:west-north', endpoint('west'), endpoint('north')],
  ] as const)('resolves quarter curve %s in both directions', (expected, first, second) => {
    const definition = route();
    expect(segment(definition, first, [first, second]).variant).toBe(expected);
    expect(segment(definition, second, [first, second]).variant).toBe(expected);
  });

  it.each([
    ['sample:ascending-north', endpoint('south'), endpoint('north', 1)],
    ['sample:ascending-east', endpoint('west'), endpoint('east', 1)],
    ['sample:ascending-south', endpoint('north'), endpoint('south', 1)],
    ['sample:ascending-west', endpoint('east'), endpoint('west', 1)],
  ] as const)('resolves slope %s with opposite up and down deltas', (expected, lower, upper) => {
    const definition = route();
    const ascending = segment(definition, lower, [lower, upper]);
    const descending = segment(definition, upper, [lower, upper]);
    expect(ascending.variant).toBe(expected);
    expect(ascending.edge.slopeDelta).toBe(1);
    expect(descending.variant).toBe(expected);
    expect(descending.edge.slopeDelta).toBe(-1);
    expect(advanceRouteSegmentV1(ascending, 0, ascending.length).position[1]).toBe(1);
    expect(advanceRouteSegmentV1(descending, 0, descending.length).position[1]).toBe(0);
  });

  it('applies an exact stable three-way placement tie-break and reports an unruled four-way ambiguity', () => {
    const definition = route();
    const threeWay = [endpoint('north'), endpoint('east'), endpoint('south')];
    const first = resolveRouteSegmentV1(definition, {
      entry: endpoint('south'),
      neighbors: neighbors(definition, threeWay),
    });
    const second = resolveRouteSegmentV1(definition, {
      entry: endpoint('south'),
      neighbors: neighbors(definition, [...threeWay].reverse()),
    });
    expect(first).toMatchObject({ status: 'segment', segment: { variant: 'sample:north-south' } });
    expect(second).toEqual(first);

    const fourWay = [endpoint('north'), endpoint('east'), endpoint('south'), endpoint('west')];
    expect(
      resolveRouteSegmentV1(definition, {
        entry: endpoint('south'),
        neighbors: neighbors(definition, fourWay),
      }),
    ).toEqual({
      status: 'ambiguous',
      variants: ['sample:east-south', 'sample:north-south', 'sample:south-west'],
    });
  });

  it('distinguishes disconnected and unknown adjacency without guessing a segment', () => {
    const definition = route();
    expect(
      resolveRouteSegmentV1(definition, {
        entry: endpoint('south'),
        neighbors: neighbors(definition, [endpoint('south')]),
      }),
    ).toEqual({ status: 'disconnected' });
    expect(
      resolveRouteSegmentV1(definition, {
        entry: endpoint('south'),
        neighbors: neighbors(definition, [endpoint('south')], [endpoint('north')]),
      }),
    ).toMatchObject({ status: 'unknown', endpoints: expect.arrayContaining([endpoint('north')]) });
  });

  it('advances by arc length, preserves overshoot and never emits NaN for curves or slopes', () => {
    const definition = route();
    const curve = segment(definition, endpoint('north'), [endpoint('north'), endpoint('east')]);
    expect(curve.length).toBeCloseTo(Math.PI / 4);
    const halfway = advanceRouteSegmentV1(curve, 0, curve.length / 2);
    expect(halfway.progress).toBeCloseTo(curve.length / 2);
    expect(halfway.overshoot).toBe(0);
    expect(halfway.position).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect([...halfway.position, ...halfway.tangent].every(Number.isFinite)).toBe(true);

    const completed = advanceRouteSegmentV1(curve, curve.length - 0.1, 0.25);
    expect(completed.progress).toBeCloseTo(curve.length);
    expect(completed.overshoot).toBeCloseTo(0.15);
    expect(completed.position).toEqual([1, 0, 0.5]);
    expect([...completed.position, ...completed.tangent].every(Number.isFinite)).toBe(true);

    const slope = segment(definition, endpoint('west'), [endpoint('west'), endpoint('east', 1)]);
    const slopeMidpoint = advanceRouteSegmentV1(slope, 0, slope.length / 2);
    expect(slope.length).toBeCloseTo(Math.SQRT2);
    expect(slopeMidpoint.position).toEqual([0.5, 0.5, 0.5]);
    expect([...slopeMidpoint.position, ...slopeMidpoint.tangent].every(Number.isFinite)).toBe(true);
    expect(() => advanceRouteSegmentV1(slope, Number.NaN, 1)).toThrow(/progress/i);
    expect(() => advanceRouteSegmentV1(slope, 0, Number.POSITIVE_INFINITY)).toThrow(/progress/i);
  });
});
