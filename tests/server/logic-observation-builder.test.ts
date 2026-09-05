import { describe, expect, it } from 'vitest';
import { buildLogicObservation } from '../../src/server/authority/logic-observation-builder';
import type { AuthoritySnapshot } from '../../src/server/authority/authority-session';
import type { GameplayEntity } from '../../src/server/gameplay/entity-store';

const snapshot = (): AuthoritySnapshot =>
  ({
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: 'epoch:logic',
    physicsTick: 12,
    activeTimeMs: 200,
    worldTime: 8,
    entities: [
      {
        id: 'grazer-1',
        type: 'creature',
        archetype: 'grazer',
        body: { position: { x: 2.5, y: 5, z: 2.5 }, velocity: { x: 1, y: 0, z: 0 } },
        grounded: true,
        contacts: [],
      },
    ],
  }) as AuthoritySnapshot;

const grazer: GameplayEntity = {
  id: 'grazer-1',
  type: 'creature',
  kind: 'creature',
  lifecycle: 'active',
  archetype: 'grazer',
  position: [2.5, 5, 2.5],
  health: 12,
  maxHealth: 12,
};

describe('buildLogicObservation', () => {
  it('构造有界真实地形窗口、决策状态与稳定身份版本', () => {
    const observation = buildLogicObservation({
      epoch: 'epoch:logic',
      observationSequence: 3,
      snapshot: snapshot(),
      entities: [grazer],
      simulation: {
        actors: [
          {
            entityId: 'grazer-1',
            archetype: 'grazer',
            hunger: 55,
            behavior: 'seek-food',
            targetEntityId: null,
            homePoiId: null,
            workPoiId: null,
            foodPoiId: null,
            active: true,
            attackCooldownSeconds: 0,
            wanderIndex: 0,
          },
        ],
        pois: { version: 1, sequence: 0, pois: [] },
        actions: { version: 1, sequence: 0, actions: [] },
      },
      identityRevision: () => 7,
      getLoadedVoxel: (_x, y, _z) => ({ voxel: y < 5 ? 3 : 0, chunkKey: '0,0,0', revision: 4 }),
    });

    expect(observation).toMatchObject({
      epoch: 'epoch:logic',
      observationSequence: 3,
      physicsTick: 12,
      entities: [
        {
          id: 'grazer-1',
          bodyKind: 'grazer',
          identityRevision: 7,
          poseRevision: 12,
          velocity: [1, 0, 0],
          grounded: true,
        },
      ],
      decisionContext: { actors: [{ identityRevision: 7, activeAction: null }] },
    });
    const [terrain] = observation.decisionContext.terrainWindows;
    expect(terrain?.key).toBe('0,0,0');
    expect(terrain?.chunkRevision).toBe(4);
    expect(terrain!.occupancy.length).toBeLessThanOrEqual(32_768);
    expect([...terrain!.occupancy]).toContain(1);
  });

  it('任一格尚未加载时省略整个窗口，Logic据此保守hold', () => {
    const observation = buildLogicObservation({
      epoch: 'epoch:logic',
      observationSequence: 1,
      snapshot: snapshot(),
      entities: [grazer],
      simulation: {
        actors: [],
        pois: { version: 1, sequence: 0, pois: [] },
        actions: { version: 1, sequence: 0, actions: [] },
      },
      identityRevision: () => 1,
      getLoadedVoxel: () => null,
    });
    expect(observation.decisionContext.terrainWindows).toEqual([]);
  });
});
