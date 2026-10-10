import { expect, it } from 'vitest';
import { defineRouteDefinitionV1, type RouteDirectedEdgeV1 } from '../../src/server/gameplay/modules/route-definition';
import {
  freezeTransportInteractionConfig,
  transportDefinitionIdentity,
  type TransportInteractionConfig,
} from '../../src/server/gameplay/modules/transport-interaction-config';
import { guideway, routeTransport } from './transport-motion-test-fixtures';

type EdgeTuple = readonly [
  RouteDirectedEdgeV1['entry']['side'],
  -1 | 0 | 1,
  RouteDirectedEdgeV1['exit']['side'],
  -1 | 0 | 1,
  'line' | 'quarter',
  -1 | 0 | 1,
];
type EncodedRoute = {
  definition: {
    version: 1;
    family: string;
    variants: readonly (readonly [string, readonly EdgeTuple[]])[];
    placementTieBreaks: readonly (readonly [string, readonly (readonly [EdgeTuple[0], -1 | 0 | 1])[]])[];
  };
  voxels: readonly number[];
};

const input = (): TransportInteractionConfig => {
  const route = guideway();
  return {
    moduleId: 'sample:identity-module',
    operationId: 'sample:identity-operation',
    definitions: [routeTransport()],
    deployments: [{ itemId: 'pod-item', definitionId: 'sample:route-pod' }],
    routes: [
      { definition: route, voxels: [6] },
      { definition: defineRouteDefinitionV1({ ...route, family: 'sample:second-guideway' }), voxels: [7] },
    ],
    surfaces: [{ id: 'sample:unused-surface', voxels: [8], surfaceOffset: 0.25 }],
  };
};

it('keeps the original identity bytes for an existing configuration within the checkpoint budget', () => {
  const config = freezeTransportInteractionConfig({ ...input(), routes: [input().routes[0]!] });
  const original = JSON.stringify({ ...config, definitions: config.definitions.list() });
  expect(original.length).toBeLessThanOrEqual(4096);
  expect(transportDefinitionIdentity(config)).toBe(original);
});

it('preserves every definition field in a bounded identity for a larger valid route configuration', () => {
  const config = freezeTransportInteractionConfig(input());
  const original = JSON.stringify({ ...config, definitions: config.definitions.list() });
  expect(original.length).toBeGreaterThan(4096);
  const identity = transportDefinitionIdentity(config);
  expect(identity.length).toBeLessThanOrEqual(4096);
  const { format, routes, ...other } = JSON.parse(identity) as {
    format: string;
    routes: EncodedRoute[];
  };
  expect(format).toBe('seedlands:transport-definition-tuples:1');
  const restored = {
    ...other,
    routes: routes.map(({ definition, voxels }) => ({
      voxels,
      definition: {
        version: definition.version,
        family: definition.family,
        variants: definition.variants.map(([variant, edges]) => ({
          variant,
          edges: edges.map(([entrySide, entryElevation, exitSide, exitElevation, curve, slopeDelta]) => ({
            entry: { side: entrySide, elevation: entryElevation },
            exit: { side: exitSide, elevation: exitElevation },
            curve,
            slopeDelta,
          })),
        })),
        placementTieBreaks: definition.placementTieBreaks.map(([variant, connected]) => ({
          variant,
          connected: connected.map(([side, elevation]) => ({ side, elevation })),
        })),
      },
    })),
  };
  expect(restored).toEqual(JSON.parse(original));
});

it('distinguishes reversed edge order and fuel capacities in the larger identity', () => {
  const source = input();
  const before = transportDefinitionIdentity(freezeTransportInteractionConfig(source));
  const changedRoute = defineRouteDefinitionV1({
    ...source.routes[0]!.definition,
    variants: source.routes[0]!.definition.variants.map((variant) => ({
      ...variant,
      edges: [...variant.edges].reverse(),
    })),
  });
  const reordered = freezeTransportInteractionConfig({
    ...source,
    routes: [{ ...source.routes[0]!, definition: changedRoute }, source.routes[1]!],
  });
  expect(transportDefinitionIdentity(reordered)).not.toBe(before);
  const refueled = freezeTransportInteractionConfig({
    ...source,
    definitions: [{ ...source.definitions[0]!, fuelCapacity: 99 }],
  });
  expect(transportDefinitionIdentity(refueled)).not.toBe(before);
});

it('rejects an identity that still exceeds the unchanged checkpoint budget during configuration', () => {
  const config = freezeTransportInteractionConfig({ ...input(), operationId: `sample:${'operation'.repeat(600)}` });
  expect(() => transportDefinitionIdentity(config)).toThrow(/checkpoint.*budget/i);
});
