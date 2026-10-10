import { describe, expect, it } from 'vitest';
import { assembleOverworldPacks, gameplayContentForComposition } from '@seedlands/stdlib/host';
import {
  resolveRouteSegmentV1,
  type RouteDefinitionV1,
  type RouteEndpointV1,
  type RouteNeighborV1,
  type RouteSideV1,
} from '@seedlands/stdlib/mod-api';
import { pack } from '@seedlands/playbook-classic';
import { EntityStore } from '../../../../../../../packages/stdlib/src/server/gameplay/entity-store';
import { projectTransportDeploymentSite } from '../../../../../../../packages/stdlib/src/server/gameplay/transport-deployment-geometry';
import type { FrozenTransportInteractionConfig } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/transport-interaction-config';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

type ClassicTransportConfig = Readonly<{
  routes: readonly Readonly<{ definition: RouteDefinitionV1; voxels: readonly number[] }>[];
}>;

const composition = assembleOverworldPacks([
  {
    ...pack,
    integrity: {
      algorithm: 'sha256',
      manifestDigest: 'a'.repeat(64),
      entryDigest: 'b'.repeat(64),
      resources: (pack.manifest.resources ?? []).map((path) => ({ path, digest: 'c'.repeat(64) })),
    },
  },
]);
const route = composition
  .capability<ClassicTransportConfig>('seedlands:transport-interactions')
  .routes.find(({ definition }) => definition.family === 'seedlands:ordinary-rail')!.definition;

const endpoint = (side: RouteSideV1, elevation: -1 | 0 | 1 = 0): RouteEndpointV1 => ({ side, elevation });
const key = ({ side, elevation }: RouteEndpointV1) => `${side}:${elevation}`;
const routeEndpoints = Array.from(
  new Map(
    route.variants
      .flatMap(({ edges }) => edges.flatMap(({ entry, exit }) => [entry, exit]))
      .map((value) => [key(value), value]),
  ).values(),
);

const resolve = (
  definition: RouteDefinitionV1,
  entry: RouteEndpointV1,
  connected: readonly RouteEndpointV1[],
  unknown: readonly RouteEndpointV1[] = [],
) => {
  const states = new Map<string, RouteNeighborV1['state']>(
    [...routeEndpoints, ...connected, ...unknown].map((value) => [key(value), 'disconnected']),
  );
  for (const value of connected) states.set(key(value), 'connected');
  for (const value of unknown) states.set(key(value), 'unknown');
  const neighbors = [...states].map(([endpointKey, state]) => {
    const [side, elevation] = endpointKey.split(':');
    return {
      endpoint: endpoint(side as RouteSideV1, Number(elevation) as -1 | 0 | 1),
      state,
    };
  });
  return resolveRouteSegmentV1(definition, { entry, neighbors });
};

