import type { EntityStore } from './entity-store';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { GameplayContent } from './gameplay-content';
import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { overlapDepth, translateAabb } from '../../physics/geometry';
import type { WorldAabb } from '../../physics/types';
import { collisionBoxesForVoxel } from '../../world/voxel-model';
import { transportBodyConfig } from './transport-body-config';
import { advanceRouteSegmentV1, resolveRouteSegmentV1, type RouteNeighborV1 } from './modules/route-definition';
import type { TransportDefinitionV1 } from './modules/transport-model';
import type { FrozenTransportInteractionConfig } from './modules/transport-interaction-config';
import type { TransportDeploymentOptionV1, TransportDeploymentSiteV1 } from './modules/transport-deployment-model';

type Position = readonly [number, number, number];
type Options = Readonly<{
  config: FrozenTransportInteractionConfig;
  entities: EntityStore;
  content: GameplayContent;
  callbacks: GameplayCallbacks;
}>;
const offset = (position: Position) => ({ x: position[0], y: position[1], z: position[2] });
const sideOffset = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;
const oppositeSide = { north: 'south', east: 'west', south: 'north', west: 'east' } as const;

function placement(options: Options, definition: TransportDefinitionV1, hit: Position): TransportDeploymentOptionV1 {
  const voxel = options.callbacks.getLoadedVoxel?.([...hit]);
  const position: Position = Object.freeze([hit[0] + 0.5, hit[1], hit[2] + 0.5]);
  const rejected = (rejection: string): TransportDeploymentOptionV1 =>
    Object.freeze({ definitionId: definition.id, position, yaw: 0, routeCursor: null, rejection });
  if (voxel === undefined) return rejected('chunk-unavailable');
  if (definition.locomotion.provider === 'surface') {
    const surface = options.config.surfaces.find((entry) => entry.id === definition.locomotion.providerId)!;
    if (!surface.voxels.includes(voxel)) return rejected('transport-surface-invalid');
    return Object.freeze({
      definitionId: definition.id,
      position: Object.freeze([position[0], hit[1] + surface.surfaceOffset, position[2]] as const),
      yaw: 0,
      routeCursor: null,
      rejection: null,
    });
  }
  const route = options.config.routes.find((entry) => entry.definition.family === definition.locomotion.providerId)!;
  if (!route.voxels.includes(voxel)) return rejected('transport-route-invalid');
  const endpoints = [
    ...new Map(
      route.definition.variants
        .flatMap((variant) => variant.edges.flatMap((edge) => [edge.entry, edge.exit]))
        .map((entry) => [`${entry.side}:${entry.elevation}`, entry]),
    ).values(),
  ];
  let ambiguousNeighbor = false;
  const neighbors: RouteNeighborV1[] = endpoints.map((endpoint) => {
    const delta = sideOffset[endpoint.side];
    const oppositeElevations = new Set(
      endpoints.filter((entry) => entry.side === oppositeSide[endpoint.side]).map((entry) => entry.elevation),
    );
    let connected = 0;
    let unknown = false;
    for (const elevation of oppositeElevations) {
      // Endpoint elevations are local to each cell, so both participate in world-height equality.
      const cell: Position = [hit[0] + delta[0], hit[1] + endpoint.elevation - elevation, hit[2] + delta[1]];
      const next = cell.every(Number.isSafeInteger) ? options.callbacks.getLoadedVoxel?.([...cell]) : undefined;
      if (next === undefined) unknown = true;
      else if (route.voxels.includes(next)) connected++;
    }
    if (connected > 1) ambiguousNeighbor = true;
    return {
      endpoint,
      state: unknown ? 'unknown' : connected ? 'connected' : 'disconnected',
    };
  });
  const resolutions = endpoints.map((entry) => resolveRouteSegmentV1(route.definition, { entry, neighbors }));
  if (resolutions.some((result) => result.status === 'unknown')) return rejected('chunk-unavailable');
  if (ambiguousNeighbor || resolutions.some((result) => result.status === 'ambiguous'))
    return rejected('transport-route-ambiguous');
  const segments = resolutions.flatMap((result) => (result.status === 'segment' ? [result.segment] : []));
  if (!segments.length) return rejected('transport-route-disconnected');
  if (new Set(segments.map((segment) => segment.variant)).size !== 1) return rejected('transport-route-ambiguous');
  const segment = segments[0]!;
  const progress = segment.length / 2;
  const sample = advanceRouteSegmentV1(segment, progress, 0);
  return Object.freeze({
    definitionId: definition.id,
    position: Object.freeze(
      sample.position.map((coordinate, axis) => coordinate + hit[axis]) as [number, number, number],
    ),
    yaw: Math.atan2(sample.tangent[0], sample.tangent[2]),
    routeCursor: Object.freeze({
      family: segment.family,
      cell: Object.freeze([...hit]) as Position,
      variant: segment.variant,
      entry: segment.edge.entry,
      exit: segment.edge.exit,
      progress,
      segmentLength: segment.length,
    }),
    rejection: null,
  });
}

