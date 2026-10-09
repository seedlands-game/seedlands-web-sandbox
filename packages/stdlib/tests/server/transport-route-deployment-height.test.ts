import { expect, it, vi } from 'vitest';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { defaultGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { freezeTransportInteractionConfig } from '../../src/server/gameplay/modules/transport-interaction-config';
import { defineRouteDefinitionV1, type RouteEndpointV1 } from '../../src/server/gameplay/modules/route-definition';
import { projectTransportDeploymentSite } from '../../src/server/gameplay/transport-deployment-geometry';
import { createVoxelSemanticsRegistry } from '../../src/world/voxel-semantics';
import { testCorePlatform } from '../support/core-platform';

type Cell = readonly [number, number, number];
const hit: Cell = [0, 59, 0];
const content = {
  ...defaultGameplayContent,
  voxelSemantics: createVoxelSemanticsRegistry(
    [0, 500].map((storageId) => ({
      id: `sample:voxel-${storageId}`,
      storageId,
      solid: false,
      targetable: storageId !== 0,
      renderable: storageId !== 0,
      meshKind: 'cube' as const,
      emission: 0,
      lightCost: 1,
      faceMaterials: [4, 4, 4, 4, 4, 4] as const,
    })),
  ),
};
function project(
  entry: RouteEndpointV1,
  exit: RouteEndpointV1,
  cells: readonly Cell[],
  unknown: readonly Cell[] = [],
  flat = false,
  curve: 'line' | 'quarter' = 'line',
) {
  const pair = (from: RouteEndpointV1, to: RouteEndpointV1) => [
    { entry: from, exit: to, curve, slopeDelta: (to.elevation - from.elevation) as -1 | 0 | 1 },
    { entry: to, exit: from, curve, slopeDelta: (from.elevation - to.elevation) as -1 | 0 | 1 },
  ];
  const definition = defineRouteDefinitionV1({
    version: 1,
    family: 'sample:sloped-route',
    variants: [
      { variant: 'sample:slope', edges: pair(entry, exit) },
      ...(flat ? [{ variant: 'sample:flat', edges: pair(entry, { ...exit, elevation: entry.elevation }) }] : []),
    ],
  });
  const config = freezeTransportInteractionConfig({
    moduleId: 'sample:slope-deployment',
    operationId: 'sample:deploy-slope-pod',
    definitions: [
      {
        version: 1,
        id: 'sample:slope-pod',
        locomotion: { provider: 'route', providerId: definition.family },
        bodyAabb: { min: { x: -0.1, y: 0, z: -0.1 }, max: { x: 0.1, y: 0.2, z: 0.1 } },
        seatOffset: [0, 0.2, 0],
        presentationId: 'sample:slope-pod-model',
      },
    ],
    deployments: [],
    routes: [{ definition, voxels: [500] }],
    surfaces: [],
  });
  const loaded = new Set([hit, ...cells].map((cell) => cell.join(',')));
  const unavailable = new Set(unknown.map((cell) => cell.join(',')));
  const getLoadedVoxel = vi.fn((cell: Cell) =>
    unavailable.has(cell.join(',')) ? undefined : loaded.has(cell.join(',')) ? 500 : 0,
  );
  const site = projectTransportDeploymentSite(
    {
      config,
      content,
      entities: new EntityStore(undefined, undefined, undefined, undefined, config.definitions),
      callbacks: {
        platform: testCorePlatform,
        getVoxel: getLoadedVoxel,
        getLoadedVoxel,
        getWorldTime: () => 8,
        prepareVoxelEdit: () => {
          throw new Error('Deployment projection must not edit World');
        },
      },
    },
    hit,
  );
  return { option: site.options[0]!, getLoadedVoxel };
}

it.each([
  ['east', 'west', [1, 60, 0], [-1, 58, 0]],
  ['west', 'east', [-1, 60, 0], [1, 58, 0]],
  ['north', 'south', [0, 60, -1], [0, 58, 1]],
  ['south', 'north', [0, 60, 1], [0, 58, -1]],
] as const)('connects the %s slope to both literal neighboring cell origins', (high, low, above, below) => {
  const { option, getLoadedVoxel } = project({ side: low, elevation: 0 }, { side: high, elevation: 1 }, [above, below]);
  expect(option.rejection).toBeNull();
  expect(option.position).toEqual([0.5, 59.5, 0.5]);
  expect(option.routeCursor).toMatchObject({
    cell: [0, 59, 0],
    variant: 'sample:slope',
    entry: { side: low, elevation: 0 },
    exit: { side: high, elevation: 1 },
  });
  expect(getLoadedVoxel).toHaveBeenCalledWith(above);
  expect(getLoadedVoxel).toHaveBeenCalledWith(below);
});

it('rejects a same-family neighbor whose local opposite port has the wrong world height', () => {
  const { option } = project({ side: 'west', elevation: 0 }, { side: 'east', elevation: 1 }, [
    [1, 60, 0],
    [-1, 59, 0],
  ]);
  expect(option.rejection).toBe('transport-route-disconnected');
  expect(option.routeCursor).toBeNull();
});

it.each([
  ['east', 'west', [1, 58, 0], [-1, 60, 0]],
  ['west', 'east', [-1, 58, 0], [1, 60, 0]],
  ['north', 'south', [0, 58, -1], [0, 60, 1]],
  ['south', 'north', [0, 58, 1], [0, 60, -1]],
] as const)('connects the descending %s slope with negative local elevation', (low, high, below, above) => {
  const { option, getLoadedVoxel } = project({ side: high, elevation: 0 }, { side: low, elevation: -1 }, [
    below,
    above,
  ]);
  expect(option.rejection).toBeNull();
  expect(option.position).toEqual([0.5, 58.5, 0.5]);
  expect(getLoadedVoxel).toHaveBeenCalledWith(below);
  expect(getLoadedVoxel).toHaveBeenCalledWith(above);
});

it('rejects same-family voxels when the family has no opposite port on either side', () => {
  const { option } = project(
    { side: 'north', elevation: 0 },
    { side: 'east', elevation: 0 },
    [
      [0, 59, -1],
      [1, 59, 0],
    ],
    [],
    false,
    'quarter',
  );
  expect(option.rejection).toBe('transport-route-disconnected');
  expect(option.routeCursor).toBeNull();
});

it('keeps an unloaded compatible opposite-port origin unavailable', () => {
  const { option } = project(
    { side: 'west', elevation: 0 },
    { side: 'east', elevation: 1 },
    [[1, 60, 0]],
    [[-1, 58, 0]],
  );
  expect(option.rejection).toBe('chunk-unavailable');
  expect(option.routeCursor).toBeNull();
});

it('rejects multiple compatible neighbors at different heights instead of choosing one', () => {
  const { option } = project(
    { side: 'west', elevation: 0 },
    { side: 'east', elevation: 1 },
    [
      [-1, 58, 0],
      [-1, 59, 0],
      [1, 60, 0],
    ],
    [],
    true,
  );
  expect(option.rejection).toBe('transport-route-ambiguous');
  expect(option.routeCursor).toBeNull();
});

it('keeps an unloaded possible neighbor unknown even when another height connects', () => {
  const { option } = project(
    { side: 'west', elevation: 0 },
    { side: 'east', elevation: 1 },
    [
      [-1, 58, 0],
      [1, 60, 0],
    ],
    [[-1, 59, 0]],
    true,
  );
  expect(option.rejection).toBe('chunk-unavailable');
  expect(option.routeCursor).toBeNull();
});
