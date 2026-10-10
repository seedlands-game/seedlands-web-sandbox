import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '../../src/physics/body-registry';
import { sweepBodyThroughWorld } from '../../src/physics';
import type { AuthorityPhysicsFrame } from '../../src/server/authority/authority-physics-frame';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { freezeTransportInteractionConfig } from '../../src/server/gameplay/modules/transport-interaction-config';
import { createTransportDefinitionRegistryV1 } from '../../src/server/gameplay/modules/transport-model';
import { projectRouteMotion } from '../../src/server/gameplay/transport-route-motion-geometry';
import { projectSurfaceMotion } from '../../src/server/gameplay/transport-motion-geometry';
import { transportBodyConfig } from '../../src/server/gameplay/transport-body-config';
import { guideway, routeState, segmentFor } from './transport-motion-test-fixtures';

describe('mixed transport motion geometry projection', () => {
  it('detects synchronized surface-versus-route collision when the route carrier follows a quarter arc', () => {
    const route = guideway();
    const surfaceDefinition = {
      version: 1 as const,
      id: 'sample:surface-pod',
      locomotion: { provider: 'surface' as const, providerId: 'sample:fluid-surface' },
      bodyAabb: { min: { x: -0.14, y: 0, z: -0.005 }, max: { x: -0.13, y: 0.2, z: 0.005 } },
      seatOffset: [0, 0, 0] as const,
      fuelCapacity: 100,
      inventoryCapacity: 2,
      presentationId: 'sample:surface-pod-model',
    };
    const routeDefinition = {
      version: 1 as const,
      id: 'sample:arc-pod',
      locomotion: { provider: 'route' as const, providerId: 'sample:guideway' },
      bodyAabb: { min: { x: -0.005, y: 0, z: -0.005 }, max: { x: 0.005, y: 0.2, z: 0.005 } },
      seatOffset: [0, 0, 0] as const,
      fuelCapacity: 100,
      inventoryCapacity: 2,
      presentationId: 'sample:arc-pod-model',
    };
    const definitions = createTransportDefinitionRegistryV1([surfaceDefinition, routeDefinition]);
    const config = freezeTransportInteractionConfig({
      moduleId: 'sample:surface-motion',
      operationId: 'sample:advance',
      definitions: [surfaceDefinition, routeDefinition],
      deployments: [],
      routes: [{ definition: route, voxels: [6] }],
      surfaces: [{ id: 'sample:fluid-surface', voxels: [6], surfaceOffset: 0 }],
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
    const riderEntity = entities.spawn({ id: 'surface-rider', type: 'player', position: [0.5, 0, 0.8] });
    const rider = entities.createReference(riderEntity.id)!;
    const ownEntity = entities.spawn({
      id: 'transport-surface',
      type: 'transport',
      position: [0.5, 0, 0.8],
      physicsVelocity: [0, 0, -2],
      transport: {
        definitionId: 'sample:surface-pod',
        yaw: Math.PI,
        routeCursor: null,
        rider: { entityId: rider.entityId, lifetime: rider.lifetime },
        fuel: 7,
        inventory: [{ itemId: 'sample:cargo', count: 2 }, null],
      },
    });
    const otherSource = routeState(segmentFor('sample:corner-ne'), 0, {
      definitionId: 'sample:arc-pod',
      pose: { position: [0.5, 0, 0], yaw: 0 },
      velocity: [0, 0, 0.5 / 0.3061197525],
      inventory: [{ itemId: 'sample:cargo', count: 1 }, null],
      fuel: 5,
    });
    const otherEntity = entities.spawn({
      id: 'transport-arc',
      type: 'transport',
      position: otherSource.pose.position,
      physicsVelocity: otherSource.velocity,
      transport: {
        definitionId: otherSource.definitionId,
        yaw: otherSource.pose.yaw,
        routeCursor: otherSource.routeCursor,
        rider: null,
        fuel: otherSource.fuel,
        inventory: otherSource.inventory,
      },
    });
    const own = entities.transportState(entities.createReference(ownEntity.id)!)!;
    const other = entities.transportState(entities.createReference(otherEntity.id)!)!;
    const frameSeconds = 0.3061197525;
    const ownEnd: readonly [number, number, number] = [0.5, 0, 0.187760495];
    const otherEnd: readonly [number, number, number] = [0.7298488470659301, 0, 0.4207354924039483];
    const ownPolicy = {
      definitionId: own.definitionId,
      acceleration: 0,
      drag: 0,
      maxSpeed: 8,
      steeringRate: 0,
      fuelPerMeter: 0,
    };
    const otherPolicy = { ...ownPolicy, definitionId: other.definitionId };
    const policyList = [ownPolicy, otherPolicy];
    const queries: Array<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }> = [];
    const frame: AuthorityPhysicsFrame = {
      epoch: 'surface-route-geometry',
      physicsTick: 10,
      seconds: frameSeconds,
      playerReference: rider,
      playerWish: { x: 0, z: -1 },
      acknowledgedSequence: 1,
      updates: [
        { id: ownEntity.id, update: { position: [...ownEnd], physicsVelocity: [...own.velocity] } },
        {
          id: otherEntity.id,
          update: {
            position: [...otherEnd],
            physicsVelocity: [(0.5 / frameSeconds) * 0.8414709848, 0, (0.5 / frameSeconds) * 0.5403023059],
          },
        },
      ],
      world: {
        querySolids(bounds) {
          queries.push(bounds);
          return [];
        },
      },
      bodyConfigs: new Map([
        [
          rider.entityId,
          {
            ...bodyConfigFor('player'),
            localAabb: { min: { x: -0.001, y: 0, z: -0.001 }, max: { x: 0.001, y: 0.2, z: 0.001 } },
          },
        ],
        [ownEntity.id, transportBodyConfig(definitions.require(own.definitionId), own.pose.yaw)],
        [otherEntity.id, transportBodyConfig(definitions.require(other.definitionId), other.pose.yaw)],
      ]),
    };
    const firstPassFrame: AuthorityPhysicsFrame = {
      ...frame,
      updates: [
        { id: ownEntity.id, update: { position: [...own.pose.position], physicsVelocity: [...own.velocity] } },
        { id: otherEntity.id, update: { position: [...other.pose.position], physicsVelocity: [...other.velocity] } },
      ],
    };
    const ownFirstPass = projectSurfaceMotion({
      state: own,
      definition: definitions.require(own.definitionId),
      policy: ownPolicy,
      policies: policyList,
      config,
      frame: firstPassFrame,
      entities,
      callbacks: { getLoadedVoxel: () => 6 },
    });
    const otherFirstPass = projectRouteMotion({
      state: other,
      definition: definitions.require(other.definitionId),
      policy: otherPolicy,
      policies: policyList,
      config,
      frame: firstPassFrame,
      entities,
      callbacks: { getLoadedVoxel: () => 6 },
    });
    expect(ownFirstPass.stopReason).toBeNull();
    expect(ownFirstPass.next.pose.position[0]).toBeCloseTo(ownEnd[0], 8);
    expect(ownFirstPass.next.pose.position[2]).toBeCloseTo(ownEnd[2], 8);
    expect(otherFirstPass.stopReason).toBeNull();
    expect(otherFirstPass.next.pose.position[0]).toBeCloseTo(otherEnd[0], 8);
    expect(otherFirstPass.next.pose.position[2]).toBeCloseTo(otherEnd[2], 8);
    expect(otherFirstPass.traveledDistance).toBeCloseTo(0.5, 8);

    const ownChordCollider = {
      id: otherEntity.id,
      aabb: {
        min: { x: 0.492929, y: 0, z: -0.007071 },
        max: { x: 0.507071, y: 0.2, z: 0.007071 },
      },
      layer: bodyConfigFor('player').collisionLayer,
      mask: bodyConfigFor('player').collisionMask,
    };
    const chordOnly = sweepBodyThroughWorld(
      { position: { x: 0.5, y: 0, z: 0.8 }, velocity: { x: 0, y: 0, z: 0 } },
      transportBodyConfig(definitions.require(own.definitionId), own.pose.yaw),
      { querySolids: () => [ownChordCollider] },
      {
        x: ownEnd[0] - own.pose.position[0] - (otherEnd[0] - other.pose.position[0]),
        y: 0,
        z: ownEnd[2] - own.pose.position[2] - (otherEnd[2] - other.pose.position[2]),
      },
    );
    expect(chordOnly.contacts).toHaveLength(0);
    expect(Math.abs(0.635 - 0.6341555656)).toBeLessThan(0.001);
    expect(Math.abs(0.34082037125 - 0.34081938)).toBeLessThan(0.001);
    const candidate = projectSurfaceMotion({
      state: own,
      definition: definitions.require(own.definitionId),
      policy: ownPolicy,
      policies: policyList,
      config,
      frame,
      entities,
      callbacks: { getLoadedVoxel: () => 6 },
      motionPaths: new Map([
        [own.reference.entityId, ownFirstPass],
        [other.reference.entityId, otherFirstPass],
      ]),
    });
    expect(candidate.stopReason).toBe('entity-collision');
    expect(candidate.next.pose).toEqual(own.pose);
    expect(candidate.next.velocity).toEqual([0, 0, 0]);
    expect(entities.transportState(own.reference)).toEqual(own);
    expect(entities.transportState(other.reference)).toEqual(other);
    expect(queries.length).toBeGreaterThan(0);
  });
});