describe('Classic ordinary rail route configuration through the stdlib resolver', () => {
  it('keeps the two current straight variants resolvable in both directions', () => {
    expect(resolve(route, endpoint('west'), [endpoint('west'), endpoint('east')])).toMatchObject({
      status: 'segment',
      segment: { variant: 'seedlands:rail-east-west', edge: { slopeDelta: 0, curve: 'line' } },
    });
    expect(resolve(route, endpoint('east'), [endpoint('west'), endpoint('east')])).toMatchObject({
      status: 'segment',
      segment: { variant: 'seedlands:rail-east-west', edge: { slopeDelta: 0, curve: 'line' } },
    });
    expect(resolve(route, endpoint('north'), [endpoint('north'), endpoint('south')])).toMatchObject({
      status: 'segment',
      segment: { variant: 'seedlands:rail-north-south', edge: { slopeDelta: 0, curve: 'line' } },
    });
    expect(resolve(route, endpoint('south'), [endpoint('north'), endpoint('south')])).toMatchObject({
      status: 'segment',
      segment: { variant: 'seedlands:rail-north-south', edge: { slopeDelta: 0, curve: 'line' } },
    });
  });

  it.each([
    ['seedlands:rail-north-east', endpoint('north'), endpoint('east')],
    ['seedlands:rail-east-south', endpoint('east'), endpoint('south')],
    ['seedlands:rail-south-west', endpoint('south'), endpoint('west')],
    ['seedlands:rail-west-north', endpoint('west'), endpoint('north')],
  ] as const)(
    'resolves corner %s through the production Classic route in both directions',
    (variant, first, second) => {
      for (const entry of [first, second])
        expect(resolve(route, entry, [first, second])).toMatchObject({
          status: 'segment',
          segment: { variant, edge: { curve: 'quarter', slopeDelta: 0 } },
        });
    },
  );

  it.each([
    ['seedlands:rail-ascending-north', endpoint('south'), endpoint('north', 1)],
    ['seedlands:rail-ascending-east', endpoint('west'), endpoint('east', 1)],
    ['seedlands:rail-ascending-south', endpoint('north'), endpoint('south', 1)],
    ['seedlands:rail-ascending-west', endpoint('east'), endpoint('west', 1)],
  ] as const)(
    'resolves ascending/descending slope %s through the production Classic route',
    (variant, lower, upper) => {
      expect(resolve(route, lower, [lower, upper])).toMatchObject({
        status: 'segment',
        segment: { variant, edge: { curve: 'line', slopeDelta: 1 } },
      });
      expect(resolve(route, upper, [lower, upper])).toMatchObject({
        status: 'segment',
        segment: { variant, edge: { curve: 'line', slopeDelta: -1 } },
      });
    },
  );

  it.each([
    ['seedlands:rail-north-east', endpoint('north'), endpoint('east')],
    ['seedlands:rail-east-south', endpoint('east'), endpoint('south')],
    ['seedlands:rail-south-west', endpoint('south'), endpoint('west')],
    ['seedlands:rail-west-north', endpoint('west'), endpoint('north')],
    ['seedlands:rail-ascending-north', endpoint('south'), endpoint('north', 1)],
    ['seedlands:rail-ascending-east', endpoint('west'), endpoint('east', 1)],
    ['seedlands:rail-ascending-south', endpoint('north'), endpoint('south', 1)],
    ['seedlands:rail-ascending-west', endpoint('east'), endpoint('west', 1)],
  ] as const)('keeps %s disconnected when its far endpoint is known absent', (_variant, entry, exit) => {
    expect(resolve(route, entry, [entry])).toEqual({ status: 'disconnected' });
    expect(resolve(route, exit, [exit])).toEqual({ status: 'disconnected' });
  });

  it.each([
    ['seedlands:rail-north-east', endpoint('north'), endpoint('east'), endpoint('west')],
    ['seedlands:rail-east-south', endpoint('east'), endpoint('south'), endpoint('north')],
    ['seedlands:rail-south-west', endpoint('south'), endpoint('west'), endpoint('east')],
    ['seedlands:rail-west-north', endpoint('west'), endpoint('north'), endpoint('south')],
    ['seedlands:rail-ascending-north', endpoint('south'), endpoint('north', 1), endpoint('north')],
    ['seedlands:rail-ascending-east', endpoint('west'), endpoint('east', 1), endpoint('east')],
    ['seedlands:rail-ascending-south', endpoint('north'), endpoint('south', 1), endpoint('south')],
    ['seedlands:rail-ascending-west', endpoint('east'), endpoint('west', 1), endpoint('west')],
  ] as const)('does not guess %s when another candidate endpoint is unknown', (_variant, entry, exit, unknown) => {
    expect(resolve(route, entry, [entry, exit], [unknown]).status).toBe('unknown');
  });

  it('keeps unconfigured multi-connection junctions ambiguous and incomplete neighborhoods unknown', () => {
    expect(resolve(route, endpoint('north'), [endpoint('north'), endpoint('south'), endpoint('east')])).toMatchObject({
      status: 'ambiguous',
    });
    expect(resolve(route, endpoint('north'), [endpoint('north'), endpoint('south')], [endpoint('east')])).toMatchObject(
      {
        status: 'unknown',
      },
    );
  });
});

