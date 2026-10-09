import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '../../src/physics/body-registry';
import { sweepBodyThroughWorld } from '../../src/physics';
import type { AuthorityPhysicsFrame } from '../../src/server/authority/authority-physics-frame';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { freezeTransportInteractionConfig } from '../../src/server/gameplay/modules/transport-interaction-config';
import { createTransportDefinitionRegistryV1 } from '../../src/server/gameplay/modules/transport-model';
import { projectRouteMotion } from '../../src/server/gameplay/transport-route-motion-geometry';
import { transportBodyConfig } from '../../src/server/gameplay/transport-body-config';
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
    bodyAabb?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  } = {},
) => {
  const definition = createTransportDefinitionRegistryV1([
    {
      version: 1,
      id: 'sample:route-pod',
      locomotion: { provider: 'route', providerId: 'sample:guideway' },
      bodyAabb: options.bodyAabb ?? { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
      seatOffset: [0.5, 0.75, 0],
      fuelCapacity: 100,
      inventoryCapacity: 2,
      presentationId: 'sample:route-pod-model',
    },
  ]).require('sample:route-pod');
  const route = guideway();
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

describe('registered route motion geometry projection', () => {
  it.each([
    ['north-south', 0, [0.5, 0, 0.5], 'south', 0, 'north', 0, 1],
    ['north-south', 1, [0.5, 0, 0.5], 'north', 0, 'south', 0, 1],
    ['straight', 0, [0.5, 0, 0.5], 'west', 0, 'east', 0, 1],
    ['straight', 1, [0.5, 0, 0.5], 'east', 0, 'west', 0, 1],
    ['corner-ne', 0, [0.7298488470659301, 0, 0.4207354924039483], 'north', 0, 'east', 0, Math.PI / 4],
    ['corner-ne', 1, [0.5792645075960517, 0, 0.2701511529340699], 'east', 0, 'north', 0, Math.PI / 4],
    ['corner-es', 0, [0.5792645075960517, 0, 0.7298488470659301], 'east', 0, 'south', 0, Math.PI / 4],
    ['corner-es', 1, [0.7298488470659301, 0, 0.5792645075960519], 'south', 0, 'east', 0, Math.PI / 4],
    ['corner-sw', 0, [0.2701511529340699, 0, 0.5792645075960517], 'south', 0, 'west', 0, Math.PI / 4],
    ['corner-sw', 1, [0.42073549240394825, 0, 0.7298488470659301], 'west', 0, 'south', 0, Math.PI / 4],
    ['corner-wn', 0, [0.42073549240394825, 0, 0.2701511529340698], 'west', 0, 'north', 0, Math.PI / 4],
    ['corner-wn', 1, [0.2701511529340699, 0, 0.42073549240394825], 'north', 0, 'west', 0, Math.PI / 4],
    ['slope-north', 0, [0.5, 0.35355339059327373, 0.6464466094067263], 'south', 0, 'north', 1, Math.SQRT2],
    ['slope-north', 1, [0.5, 0.6464466094067263, 0.35355339059327373], 'north', 1, 'south', 0, Math.SQRT2],
    ['slope-east', 0, [0.35355339059327373, 0.35355339059327373, 0.5], 'west', 0, 'east', 1, Math.SQRT2],
    ['slope-east', 1, [0.6464466094067263, 0.6464466094067263, 0.5], 'east', 1, 'west', 0, Math.SQRT2],
    ['slope-south', 0, [0.5, 0.35355339059327373, 0.35355339059327373], 'north', 0, 'south', 1, Math.SQRT2],
    ['slope-south', 1, [0.5, 0.6464466094067263, 0.6464466094067263], 'south', 1, 'north', 0, Math.SQRT2],
    ['slope-west', 0, [0.6464466094067263, 0.35355339059327373, 0.5], 'east', 0, 'west', 1, Math.SQRT2],
    ['slope-west', 1, [0.35355339059327373, 0.6464466094067263, 0.5], 'west', 1, 'east', 0, Math.SQRT2],
  ] as const)(
    'projects the literal pose and cursor for %s direction %i',
    (variant, direction, expectedPosition, entrySide, entryElevation, exitSide, exitElevation, segmentLength) => {
      const options = setup(segmentFor(`sample:${variant}`, direction));
      const candidate = projectRouteMotion({ ...options, policy, policies: [policy] });

      expect(candidate.stopReason).toBeNull();
      expect(candidate.next.pose.position).toEqual(expectedPosition);
      expect(candidate.next.routeCursor).toMatchObject({
        cell: [0, 0, 0],
        variant: `sample:${variant}`,
        entry: { side: entrySide, elevation: entryElevation },
        exit: { side: exitSide, elevation: exitElevation },
        progress: 0.5,
        segmentLength,
      });
      expect(candidate.traveledDistance).toBeCloseTo(0.5);
      expect(candidate.fuelCost).toBe(0);
      expect(candidate.expected.reference).toEqual(options.state.reference);
      expect(candidate.expected.fuel).toBe(7);
      expect(options.entities.transportState(options.state.reference)).toEqual(options.state);
      expect(options.reads).toContainEqual([0, 0, 0]);
      expect(options.queries.length).toBeGreaterThan(0);
      expect(
        options.queries.every(({ min, max }) => [min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)),
      ).toBe(true);
    },
  );

  it.each([
    [undefined, 'route-unknown'],
    [5, 'route-disconnected'],
  ] as const)('fails closed when the current loaded route cell is %s', (voxel, reason) => {
    const options = setup(segmentFor('sample:straight'), { voxel });
    const candidate = projectRouteMotion({ ...options, policy, policies: [policy] });
    expect(candidate.stopReason).toBe(reason);
    expect(candidate.next.pose).toEqual(options.state.pose);
    expect(candidate.next.velocity).toEqual([0, 0, 0]);
    expect(candidate.next.routeCursor).toEqual(options.state.routeCursor);
    expect(candidate.traveledDistance).toBe(0);
    expect(options.queries.length).toBeGreaterThan(0);
  });

  it.each([
    ['unknown', undefined, 'route-unknown'],
    ['disconnected', 0, 'route-disconnected'],
    ['multiple heights', 'multiple', 'route-ambiguous'],
  ] as const)('stops at a %s route frontier after reaching the current endpoint', (_name, nextValue, reason) => {
    const segment = segmentFor('sample:straight');
    const options = setup(segment, { progress: segment.length - 0.1 });
    options.frame = { ...options.frame, seconds: 0.1 };
    options.callbacks.getLoadedVoxel = (position) => {
      if (position[0] === 0 && position[1] === 0 && position[2] === 0) return 6;
      if (nextValue === undefined) return undefined;
      if (nextValue === 0) return 0;
      if (position[0] === 1 && position[2] === 0 && (position[1] === 0 || position[1] === -1)) return 6;
      return 0;
    };
    const candidate = projectRouteMotion({ ...options, policy, policies: [policy] });
    expect(candidate.stopReason).toBe(reason);
    expect(candidate.traveledDistance).toBeCloseTo(0.1);
    expect(candidate.next.pose.position).toEqual([1, 0, 0.5]);
    expect(candidate.next.routeCursor).toMatchObject({ cell: [0, 0, 0], progress: 1 });
    expect(options.queries.length).toBeGreaterThan(2);
    if (nextValue === 'multiple') {
      expect(options.queries).toContainEqual({ min: { x: 1, y: -1, z: 0 }, max: { x: 2, y: 0, z: 1 } });
      expect(options.queries).toContainEqual({ min: { x: 1, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } });
    }
  });

  it('does not accelerate on a wish perpendicular to the directed route and preserves rider/cargo identity', () => {
    const options = setup(segmentFor('sample:straight'), { rider: true });
    options.frame = { ...options.frame, playerWish: { x: 0, z: 1 } };
    const acceleratedPolicy = { ...policy, acceleration: 4 };
    expect(options.state.rider).not.toBeNull();
    expect(options.frame.playerReference).toEqual(options.state.rider);
    expect(options.entities.resolveReference(options.frame.playerReference!)).toBeTruthy();
    const candidate = projectRouteMotion({ ...options, policy: acceleratedPolicy, policies: [acceleratedPolicy] });

    expect(candidate.stopReason).toBeNull();
    expect(candidate.next.routeCursor?.progress).toBe(0.5);
    expect(candidate.next.pose.position).toEqual([0.5, 0, 0.5]);
    expect(candidate.next.velocity).toEqual([2, 0, 0]);
    expect(candidate.expected.reference).toEqual(options.state.reference);
    expect(options.state.rider).toEqual(options.frame.playerReference);
    expect(options.state.inventory).toEqual([{ itemId: 'sample:cargo', count: 2 }, null]);
    expect(options.state.fuel).toBe(7);
    expect(options.entities.transportState(options.state.reference)).toEqual(options.state);
  });

  it('stops on a quarter-arc outer-envelope blocker that a carrier-only chord sweep misses', () => {
    const arcAabb = { min: { x: -0.02, y: 0, z: -0.02 }, max: { x: 0.02, y: 0.2, z: 0.02 } };
    const options = setup(segmentFor('sample:corner-ne'), { bodyAabb: arcAabb });
    const blocker = {
      id: 'outer-arc-blocker',
      aabb: { min: { x: 0.55, y: 0.05, z: 0.23 }, max: { x: 0.57, y: 0.1, z: 0.25 } },
      layer: bodyConfigFor('player').collisionLayer,
      mask: bodyConfigFor('player').collisionMask,
    };
    const chordDelta = { x: 0.7298488470659301 - 0.5, y: 0, z: 0.4207354924039483 };
    const chordOnly = sweepBodyThroughWorld(
      { position: { x: 0.5, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      transportBodyConfig(options.definition, options.state.pose.yaw),
      { querySolids: () => [blocker] },
      chordDelta,
    );
    options.frame = {
      ...options.frame,
      world: {
        querySolids(bounds) {
          options.queries.push(bounds);
          return [blocker];
        },
      },
    };
    const candidate = projectRouteMotion({ ...options, policy, policies: [policy] });
    expect(chordOnly.contacts).toHaveLength(0);
    expect(candidate.stopReason).toBe('world-collision');
    expect(candidate.next.pose).toEqual(options.state.pose);
    expect(candidate.next.velocity).toEqual([0, 0, 0]);
    expect(candidate.next.routeCursor).toEqual(options.state.routeCursor);
    expect(options.queries.some(({ min, max }) => min.x < 0.5 && max.x > 0.7 && min.z < 0 && max.z > 0.4)).toBe(true);
  });

  it('keeps a mounted rider inside the route collision envelope', () => {
    const options = setup(segmentFor('sample:corner-ne'), { rider: true });
    const blocker = {
      id: 'rider-only-overhang',
      aabb: { min: { x: 0.94, y: 1.1, z: -0.36 }, max: { x: 0.97, y: 1.2, z: -0.33 } },
      layer: bodyConfigFor('player').collisionLayer,
      mask: bodyConfigFor('player').collisionMask,
    };
    const carrierOnly = sweepBodyThroughWorld(
      { position: { x: 0.5, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      transportBodyConfig(options.definition, options.state.pose.yaw),
      { querySolids: () => [blocker] },
      { x: 0.1, y: 0, z: 0.1 },
    );
    options.frame = {
      ...options.frame,
      world: { querySolids: (bounds) => (options.queries.push(bounds), [blocker]) },
    };
    const candidate = projectRouteMotion({ ...options, policy, policies: [policy] });
    expect(carrierOnly.contacts).toHaveLength(0);
    expect(candidate.stopReason).toBe('world-collision');
    expect(candidate.next.pose).toEqual(options.state.pose);
    expect(candidate.next.routeCursor).toEqual(options.state.routeCursor);
    expect(options.state.rider).toEqual(options.frame.playerReference);
    expect(options.entities.transportState(options.state.reference)).toEqual(options.state);
  });

  it('detects synchronized collision with another carrier following a quarter arc missed by relative chord sweep', () => {
    const route = guideway();
    const ownDefinition = {
      version: 1 as const,
      id: 'sample:route-pod',
      locomotion: { provider: 'route' as const, providerId: 'sample:guideway' },
      bodyAabb: { min: { x: -0.14, y: 0, z: -0.005 }, max: { x: -0.13, y: 0.2, z: 0.005 } },
      seatOffset: [0, 0, 0] as const,
      fuelCapacity: 100,
      inventoryCapacity: 2,
      presentationId: 'sample:route-pod-model',
    };
    const otherDefinition = {
      ...ownDefinition,
      id: 'sample:arc-pod',
      bodyAabb: { min: { x: -0.005, y: 0, z: -0.005 }, max: { x: 0.005, y: 0.2, z: 0.005 } },
      presentationId: 'sample:arc-pod-model',
    };
    const definitions = createTransportDefinitionRegistryV1([ownDefinition, otherDefinition]);
    const config = freezeTransportInteractionConfig({
      moduleId: 'sample:route-motion',
      operationId: 'sample:advance-route',
      definitions: [ownDefinition, otherDefinition],
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
    const ownSource = routeState(segmentFor('sample:north-south'), 0.2, {
      pose: { position: [0.5, 0, 0.8], yaw: Math.PI },
      velocity: [0, 0, -2],
      inventory: [{ itemId: 'sample:cargo', count: 2 }, null],
      fuel: 7,
    });
    const frameSeconds = 0.3061197525;
    const otherSpeed = 0.5 / frameSeconds;
    const otherSource = routeState(segmentFor('sample:corner-ne'), 0, {
      definitionId: 'sample:arc-pod',
      pose: { position: [0.5, 0, 0], yaw: 0 },
      velocity: [0, 0, otherSpeed],
      inventory: [{ itemId: 'sample:cargo', count: 1 }, null],
      fuel: 5,
    });
    const spawn = (id: string, source: typeof ownSource) =>
      entities.spawn({
        id,
        type: 'transport',
        position: source.pose.position,
        physicsVelocity: source.velocity,
        transport: {
          definitionId: source.definitionId,
          yaw: source.pose.yaw,
          routeCursor: source.routeCursor,
          rider: null,
          fuel: source.fuel,
          inventory: source.inventory,
        },
      });
    const ownEntity = spawn('transport-own', ownSource);
    const otherEntity = spawn('transport-arc', otherSource);
    const own = entities.transportState(entities.createReference(ownEntity.id)!)!;
    const other = entities.transportState(entities.createReference(otherEntity.id)!)!;
    const ownEnd: readonly [number, number, number] = [0.5, 0, 0.187760495];
    const otherEnd: readonly [number, number, number] = [0.7298488470659301, 0, 0.4207354924039483];
    const ownDelta = [ownEnd[0] - own.pose.position[0], 0, ownEnd[2] - own.pose.position[2]] as const;
    const otherDelta = [otherEnd[0] - other.pose.position[0], 0, otherEnd[2] - other.pose.position[2]] as const;
    const relativeDelta = {
      x: ownDelta[0] - otherDelta[0],
      y: 0,
      z: ownDelta[2] - otherDelta[2],
    };
    const otherChordCollider = {
      id: otherEntity.id,
      aabb: {
        min: { x: 0.492929, y: 0, z: -0.007071 },
        max: { x: 0.507071, y: 0.2, z: 0.007071 },
      },
      layer: bodyConfigFor('player').collisionLayer,
      mask: bodyConfigFor('player').collisionMask,
    };
    const chordOnly = sweepBodyThroughWorld(
      {
        position: { x: own.pose.position[0], y: own.pose.position[1], z: own.pose.position[2] },
        velocity: { x: 0, y: 0, z: 0 },
      },
      transportBodyConfig(definitions.require(own.definitionId), own.pose.yaw),
      { querySolids: () => [otherChordCollider] },
      relativeDelta,
    );
    const otherArcAtThreeQuarters = { x: 0.6341555656, y: 0, z: 0.34081938 };
    expect(Math.abs(0.635 - otherArcAtThreeQuarters.x)).toBeLessThan(0.001);
    expect(Math.abs(0.34082037125 - otherArcAtThreeQuarters.z)).toBeLessThan(0.001);
    const ownStartBox = { minX: 0.63, maxX: 0.64, minZ: 0.795, maxZ: 0.805 };
    const otherStartBox = { minX: 0.492929, maxX: 0.507071, minZ: -0.007071, maxZ: 0.007071 };
    const ownEndBox = { minX: 0.63, maxX: 0.64, minZ: 0.182760495, maxZ: 0.192760495 };
    const otherEndBox = { minX: 0.722777776, maxX: 0.736919918, minZ: 0.413664421, maxZ: 0.427806563 };
    const intersects = (left: typeof ownStartBox, right: typeof ownStartBox) =>
      left.minX < right.maxX && right.minX < left.maxX && left.minZ < right.maxZ && right.minZ < left.maxZ;
    expect(intersects(ownStartBox, otherStartBox)).toBe(false);
    expect(intersects(ownEndBox, otherEndBox)).toBe(false);
    const ownArcTimeBox = { minX: 0.63, maxX: 0.64, minZ: 0.33582037125, maxZ: 0.34582037125 };
    const otherArcTimeBox = { minX: 0.6270843656, maxX: 0.6412267656, minZ: 0.33374818, maxZ: 0.34789058 };
    expect(intersects(ownArcTimeBox, otherArcTimeBox)).toBe(true);
    expect(chordOnly.contacts).toHaveLength(0);

    const queries: Array<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }> = [];
    const frame: AuthorityPhysicsFrame = {
      epoch: 'route-geometry',
      physicsTick: 9,
      seconds: frameSeconds,
      playerReference: null,
      playerWish: { x: 0, z: 0 },
      acknowledgedSequence: 0,
      updates: [
        { id: ownEntity.id, update: { position: [...ownEnd], physicsVelocity: [...own.velocity] } },
        {
          id: otherEntity.id,
          update: {
            position: [...otherEnd],
            physicsVelocity: [otherSpeed * 0.8414709848, 0, otherSpeed * 0.5403023059],
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
    const ownFirstPass = projectRouteMotion({
      state: own,
      definition: definitions.require(own.definitionId),
      policy,
      policies: [policy],
      config,
      frame: firstPassFrame,
      entities,
      callbacks: { getLoadedVoxel: () => 6 },
    });
    const otherPolicy = { ...policy, definitionId: other.definitionId };
    const otherFirstPass = projectRouteMotion({
      state: other,
      definition: definitions.require(other.definitionId),
      policy: otherPolicy,
      policies: [otherPolicy],
      config,
      frame: firstPassFrame,
      entities,
      callbacks: { getLoadedVoxel: () => 6 },
    });
    expect(ownFirstPass.stopReason).toBeNull();
    expect(ownFirstPass.next.pose.position[0]).toBeCloseTo(ownEnd[0], 8);
    expect(ownFirstPass.next.pose.position[1]).toBeCloseTo(ownEnd[1], 8);
    expect(ownFirstPass.next.pose.position[2]).toBeCloseTo(ownEnd[2], 8);
    expect(otherFirstPass.stopReason).toBeNull();
    expect(otherFirstPass.next.pose.position[0]).toBeCloseTo(otherEnd[0], 8);
    expect(otherFirstPass.next.pose.position[1]).toBeCloseTo(otherEnd[1], 8);
    expect(otherFirstPass.next.pose.position[2]).toBeCloseTo(otherEnd[2], 8);
    expect(otherFirstPass.traveledDistance).toBeCloseTo(0.5, 8);
    const candidate = projectRouteMotion({
      state: own,
      definition: definitions.require(own.definitionId),
      policy,
      policies: [policy],
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
    expect(candidate.next.routeCursor).toEqual(own.routeCursor);
    expect(candidate.next.velocity).toEqual([0, 0, 0]);
    expect(candidate.expected.reference).toEqual(own.reference);
    expect(entities.transportState(own.reference)).toEqual(own);
    expect(entities.transportState(other.reference)).toEqual(other);
    expect(queries.length).toBeGreaterThan(0);
  });
});
