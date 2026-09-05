import { describe, expect, it } from 'vitest';
import { decideLogicIntents as decideWithConfig } from '../../../src/server/logic/logic-decision';
import type {
  ActorActionSnapshot,
  LogicEntity,
  LogicObservation,
  TerrainWindow,
} from '../../../src/server/logic/logic-protocol';
import type { ActorState } from '../../../src/server/simulation/actor-state';

const decideLogicIntents = (input: LogicObservation, physicsHz: 30 | 60 | 120 = 60) =>
  decideWithConfig(input, { physicsHz });

const actor = (overrides: Partial<ActorState> = {}): ActorState => ({
  entityId: 'grazer',
  archetype: 'grazer',
  hunger: 0,
  behavior: 'idle',
  targetEntityId: null,
  homePoiId: null,
  workPoiId: null,
  foodPoiId: null,
  active: true,
  attackCooldownSeconds: 0,
  wanderIndex: 0,
  ...overrides,
});

const entity = (overrides: Partial<LogicEntity> = {}): LogicEntity => ({
  id: 'grazer',
  bodyKind: 'grazer',
  identityRevision: 1,
  poseRevision: 5,
  position: [2.5, 1, 2.5],
  velocity: [0, 0, 0],
  grounded: true,
  health: 12,
  ...overrides,
});

const terrain = (
  key = '0,0,0',
  revision = 7,
  origin: [number, number, number] = [0, 0, 0],
  size: [number, number, number] = [16, 8, 16],
): TerrainWindow => {
  const occupancy = new Uint8Array(size[0] * size[1] * size[2]);
  for (let z = 0; z < size[2]; z += 1) for (let x = 0; x < size[0]; x += 1) occupancy[x + size[0] * z] = 1;
  return { key, chunkRevision: revision, origin, size, occupancy };
};

const observation = (
  actors: readonly { state: ActorState; identityRevision: number; activeAction?: ActorActionSnapshot }[],
  entities: LogicEntity[],
  windows: TerrainWindow[] = [terrain()],
  worldTime = 12,
): LogicObservation => ({
  protocolVersion: 1,
  epoch: 'world-1',
  observationSequence: 3,
  physicsTick: 120,
  activeTimeMs: 2_000,
  worldTime,
  entities,
  decisionContext: {
    actors: actors.map((entry) => ({ ...entry, activeAction: entry.activeAction ?? null })),
    pois: { version: 1, sequence: 0, pois: [] },
    terrainWindows: windows,
  },
});

