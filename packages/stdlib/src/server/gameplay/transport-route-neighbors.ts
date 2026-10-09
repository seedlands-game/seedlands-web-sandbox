import type { FrozenTransportInteractionConfig } from './modules/transport-interaction-config';
import type { RouteEndpointV1, RouteNeighborV1 } from './modules/route-definition';

type Cell = readonly [number, number, number];
type Route = FrozenTransportInteractionConfig['routes'][number];
export type LoadedRouteReader = (cell: Cell) => number | undefined;
const sides = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;
const opposite = { north: 'south', east: 'west', south: 'north', west: 'east' } as const;
export const routeEndpoints = (route: Route) => [
  ...new Map(
    route.definition.variants
      .flatMap((variant) => variant.edges.flatMap((edge) => [edge.entry, edge.exit]))
      .map((endpoint) => [`${endpoint.side}:${endpoint.elevation}`, endpoint]),
  ).values(),
];

export function loadedRouteConnections(route: Route, cell: Cell, endpoint: RouteEndpointV1, read: LoadedRouteReader) {
  const delta = sides[endpoint.side];
  return routeEndpoints(route)
    .filter((entry) => entry.side === opposite[endpoint.side])
    .map((entry) => {
      const next: Cell = [cell[0] + delta[0], cell[1] + endpoint.elevation - entry.elevation, cell[2] + delta[1]];
      const voxel = next.every(Number.isSafeInteger) ? read(next) : undefined;
      return {
        cell: next,
        entry,
        state:
          voxel === undefined
            ? ('unknown' as const)
            : route.voxels.includes(voxel)
              ? ('connected' as const)
              : ('disconnected' as const),
      };
    });
}

export function projectLoadedRouteNeighbors(route: Route, cell: Cell, read: LoadedRouteReader) {
  let ambiguous = false;
  const neighbors: RouteNeighborV1[] = routeEndpoints(route).map((endpoint) => {
    const probes = loadedRouteConnections(route, cell, endpoint, read);
    const connected = probes.filter((probe) => probe.state === 'connected').length;
    if (connected > 1) ambiguous = true;
    return {
      endpoint,
      state: probes.some((probe) => probe.state === 'unknown') ? 'unknown' : connected ? 'connected' : 'disconnected',
    };
  });
  return { neighbors, ambiguous };
}
