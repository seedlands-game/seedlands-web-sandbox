import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '../../src/physics/body-registry';
import type { AuthorityPhysicsFrame } from '../../src/server/authority/authority-physics-frame';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { freezeTransportInteractionConfig } from '../../src/server/gameplay/modules/transport-interaction-config';
import { createTransportDefinitionRegistryV1 } from '../../src/server/gameplay/modules/transport-model';
import { projectRouteMotion } from '../../src/server/gameplay/transport-route-motion-geometry';
import { guideway, routeState, segmentFor } from './transport-motion-test-fixtures';

const policy = {
  definitionId: 'sample:route-pod',
  acceleration: 0,
  drag: 0,
  maxSpeed: 8,
  steeringRate: 0,
  fuelPerMeter: 0,
};

const setup = (
  segment = segmentFor('sample:straight'),
  options: {
    progress?: number;
    voxel?: number | undefined;
    rider?: boolean;
    seatOffset?: readonly [number, number, number];
    bodyAabb?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  } = {},
) => {
  const definition = createTransportDefinitionRegistryV1([
    {
      version: 1,
      id: 'sample:route-pod',
      locomotion: { provider: 'route', providerId: 'sample:guideway' },
      bodyAabb: options.bodyAabb ?? { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
      seatOffset: options.seatOffset ?? [0.5, 0.75, 0],
      fuelCapacity: 100,
      inventoryCapacity: 2,
      presentationId: 'sample:route-pod-model',
    },
  ]).require('sample:route-pod');
  const allRoutes = guideway();
  const route = {
    ...allRoutes,
    variants: allRoutes.variants.filter((entry) => ['sample:straight', 'sample:slope-east'].includes(entry.variant)),
  };
  const config = freezeTransportInteractionConfig({
    moduleId: 'sample:route-motion',
    operationId: 'sample:advance-route',
    definitions: [definition],
    deployments: [],
    routes: [{ definition: route, voxels: [6] }],
    surfaces: [],
  });
  const entities = new EntityStore(
    createItemDefinitionRegistry([
      { id: 'sample:cargo', name: 'Cargo', itemType: 'resource', stackLimit: 64, capabilities: [] },
    ]),
    undefined,
    undefined,
    undefined,
    config.definitions,
  );
  const rider = options.rider ? entities.spawn({ id: 'rider', type: 'player', position: [0, 0, 0] }) : null;
  const riderReference = rider ? entities.createReference(rider.id)! : null;
  const source = routeState(segment, options.progress ?? 0, {
    inventory: [{ itemId: 'sample:cargo', count: 2 }, null],
    fuel: 7,
    rider: riderReference,
  });
  const initial = entities.spawn({
    id: 'transport-a',
    type: 'transport',
    position: source.pose.position,
    physicsVelocity: source.velocity,
    transport: {
      definitionId: definition.id,
      yaw: source.pose.yaw,
      routeCursor: source.routeCursor,
      rider: source.rider ? { entityId: source.rider.entityId, lifetime: source.rider.lifetime } : null,
      fuel: source.fuel,
      inventory: source.inventory,
    },
  });
  const reference = entities.createReference(initial.id)!;
  const state = entities.transportState(reference)!;
  const queries: Array<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }> = [];
  const frame: AuthorityPhysicsFrame = {
    epoch: 'route-geometry',
    physicsTick: 4,
    seconds: 0.25,
    playerReference: riderReference,
    playerWish: { x: 0, z: 0 },
    acknowledgedSequence: 3,
    updates: [{ id: initial.id, update: { position: [...state.pose.position], physicsVelocity: [...state.velocity] } }],
    world: {
      querySolids(bounds) {
        queries.push(bounds);
        return [];
      },
    },
    bodyConfigs: rider ? new Map([[rider.id, bodyConfigFor('player')]]) : new Map(),
  };
  const reads: Array<readonly number[]> = [];
  const optionsVoxel = Object.hasOwn(options, 'voxel') ? options.voxel : 6;
  const callbacks = {
    getLoadedVoxel(position: readonly number[]) {
      reads.push([...position]);
      if (
        position[0] === state.routeCursor!.cell[0] &&
        position[1] === state.routeCursor!.cell[1] &&
        position[2] === state.routeCursor!.cell[2]
      )
        return optionsVoxel;
      return 0;
    },
  };
  return { config, definition, entities, state, frame, queries, reads, callbacks, route };
};

describe('mounted rider segment handoff sweep', () => {
  it.each(['world', 'unknown', 'entity', 'clear'] as const)('checks the old-to-new seat path against %s', (kind) => {
    const segment = segmentFor('sample:slope-east');
    const options = setup(segment, {
      progress: segment.length - 0.1,
      rider: true,
      seatOffset: [0, 2, 0],
      bodyAabb: { min: { x: -0.01, y: -0.01, z: -0.01 }, max: { x: 0.01, y: 0.01, z: 0.01 } },
    });
    options.callbacks.getLoadedVoxel = (cell) =>
      cell[2] === 0 && ((cell[0] === 0 && cell[1] === 0) || (cell[0] >= 1 && cell[0] <= 2 && cell[1] === 1)) ? 6 : 0;
    const collider = {
      id: kind === 'unknown' ? 'unknown:seat-handoff' : 'seat-handoff-obstacle',
      aabb: { min: { x: 0.05, y: 2.65, z: 0.4 }, max: { x: 0.15, y: 2.75, z: 0.6 } },
    };
    options.frame = {
      ...options.frame,
      world: { querySolids: () => (kind === 'world' || kind === 'unknown' ? [collider] : []) },
    };
    if (kind === 'entity') {
      const obstacle = options.entities.spawn({ id: collider.id, type: 'player', position: [0, 0, 0] });
      options.frame = {
        ...options.frame,
        bodyConfigs: new Map([
          ...options.frame.bodyConfigs,
          [obstacle.id, { ...bodyConfigFor('player'), localAabb: collider.aabb }],
        ]),
      };
    }
    const candidate = projectRouteMotion({ ...options, policy, policies: [policy] });
    if (kind === 'clear') {
      expect(candidate.stopReason).toBeNull();
      expect(candidate.next.routeCursor!.cell).toEqual([1, 1, 0]);
    } else {
      expect(candidate.stopReason).toBe(
        kind === 'unknown' ? 'frontier-unknown' : kind === 'entity' ? 'entity-collision' : 'world-collision',
      );
      expect(candidate.next.routeCursor!.cell).toEqual([0, 0, 0]);
      expect(candidate.next.routeCursor!.progress).toBeCloseTo(segment.length);
      expect(candidate.next.pose.position).toEqual([1, 1, 0.5]);
      expect(candidate.next.velocity).toEqual([0, 0, 0]);
    }
  });
});
