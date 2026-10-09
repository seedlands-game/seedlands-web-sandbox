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
const setup = () => {
  const definition = surfaceDefinition();
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
