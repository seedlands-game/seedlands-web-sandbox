import {
  advanceRouteSegmentV1,
  createTransportDefinitionRegistryV1,
  defineRouteDefinitionV1,
  type RouteDefinitionV1,
  type RouteEndpointV1,
  type RouteSegmentV1,
  type TransportCollisionV1,
  type TransportStateV2,
} from '../../src/server/composition/mod-api';

export const reference = (entityId: string, lifetime: number) => ({ entityId, epoch: 2, lifetime });
export const routeTransport = () =>
  createTransportDefinitionRegistryV1([
    {
      version: 1,
      id: 'sample:route-pod',
      locomotion: { provider: 'route', providerId: 'sample:guideway' },
      bodyAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
      seatOffset: [0.5, 0.75, 0],
      fuelCapacity: 100,
      presentationId: 'sample:route-pod-model',
    },
  ]).require('sample:route-pod');
export const surfaceDefinition = () =>
  createTransportDefinitionRegistryV1([
    {
      version: 1,
      id: 'sample:surface-pod',
      locomotion: { provider: 'surface', providerId: 'sample:fluid-surface' },
      bodyAabb: { min: { x: -0.8, y: 0, z: -1 }, max: { x: 0.8, y: 0.7, z: 1 } },
      seatOffset: [0.5, 0.4, 0],
      fuelCapacity: 100,
      presentationId: 'sample:surface-pod-model',
    },
  ]).require('sample:surface-pod');

export const routeState = (
  segment: RouteSegmentV1,
  progress = 0,
  overrides: Partial<TransportStateV2> = {},
): TransportStateV2 => {
  const local = advanceRouteSegmentV1(segment, 0, progress);
  return {
    version: 2,
    reference: reference('transport-a', 10),
    definitionId: 'sample:route-pod',
    pose: { position: local.position, yaw: Math.atan2(local.tangent[0], local.tangent[2]) },
    velocity: [local.tangent[0] * 2, local.tangent[1] * 2, local.tangent[2] * 2],
    routeCursor: {
      family: segment.family,
      cell: [0, 0, 0],
      variant: segment.variant,
      entry: segment.edge.entry,
      exit: segment.edge.exit,
      progress,
      segmentLength: segment.length,
    },
    rider: null,
    fuel: 10,
    inventory: [],
    ...overrides,
  };
};

export const surfaceState = (overrides: Partial<TransportStateV2> = {}): TransportStateV2 => ({
  version: 2,
  reference: reference('transport-s', 11),
  definitionId: 'sample:surface-pod',
  pose: { position: [0, 0, 0], yaw: 0 },
  velocity: [0, 0, 4],
  routeCursor: null,
  rider: null,
  fuel: 10,
  inventory: [],
  ...overrides,
});

export const policy = { seconds: 0.25, throttle: 0 as const, acceleration: 0, drag: 0, maxSpeed: 8, fuelPerMeter: 0 };
export const clear = () => 'clear' as TransportCollisionV1;
export const edgePair = (entry: RouteEndpointV1, exit: RouteEndpointV1, curve: 'line' | 'quarter') =>
  [
    { entry, exit, curve, slopeDelta: (exit.elevation - entry.elevation) as -1 | 0 | 1 },
    { entry: exit, exit: entry, curve, slopeDelta: (entry.elevation - exit.elevation) as -1 | 0 | 1 },
  ] as const;
export const routeInput = () => ({
  version: 1 as const,
  family: 'sample:guideway',
  variants: [
    {
      variant: 'sample:straight',
      edges: edgePair({ side: 'west', elevation: 0 }, { side: 'east', elevation: 0 }, 'line'),
    },
    {
      variant: 'sample:north-south',
      edges: edgePair({ side: 'south', elevation: 0 }, { side: 'north', elevation: 0 }, 'line'),
    },
    {
      variant: 'sample:corner-ne',
      edges: edgePair({ side: 'north', elevation: 0 }, { side: 'east', elevation: 0 }, 'quarter'),
    },
    {
      variant: 'sample:corner-es',
      edges: edgePair({ side: 'east', elevation: 0 }, { side: 'south', elevation: 0 }, 'quarter'),
    },
    {
      variant: 'sample:corner-sw',
      edges: edgePair({ side: 'south', elevation: 0 }, { side: 'west', elevation: 0 }, 'quarter'),
    },
    {
      variant: 'sample:corner-wn',
      edges: edgePair({ side: 'west', elevation: 0 }, { side: 'north', elevation: 0 }, 'quarter'),
    },
    {
      variant: 'sample:slope-north',
      edges: edgePair({ side: 'south', elevation: 0 }, { side: 'north', elevation: 1 }, 'line'),
    },
    {
      variant: 'sample:slope-east',
      edges: edgePair({ side: 'west', elevation: 0 }, { side: 'east', elevation: 1 }, 'line'),
    },
    {
      variant: 'sample:slope-south',
      edges: edgePair({ side: 'north', elevation: 0 }, { side: 'south', elevation: 1 }, 'line'),
    },
    {
      variant: 'sample:slope-west',
      edges: edgePair({ side: 'east', elevation: 0 }, { side: 'west', elevation: 1 }, 'line'),
    },
  ],
});
export const guideway = (): RouteDefinitionV1 => defineRouteDefinitionV1(routeInput());
export const segmentFor = (variant: string, direction = 0): RouteSegmentV1 => {
  const definition = guideway();
  const edge = definition.variants.find((entry) => entry.variant === variant)?.edges[direction];
  if (!edge) throw new Error('Missing route fixture segment.');
  return {
    family: definition.family,
    variant,
    edge,
    length: edge.curve === 'quarter' ? Math.PI / 4 : Math.hypot(1, edge.slopeDelta),
  };
};
export const directedCases = [
  segmentFor('sample:north-south'),
  segmentFor('sample:straight'),
  segmentFor('sample:corner-ne'),
  segmentFor('sample:corner-es'),
  segmentFor('sample:corner-sw'),
  segmentFor('sample:corner-wn'),
  ...['north', 'east', 'south', 'west'].flatMap((side) => [
    segmentFor('sample:slope-' + side),
    segmentFor('sample:slope-' + side, 1),
  ]),
];
export const straight = (): RouteSegmentV1 => segmentFor('sample:straight');
export const descending = (): RouteSegmentV1 => segmentFor('sample:slope-east', 1);
export const corner = (): RouteSegmentV1 => segmentFor('sample:corner-ne');