const transportConfig = composition.capability<FrozenTransportInteractionConfig>('seedlands:transport-interactions');
const content = gameplayContentForComposition(composition);
type Cell = readonly [number, number, number];
const hit: Cell = [2, 31, 2];
const direction = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;
const neighboringCell = ({ side, elevation }: RouteEndpointV1): Cell => [
  hit[0] + direction[side][0],
  hit[1] + elevation,
  hit[2] + direction[side][1],
];
function projectPlacedRails(connected: readonly RouteEndpointV1[], unknown: readonly Cell[] = []) {
  const cells = [hit, ...connected.map(neighboringCell)];
  const rails = new Set(cells.map((cell) => cell.join(',')));
  const unavailable = new Set(unknown.map((cell) => cell.join(',')));
  const getLoadedVoxel = (cell: Cell): number | undefined => {
    if (unavailable.has(cell.join(','))) return undefined;
    if (rails.has(cell.join(','))) return 39;
    if (cell[1] <= 30 || cells.some((rail) => rail[1] > 31 && rail.every((v, i) => v === cell[i]! + (i === 1 ? 1 : 0))))
      return 3;
    return 0;
  };
  return projectTransportDeploymentSite(
    {
      config: transportConfig,
      content,
      entities: new EntityStore(content.items, undefined, undefined, undefined, transportConfig.definitions),
      callbacks: {
        platform: testCorePlatform,
        getVoxel: getLoadedVoxel,
        getLoadedVoxel,
        getWorldTime: () => 8,
        prepareVoxelEdit: () => {
          throw new Error('Read-only deployment geometry must not edit the fixture.');
        },
      },
    },
    hit,
  ).options[0]!;
}

describe('Classic deployment from actual loaded rail cells with all configured shapes', () => {
  it.each([
    ['seedlands:rail-east-west', endpoint('west'), endpoint('east')],
    ['seedlands:rail-north-south', endpoint('north'), endpoint('south')],
    ['seedlands:rail-north-east', endpoint('north'), endpoint('east')],
    ['seedlands:rail-east-south', endpoint('east'), endpoint('south')],
    ['seedlands:rail-south-west', endpoint('south'), endpoint('west')],
    ['seedlands:rail-west-north', endpoint('west'), endpoint('north')],
    ['seedlands:rail-ascending-north', endpoint('south'), endpoint('north', 1)],
    ['seedlands:rail-ascending-east', endpoint('west'), endpoint('east', 1)],
    ['seedlands:rail-ascending-south', endpoint('north'), endpoint('south', 1)],
    ['seedlands:rail-ascending-west', endpoint('east'), endpoint('west', 1)],
  ] as const)('selects one %s shape for both potential entry directions', (variant, entry, exit) => {
    const option = projectPlacedRails([entry, exit]);
    expect(option.rejection).toBeNull();
    expect(option.routeCursor?.variant).toBe(variant);
    expect(option.routeCursor?.segmentLength).toBe(
      entry.elevation !== exit.elevation
        ? Math.SQRT2
        : ['seedlands:rail-east-west', 'seedlands:rail-north-south'].includes(variant)
          ? 1
          : Math.PI / 4,
    );
  });

  it('keeps a three-direction junction ambiguous rather than choosing a neighboring shape', () => {
    expect(projectPlacedRails([endpoint('north'), endpoint('east'), endpoint('south')]).rejection).toBe(
      'transport-route-ambiguous',
    );
  });

  it.each([
    ['north', 'south', 'seedlands:rail-north-south'],
    ['east', 'west', 'seedlands:rail-east-west'],
    ['south', 'north', 'seedlands:rail-north-south'],
    ['west', 'east', 'seedlands:rail-east-west'],
  ] as const)(
    'keeps the flat crest connected to its lower %s slope and level %s continuation',
    (lower, level, variant) => {
      const option = projectPlacedRails([endpoint(lower, -1), endpoint(level)]);
      expect(option.rejection).toBeNull();
      expect(option.routeCursor?.variant).toBe(variant);
      expect(option.routeCursor?.segmentLength).toBe(1);
      expect(option.routeCursor?.entry.elevation).toBe(0);
      expect(option.routeCursor?.exit.elevation).toBe(0);
      expect(option.position[1]).toBe(hit[1]);
    },
  );

  it.each([
    ['north', 'south', 'seedlands:rail-north-south'],
    ['east', 'west', 'seedlands:rail-east-west'],
  ] as const)('keeps a flat crest between two lower %s/%s slopes', (first, second, variant) => {
    const option = projectPlacedRails([endpoint(first, -1), endpoint(second, -1)]);
    expect(option.rejection).toBeNull();
    expect(option.routeCursor?.variant).toBe(variant);
    expect(option.routeCursor?.segmentLength).toBe(1);
    expect(option.position[1]).toBe(hit[1]);
  });

  it('keeps an unavailable possible raised neighbor unknown even when flat rails are visible', () => {
    expect(projectPlacedRails([endpoint('west'), endpoint('east')], [[3, 32, 2]]).rejection).toBe('chunk-unavailable');
  });
});
