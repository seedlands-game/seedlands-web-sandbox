import { expect, it } from 'vitest';
import { bodyConfigFor } from '../../src/physics/body-registry';
import type { AuthorityPhysicsFrame } from '../../src/server/authority/authority-physics-frame';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { freezeTransportInteractionConfig } from '../../src/server/gameplay/modules/transport-interaction-config';
import { projectSurfaceMotion } from '../../src/server/gameplay/transport-motion-geometry';
import { surfaceDefinition } from './transport-motion-test-fixtures';

const policy = {
  definitionId: 'sample:surface-pod',
  acceleration: 0,
  drag: 0,
  maxSpeed: 8,
  steeringRate: 0,
  fuelPerMeter: 0,
};
const setup = (bodyAabb = surfaceDefinition().bodyAabb) => {
  const definition = { ...surfaceDefinition(), bodyAabb };
  const config = freezeTransportInteractionConfig({
    moduleId: 'sample:transport',
    operationId: 'sample:deploy',
    definitions: [definition],
    deployments: [],
    routes: [],
    surfaces: [{ id: 'sample:fluid-surface', voxels: [5], surfaceOffset: 1 }],
  });
  const entities = new EntityStore(
    createItemDefinitionRegistry([]),
    undefined,
    undefined,
    undefined,
    config.definitions,
  );
  entities.spawn({
    id: 'vehicle',
    type: 'transport',
    position: [0, 0, 0],
    physicsVelocity: [0, 0, 8],
    transport: { definitionId: definition.id, yaw: 0, routeCursor: null, rider: null, fuel: 10, inventory: [] },
  });
  const state = entities.transportState(entities.createReference('vehicle')!)!;
  const frame: AuthorityPhysicsFrame = {
    epoch: 'geometry',
    physicsTick: 1,
    seconds: 1,
    playerReference: null,
    playerWish: { x: 0, z: 0 },
    acknowledgedSequence: 0,
    updates: [{ id: 'vehicle', update: { position: [0, 0, 0], physicsVelocity: [0, 0, 8] } }],
    world: { querySolids: () => [] },
    bodyConfigs: new Map(),
  };
  return {
    definition,
    config,
    entities,
    state,
    frame,
    policy,
    policies: [policy],
    callbacks: { getLoadedVoxel: () => 5 as number | undefined },
  };
};

it.each([
  ['unsupported', 0, 'left-surface'],
  ['unknown', undefined, 'surface-unknown'],
] as const)(
  'stops at %s support inside the complete translation corridor even when the destination is supported',
  (_kind, voxel, reason) => {
    const options = setup();
    options.callbacks.getLoadedVoxel = (position?: readonly number[]) => (position?.[2] === 3 ? voxel : 5);
    const candidate = projectSurfaceMotion(options);
    expect(candidate.stopReason).toBe(reason);
    expect(candidate.next.pose.position).toEqual(options.state.pose.position);
    expect(candidate.traveledDistance).toBe(0);
  },
);

it('stops on relative crossing of a normal actor whose endpoint has already passed the vehicle', () => {
  const options = setup();
  options.entities.spawn({ id: 'walker', type: 'player', position: [0, 0, 6] });
  const frame = {
    ...options.frame,
    bodyConfigs: new Map([['walker', bodyConfigFor('player')]]),
    updates: [
      ...options.frame.updates,
      {
        id: 'walker',
        update: {
          position: [0, 0, -4] as [number, number, number],
          physicsVelocity: [0, 0, -10] as [number, number, number],
        },
      },
    ],
  };
  const candidate = projectSurfaceMotion({ ...options, frame });
  expect(candidate.stopReason).toBe('entity-collision');
  expect(candidate.next.pose.position).toEqual(options.state.pose.position);
});

it('includes the mounted rider body when the vehicle itself clears an overhead obstacle', () => {
  const options = setup();
  options.entities.spawn({ id: 'rider', type: 'player', position: [0.5, 0.4, 0] });
  const state = { ...options.state, rider: options.entities.createReference('rider')! };
  const frame = {
    ...options.frame,
    bodyConfigs: new Map([['rider', bodyConfigFor('player')]]),
    world: { querySolids: () => [{ id: 'overhead', aabb: { min: { x: -1, y: 1, z: 3 }, max: { x: 1, y: 2, z: 4 } } }] },
  };
  const candidate = projectSurfaceMotion({ ...options, state, frame });
  expect(candidate.stopReason).toBe('world-collision');
  expect(candidate.next.pose.position).toEqual(options.state.pose.position);
});

const smallTurnFixture = () => {
  const options = setup({ min: { x: -0.75, y: 0, z: -0.75 }, max: { x: 0.75, y: 0.6, z: 0.75 } });
  options.entities.spawn({ id: 'driver', type: 'player', position: [2.5, 0.45, 1.0143206512710505] });
  const driver = options.entities.createReference('driver')!;
  const state = {
    ...options.state,
    rider: driver,
    pose: { position: [2.5, 0, 1.0143206512710505] as const, yaw: 0.00036449777217310397 },
    velocity: [0, 0, 0.18854344123915154] as const,
  };
  const frame = {
    ...options.frame,
    seconds: 1 / 60,
    playerReference: driver,
    playerWish: { x: Math.SQRT1_2, z: Math.SQRT1_2 },
    bodyConfigs: new Map([['driver', bodyConfigFor('player')]]),
  };
  const policy = { ...options.policy, acceleration: 2, drag: 0.8, maxSpeed: 5, steeringRate: Math.PI / 2 };
  return { ...options, state, frame, policy };
};

it('小角度转向支撑不包含整圈包围圆的空角落 Stone，真实足迹和 unknown 仍拒绝', () => {
  const options = smallTurnFixture();
  const { state, frame, policy } = options;
  const candidate = (read: (position?: readonly number[]) => number | undefined) =>
    projectSurfaceMotion({
      ...options,
      state,
      frame,
      policy,
      callbacks: { ...options.callbacks, getLoadedVoxel: read },
    });
  const free = candidate((p) => (p?.[0] === 2 && p[2] === 2 ? 3 : 5));
  expect(free.stopReason).toBeNull();
  expect(free.next.pose.position[2]).toBeGreaterThan(state.pose.position[2]);
  expect(free.next.pose.yaw).toBeGreaterThan(state.pose.yaw);
  expect(candidate((p) => (p?.[0] === 2 && p[2] === 1 ? 3 : 5)).stopReason).toBe('left-surface');
  expect(candidate((p) => (p?.[0] === 2 && p[2] === 1 ? undefined : 5)).stopReason).toBe('surface-unknown');
});

it('小角度转向碰撞不使用整圈半径，真实船体和骑乘者范围仍阻挡', () => {
  const options = smallTurnFixture();
  const candidate = (z: number) =>
    projectSurfaceMotion({
      ...options,
      callbacks: { ...options.callbacks, getLoadedVoxel: () => 5 },
      frame: {
        ...options.frame,
        world: {
          querySolids: () => [{ id: 'stone', aabb: { min: { x: 2, y: 0, z }, max: { x: 3, y: 1, z: z + 1 } } }],
        },
      },
    });
  expect(candidate(2).stopReason).toBeNull();
  expect(candidate(1).stopReason).toBe('world-collision');
});
