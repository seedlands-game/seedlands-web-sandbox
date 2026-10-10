import { createCharacterNavigationConstraint } from '../../src/server/simulation/character-navigation';
import type { PerceptionSnapshot } from '../../src/server/simulation/perception-runtime';
import { describe, expect, it } from 'vitest';
import { bodyWorldAabb } from '../../src/physics';
import { bodyConfigFor } from '../../src/physics/body-registry';
import { overlapDepth } from '../../src/physics/geometry';
import { authorityBodyConfig } from '../../src/server/authority/authority-body-config';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { defaultGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { freezeTransportInteractionConfig } from '../../src/server/gameplay/modules/transport-interaction-config';
import { loadedTransportBodyRejection } from '../../src/server/gameplay/transport-deployment-geometry';
import { projectTransportRelationSite } from '../../src/server/gameplay/transport-relation-geometry';
import { transportBodyConfig } from '../../src/server/gameplay/transport-body-config';
import { createVoxelSemanticsRegistry } from '../../src/world/voxel-semantics';
import { testCorePlatform } from '../support/core-platform';

const config = freezeTransportInteractionConfig({
  moduleId: 'sample:yaw-transports',
  operationId: 'sample:deploy-long-carrier',
  definitions: [
    {
      version: 1,
      id: 'sample:long-carrier',
      locomotion: { provider: 'surface', providerId: 'sample:surface' },
      bodyAabb: { min: { x: -1.5, y: 0, z: -0.25 }, max: { x: 1.5, y: 0.8, z: 0.25 } },
      seatOffset: [0, 0.55, 0],
      presentationId: 'sample:carrier-model',
    },
  ],
  deployments: [{ itemId: 'sample:kit', definitionId: 'sample:long-carrier' }],
  routes: [],
  surfaces: [{ id: 'sample:surface', voxels: [3], surfaceOffset: 1 }],
});
const definition = config.definitions.require('sample:long-carrier');
const content = {
  ...defaultGameplayContent,
  transportDefinitions: config.definitions,
  voxelSemantics: createVoxelSemanticsRegistry(
    [0, 3].map((storageId) => ({
      id: `sample:voxel-${storageId}`,
      storageId,
      solid: storageId !== 0,
      targetable: storageId !== 0,
      renderable: storageId !== 0,
      meshKind: 'cube' as const,
      emission: 0,
      lightCost: 1,
      faceMaterials: [4, 4, 4, 4, 4, 4] as const,
    })),
  ),
};
function create() {
  // Owner-level geometry fixture; actual deployment and walking are covered separately by Authority.
  const entities = new EntityStore(undefined, undefined, undefined, undefined, config.definitions);
  entities.spawn({
    id: 'carrier',
    type: 'transport',
    position: [0.5, 60, 0.5],
    transport: {
      definitionId: definition.id,
      yaw: Math.PI / 2,
      routeCursor: null,
      rider: null,
      fuel: null,
      inventory: [],
    },
  });
  const getVoxel = ([, y]: readonly [number, number, number]) => (y < 60 ? 3 : 0);
  return {
    entities,
    config,
    content,
    callbacks: {
      platform: testCorePlatform,
      getVoxel,
      getLoadedVoxel: getVoxel,
      getWorldTime: () => 8,
      prepareVoxelEdit: () => {
        throw new Error('Geometry projection must not edit voxels');
      },
    },
  };
}

describe('canonical transport yaw geometry', () => {
  it('uses the current configured yaw footprint as a visible navigation obstacle and rejects unresolved bodies', () => {
    const { entities } = create();
    entities.spawn({ id: 'mover', type: 'npc', archetype: 'settler', position: [2.5, 60, 0.5] });
    const server = {
      createEntityReference: (id: string) => entities.createReference(id),
      transportState: entities.transportState.bind(entities),
      gameplayContent: content,
    };
    const perceived: PerceptionSnapshot = {
      observerId: 'mover',
      visibleEntities: [{ entityId: 'carrier', type: 'transport', distance: 2 }],
      threats: [],
      food: [],
      pois: [],
      observations: [],
      candidateCount: 1,
      lineOfSightChecks: 1,
    };
    const options = {
      actorId: 'mover',
      target: [4.5, 60, 0.5] as [number, number, number],
      perception: perceived,
      resolveEntity: (id: string) => entities.get(id) ?? null,
    };
    const constraint = createCharacterNavigationConstraint({
      ...options,
      bodyConfig: (entity) => authorityBodyConfig(server, entity),
    });
    expect(constraint.blocksNode([0.5, 60, 1.5])).toBe(true);
    expect(constraint.blocksNode([1.5, 60, 0.5])).toBe(false);
    expect(() => createCharacterNavigationConstraint(options)).toThrow('no registered body');
  });
  it('resolves the current world-local body and keeps the zero-yaw definition unchanged', () => {
    const { entities } = create();
    const server = {
      createEntityReference: (id: string) => entities.createReference(id),
      transportState: entities.transportState.bind(entities),
      gameplayContent: content,
    };
    const box = authorityBodyConfig(server, { id: 'carrier', type: 'transport' }).localAabb;
    expect(box.min.x).toBeCloseTo(-0.25);
    expect(box.max.x).toBeCloseTo(0.25);
    expect(box.min.z).toBeCloseTo(-1.5);
    expect(box.max.z).toBeCloseTo(1.5);
    expect(transportBodyConfig(definition, 0).localAabb).toBe(definition.bodyAabb);
  });

  it('rejects placement in the rotated carrier footprint using its actual ECS component', () => {
    const options = create();
    expect(loadedTransportBodyRejection(options, bodyConfigFor('player').localAabb, [0.5, 60, 1.5])).toBe(
      'target-occupied',
    );
    expect(loadedTransportBodyRejection(options, bodyConfigFor('player').localAabb, [2.5, 60, 0.5])).toBeNull();
  });

  it('offers dismount positions outside the same rotated volume used by physics', () => {
    const options = create();
    const site = projectTransportRelationSite(options, 'carrier');
    const carrier = bodyWorldAabb(
      { position: { x: 0.5, y: 60, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 } },
      transportBodyConfig(definition, Math.PI / 2),
    );
    expect(site.exits).toHaveLength(4);
    for (const exit of site.exits) {
      expect(exit.status).toBe('safe');
      const [x, y, z] = exit.position;
      const actor = bodyWorldAabb({ position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 } }, bodyConfigFor('player'));
      expect(overlapDepth(carrier, actor)).toBeNull();
    }
  });
});