describe('Game Logic Worker 的纯意图计算', () => {
  it('按物理频率换算相同的 200ms 意图有效期', () => {
    const input = observation([], []);
    expect(decideLogicIntents(input, 30).expiresAtPhysicsTick).toBe(126);
    expect(decideLogicIntents(input, 60).expiresAtPhysicsTick).toBe(132);
    expect(decideLogicIntents(input, 120).expiresAtPhysicsTick).toBe(144);
  });

  it('保留觅食语义，并只请求 Authority 消耗近处世界物品', () => {
    const hungry = actor({ hunger: 80 });
    const grazer = entity();
    const berry = entity({
      id: 'berry-drop',
      bodyKind: 'world-item',
      identityRevision: 4,
      poseRevision: 8,
      position: [3.1, 1, 2.5],
      stack: { itemId: 'berry', count: 1, edible: true, hungerRestore: 25 },
    });

    const batch = decideLogicIntents(observation([{ state: hungry, identityRevision: 1 }], [grazer, berry]));

    expect(batch).toMatchObject({ protocolVersion: 1, epoch: 'world-1', observationSequence: 3 });
    expect(batch.expiresAtPhysicsTick).toBeGreaterThan(120);
    expect(batch.intents).toEqual([
      expect.objectContaining({
        entityId: 'grazer',
        identityRevision: 1,
        observedPoseRevision: 5,
        wish: { x: 0, z: 0 },
        action: { type: 'consume-world-item', targetId: 'berry-drop' },
      }),
    ]);
    expect(batch.intents[0]).not.toHaveProperty('position');
    expect(batch.intents[0]).not.toHaveProperty('velocity');
  });

  it('保留敌对生物昼夜规则、攻击距离与居民日程', () => {
    const player = entity({ id: 'player', bodyKind: 'player', position: [4, 1, 2.5] });
    const stalker = entity({ id: 'stalker', bodyKind: 'night-stalker', position: [2.5, 1, 2.5] });
    const hostileActor = actor({ entityId: 'stalker', archetype: 'night-stalker' });
    const night = decideLogicIntents(
      observation([{ state: hostileActor, identityRevision: 1 }], [stalker, player], undefined, 22),
    );
    expect(night.intents[0]).toMatchObject({ action: { type: 'attack', targetId: 'player' } });

    const homeActor = actor({
      entityId: 'settler',
      archetype: 'settler',
      homePoiId: 'home',
      workPoiId: 'work',
    });
    const settler = entity({
      id: 'settler',
      bodyKind: 'settler',
      identityRevision: 9,
      position: [2.5, 1, 2.5],
    });
    const workObservation = observation([{ state: homeActor, identityRevision: 9 }], [settler], undefined, 9);
    workObservation.decisionContext.pois.pois.push({
      id: 'work',
      kind: 'work',
      position: [6.5, 1, 2.5],
      label: '工作点',
    });
    workObservation.decisionContext.pois.pois.push({
      id: 'home',
      kind: 'home',
      position: [1.5, 1, 2.5],
      label: '住所',
    });
    const day = decideLogicIntents(workObservation);
    expect(day.intents[0]).toMatchObject({
      entityId: 'settler',
      identityRevision: 9,
      wish: { x: 1, z: 0 },
      action: { type: 'move-to', target: [6.5, 1, 2.5] },
    });
  });

  it('延续匹配的既有高层 Action，而不在 Worker 内创建第二份 canonical 状态', () => {
    const state = actor({ homePoiId: 'home' });
    const activeAction: ActorActionSnapshot = {
      id: 'action-41',
      actorId: 'grazer',
      type: 'wander',
      status: 'running',
      targetPosition: [5.5, 1, 2.5],
      startedAt: 1,
      path: [
        [2.5, 1, 2.5],
        [5.5, 1, 2.5],
      ],
      pathIndex: 1,
      repathCount: 0,
    };
    const input = observation([{ state, identityRevision: 1, activeAction }], [entity()]);

    const batch = decideLogicIntents(input);

    expect(batch.intents[0]?.action).toEqual({ type: 'start-existing-action', actionId: 'action-41' });
    expect(input.decisionContext.actors[0].activeAction?.status).toBe('running');
  });

  it('地形窗口缺失时保持，且读集只包含实际查询过的窗口版本', () => {
    const farTarget = entity({ id: 'player', bodyKind: 'player', position: [10.5, 1, 2.5] });
    const stalker = entity({ id: 'stalker', bodyKind: 'night-stalker', identityRevision: 2 });
    const batch = decideLogicIntents(
      observation(
        [{ state: actor({ entityId: 'stalker', archetype: 'night-stalker' }), identityRevision: 2 }],
        [stalker, farTarget],
        [terrain('near', 17, [0, 0, 0], [8, 8, 8])],
        23,
      ),
    );
    expect(batch.intents[0]).toMatchObject({
      wish: { x: 0, z: 0 },
      jumpRequested: false,
      verticalIntent: 0,
      readChunkRevisions: [{ key: 'near', revision: 17 }],
    });
  });

  it('用注册表身体宽高做有界导航，并为一格台阶产生跳跃请求', () => {
    const window = terrain();
    const index = (x: number, y: number, z: number) => x + window.size[0] * (z + window.size[2] * y);
    window.occupancy[index(3, 1, 2)] = 1;
    const target = entity({ id: 'player', bodyKind: 'player', position: [4.5, 2, 2.5] });
    const stalker = entity({
      id: 'stalker',
      bodyKind: 'night-stalker',
      identityRevision: 2,
      position: [1.5, 1, 2.5],
    });
    const batch = decideLogicIntents(
      observation(
        [{ state: actor({ entityId: 'stalker', archetype: 'night-stalker' }), identityRevision: 2 }],
        [stalker, target],
        [window],
        23,
      ),
    );
    expect(batch.intents[0]).toMatchObject({ wish: { x: 1, z: 0 }, jumpRequested: true });
  });

  it('拒绝超出传输上限、重叠或长度不符的地形窗口', () => {
    expect(() =>
      decideLogicIntents(
        observation(
          [{ state: actor(), identityRevision: 1 }],
          [entity()],
          [terrain('oversized', 1, [0, 0, 0], [33, 1, 1])],
        ),
      ),
    ).toThrow(/terrain window/i);

    const malformed = { ...terrain(), occupancy: new Uint8Array(1) };
    expect(() =>
      decideLogicIntents(observation([{ state: actor(), identityRevision: 1 }], [entity()], [malformed])),
    ).toThrow(/occupancy/i);

    expect(() =>
      decideLogicIntents(
        observation([{ state: actor(), identityRevision: 1 }], [entity()], [terrain('a'), terrain('b', 2, [8, 0, 0])]),
      ),
    ).toThrow(/overlap/i);
  });
});
