// 从仓库根目录运行：
// node changes/2026-09-06-data-plane-simd-policy/experiments/aos-soa-size-probe.mjs
// 本探针不启动浏览器；v8.serialize 结果仅是 Node V8 对象图尺寸代理。
import { createServer } from 'vite';
import { serialize } from 'node:v8';
const root = process.cwd();
const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});
try {
  const { buildLogicObservation } = await server.ssrLoadModule('/src/server/authority/logic-observation-builder.ts');
  const mk = (actorsN, extrasN, poisN, spread) => {
    const entities = [];
    const actors = [];
    const bodies = [];
    const add = (entity) => {
      entities.push(entity);
      bodies.push({
        id: entity.id,
        type: entity.type,
        ...(entity.archetype ? { archetype: entity.archetype } : {}),
        body: {
          position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
          velocity: { x: 0, y: 0, z: 0 },
        },
        grounded: true,
        contacts: [],
      });
    };
    add({ id: 'player-1', type: 'player', kind: 'player', lifecycle: 'active', position: [15.5, 6, 15.5] });
    for (let i = 0; i < actorsN; i++) {
      const x = spread ? (i % 8) * 40 + 12.5 : 2.5 + (i % 8) * 3.5;
      const z = spread ? (Math.floor(i / 8) % 8) * 40 + 12.5 : 2.5 + (Math.floor(i / 8) % 8) * 3.5;
      const archetype = ['grazer', 'night-stalker', 'settler'][i % 3];
      const type = archetype === 'settler' ? 'npc' : 'creature';
      add({
        id: `actor-${i}`,
        type,
        kind: type,
        lifecycle: 'active',
        position: [x, 6, z],
        physicsVelocity: [0, 0, 0],
        health: 12,
        maxHealth: 12,
        archetype,
        persistent: true,
      });
      actors.push({
        entityId: `actor-${i}`,
        archetype,
        hunger: i % 101,
        behavior: 'wander',
        targetEntityId: null,
        homePoiId: poisN ? `poi-${i % poisN}` : null,
        workPoiId: null,
        foodPoiId: null,
        active: true,
        attackCooldownSeconds: 0,
        wanderIndex: i,
      });
    }
    for (let i = 0; i < extrasN; i++)
      add({
        id: `item-${i}`,
        type: 'world-item',
        kind: 'world-item',
        lifecycle: 'active',
        position: [10.5 + (i % 10), 6, 10.5 + (Math.floor(i / 10) % 10)],
        physicsVelocity: [0, 0, 0],
        stack: { itemId: 'berry', count: 1 },
      });
    const pois = Array.from({ length: poisN }, (_, i) => ({
      id: `poi-${i}`,
      kind: ['home', 'work', 'food', 'camp'][i % 4],
      position: [i, 6, i],
      label: `POI ${i}`,
    }));
    const snapshot = {
      kind: 'snapshot',
      protocolVersion: 1,
      epoch: 'epoch:probe',
      physicsTick: 120,
      commitSequence: 120,
      worldMutationCount: 0,
      acknowledgedInputSequence: 0,
      inputResyncRequired: false,
      integratedPhysicsTimeMs: 2000,
      physicsDebtMs: 0,
      chunkRevisions: {},
      worldRevision: 1,
      paused: false,
      player: bodies[0],
      activeTimeMs: 2000,
      worldTime: 8,
      entities: bodies,
    };
    const observation = buildLogicObservation({
      epoch: 'epoch:probe',
      observationSequence: 1,
      snapshot,
      entities,
      simulation: {
        actors,
        pois: { version: 1, sequence: poisN, pois },
        actions: { version: 1, sequence: 0, actions: [] },
      },
      identityRevision: () => 1,
      getLoadedVoxel: (x, y, z) => ({
        voxel: y < 5 ? 3 : 0,
        chunkKey: `${Math.floor(x / 32)},${Math.floor(y / 32)},${Math.floor(z / 32)}`,
        revision: 1,
      }),
    });
    const typedBytes = observation.decisionContext.terrainWindows.reduce((n, w) => n + w.occupancy.byteLength, 0);
    const noTerrain = structuredClone(observation);
    noTerrain.decisionContext.terrainWindows = [];
    const entityCloneProxy = entities.reduce((n, e) => n + serialize(e).byteLength, 0);
    return {
      actorsN,
      extrasN,
      poisN,
      spread,
      entities: entities.length,
      terrainWindows: observation.decisionContext.terrainWindows.length,
      typedBytes,
      v8SerializedObservation: serialize(observation).byteLength,
      v8SerializedWithoutTerrain: serialize(noTerrain).byteLength,
      v8SerializedIntentsProxy: serialize({
        protocolVersion: 1,
        epoch: 'epoch:probe',
        observationSequence: 1,
        expiresAtPhysicsTick: 132,
        intents: actors.map((a) => ({
          entityId: a.entityId,
          identityRevision: 1,
          observedPoseRevision: 120,
          readChunkRevisions: [{ key: '0,0,0', revision: 1 }],
          wish: { x: 1, z: 0 },
          jumpRequested: false,
          verticalIntent: 0,
          action: { type: 'move-to', target: [1, 6, 1] },
        })),
      }).byteLength,
      entityCloneProxy,
    };
  };
  console.log(
    JSON.stringify(
      [mk(3, 1, 5, false), mk(16, 16, 8, false), mk(64, 64, 16, false), mk(64, 64, 16, true), mk(512, 0, 64, false)],
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