function collisionRejection(options: Options, option: TransportDeploymentOptionV1): string | null {
  const definition = options.config.definitions.require(option.definitionId);
  return loadedTransportBodyRejection(options, transportBodyConfig(definition, option.yaw).localAabb, option.position);
}

export function loadedTransportBodyRejection(
  options: Options,
  localAabb: WorldAabb,
  position: Position,
  excludedEntities: readonly string[] = [],
): string | null {
  const worldRejection = loadedWorldBodyRejection(options, localAabb, position);
  if (worldRejection) return worldRejection;
  const bounds = translateAabb(localAabb, offset(position));
  for (const entity of options.entities.query()) {
    if (entity.type === 'station' || excludedEntities.includes(entity.id)) continue;
    const transport = entity.type === 'transport' ? options.entities.transportComponentSnapshot(entity.id) : null;
    const local = transport
      ? transportBodyConfig(options.config.definitions.require(transport.definitionId), transport.yaw).localAabb
      : bodyConfigFor(bodyKindForEntity(entity)).localAabb;
    if (overlapDepth(bounds, translateAabb(local, offset(entity.position)))) return 'target-occupied';
  }
  return null;
}

export function loadedWorldBodyRejection(
  options: Readonly<{
    callbacks: Pick<GameplayCallbacks, 'getLoadedVoxel' | 'voxelGeometry'>;
    content: Pick<GameplayContent, 'voxelSemantics'>;
  }>,
  localAabb: WorldAabb,
  position: Position,
): string | null {
  const bounds = translateAabb(localAabb, offset(position));
  if (
    !position.every(Number.isFinite) ||
    (['x', 'y', 'z'] as const).some((axis) => bounds.max[axis] <= bounds.min[axis])
  )
    return 'transport-body-invalid';
  const from = [bounds.min.x, bounds.min.y, bounds.min.z].map((value) => Math.floor(value + 1e-8));
  const to = [bounds.max.x, bounds.max.y, bounds.max.z].map((value) => Math.floor(value - 1e-8));
  if (![...from, ...to].every(Number.isSafeInteger) || to.some((value, axis) => value < from[axis]!))
    return 'transport-body-invalid';
  if (to.reduce((count, value, axis) => count * (value - from[axis]! + 1), 1) > 4096) return 'transport-body-capacity';
  let occupied = false;
  for (let x = from[0]!; x <= to[0]!; x++)
    for (let y = from[1]!; y <= to[1]!; y++)
      for (let z = from[2]!; z <= to[2]!; z++) {
        const voxel = options.callbacks.getLoadedVoxel?.([x, y, z]);
        if (voxel === undefined) return 'chunk-unavailable';
        const semantics = options.content.voxelSemantics.get(voxel);
        if (!semantics) return 'transport-voxel-unregistered';
        const geometry = options.callbacks.voxelGeometry?.get(voxel);
        const boxes = geometry
          ? geometry.collision
          : !semantics.solid
            ? []
            : semantics.meshKind === 'model'
              ? collisionBoxesForVoxel(voxel)
              : [{ min: [0, 0, 0] as const, max: [1, 1, 1] as const }];
        for (const box of boxes)
          if (
            overlapDepth(bounds, {
              min: { x: x + box.min[0], y: y + box.min[1], z: z + box.min[2] },
              max: { x: x + box.max[0], y: y + box.max[1], z: z + box.max[2] },
            })
          )
            occupied = true;
      }
  return occupied ? 'target-occupied' : null;
}

export function projectTransportDeploymentSite(options: Options, hit: Position): TransportDeploymentSiteV1 {
  if (hit.length !== 3 || !hit.every(Number.isSafeInteger)) throw new TypeError('Transport site is invalid.');
  const candidates = options.config.definitions.list().map((definition) => placement(options, definition, hit));
  return Object.freeze({
    version: 1,
    hit: Object.freeze([...hit]) as Position,
    options: Object.freeze(
      candidates.map((option) =>
        option.rejection ? option : Object.freeze({ ...option, rejection: collisionRejection(options, option) }),
      ),
    ),
  });
}
