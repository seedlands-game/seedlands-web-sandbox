import { describe, expect, it } from 'vitest';
import { CollisionLayer, bodyConfigFor, type BodyConfig } from '../../src/physics';
import {
  AuthoritySession,
  type AuthorityEntity,
  type AuthorityServerPort,
} from '../../src/server/authority/authority-session';
import { Voxel } from '../../src/world/voxel';

type Entity = ReturnType<AuthorityServerPort['queryEntities']>[number];

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

class EntityPhysicsServer implements AuthorityServerPort {
  worldRevision = 0;
  mutationCount = 0;
  worldTime = 8;
  readonly entities = new Map<string, Entity>();
  readonly pickupCalls: { playerId: string; itemId: string }[] = [];
  pickupSucceeds = false;

  constructor(entities: readonly Entity[]) {
    entities.forEach((entity) => this.entities.set(entity.id, entity));
  }

  getEntity(id: string) {
    return this.entities.get(id) ?? null;
  }

  queryEntities() {
    return [...this.entities.values()].map((entity) => ({
      ...entity,
      position: [...entity.position] as [number, number, number],
      physicsVelocity: entity.physicsVelocity ? ([...entity.physicsVelocity] as [number, number, number]) : undefined,
    }));
  }

  updateEntity(id: string, update: { position: [number, number, number]; physicsVelocity: [number, number, number] }) {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`missing entity: ${id}`);
    this.entities.set(id, { ...entity, ...update });
  }

  advanceGameplayRules() {}

  queryPickupTargets() {
    return this.queryEntities()
      .filter((entity) => entity.type === 'player')
      .map((entity) => ({ id: entity.id, position: entity.position }));
  }

  pickupItem(playerId: string, itemId: string) {
    this.pickupCalls.push({ playerId, itemId });
    if (this.pickupSucceeds) this.entities.delete(itemId);
    return { success: this.pickupSucceeds };
  }
}

const characterConfig: BodyConfig = {
  localAabb: { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: 0.8, z: 0.3 } },
  collisionLayer: CollisionLayer.Character,
  collisionMask: CollisionLayer.World | CollisionLayer.Character,
  gravity: 18,
  terminalVelocity: 24,
  maxHorizontalSpeed: 4,
  groundAcceleration: 40,
  airAcceleration: 10,
};

const smallCharacterConfig: BodyConfig = {
  ...characterConfig,
  localAabb: { min: { x: -0.05, y: 0, z: -0.05 }, max: { x: 0.05, y: 0.8, z: 0.05 } },
};

const smallItemConfig: BodyConfig = {
  ...bodyConfigFor('world-item'),
  localAabb: { min: { x: -0.05, y: 0, z: -0.05 }, max: { x: 0.05, y: 0.1, z: 0.05 } },
};

const entity = (
  id: string,
  type: AuthorityEntity['type'],
  position: [number, number, number],
  archetype?: AuthorityEntity['archetype'],
): Entity => ({ id, type, position, physicsVelocity: [0, 0, 0], ...(archetype ? { archetype } : {}) });

const createSession = (
  server: EntityPhysicsServer,
  options: Readonly<{
    voxelAt?: (x: number, y: number, z: number) => number | null;
    configFor?: (entity: AuthorityEntity) => BodyConfig;
    unknownRequests?: string[];
  }> = {},
) =>
  new AuthoritySession({
    epoch: 'entity-physics:1',
    playerId: 'player',
    server,
    bodyConfigFor:
      options.configFor ??
      ((candidate) =>
        candidate.type === 'player'
          ? bodyConfigFor('player')
          : candidate.type === 'world-item'
            ? bodyConfigFor('world-item')
            : bodyConfigFor(candidate.archetype ?? 'grazer')),
    voxelSource: {
      getLoadedVoxel: (x, y, z) => {
        const selected = options.voxelAt?.(x, y, z);
        const voxel = selected === undefined ? (y === -1 ? Voxel.Stone : Voxel.Air) : selected;
        return voxel === null ? null : { voxel, chunkKey: 'loaded', revision: 0 };
      },
    },
    frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
    startTimeMs: 0,
    requestUnknownChunk: (chunkKey) => options.unknownRequests?.push(chunkKey),
  });

const wakeSteps = (session: AuthoritySession, count: number) => {
  let snapshot = session.wake(0);
  for (let step = 1; step <= count; step += 1) snapshot = session.wake((step * 1_000) / 60);
  return snapshot;
};

describe('Authority 实体统一物理接线', () => {
  it('按实体 id 稳定分离墙边角色，物件仍由碰撞矩阵允许重叠', () => {
    const run = (reversed: boolean) => {
      const entities = [
        entity('player', 'player', [0.3, 0, 0.5]),
        entity('grazer', 'creature', [0.7, 0, 0.5], 'grazer'),
        entity('item', 'world-item', [0.7, 0, 0.5]),
      ];
      const server = new EntityPhysicsServer(reversed ? entities.reverse() : entities);
      server.queryPickupTargets = () => [];
      const session = createSession(server, {
        configFor: (candidate) =>
          candidate.type === 'world-item'
            ? { ...smallItemConfig, localAabb: characterConfig.localAabb }
            : characterConfig,
        voxelAt: (x, y) => (y === -1 || (x === -1 && y === 0) ? Voxel.Stone : Voxel.Air),
      });

      session.wake(0);
      const first = session.wake(1_000 / 60);
      expect(first.entities.find((body) => body.id === 'grazer')?.contacts).toEqual(
        expect.arrayContaining([expect.objectContaining({ normal: { x: 0, y: 1, z: 0 } })]),
      );
      session.wake((2 * 1_000) / 60);
      const snapshot = session.wake((3 * 1_000) / 60);
      const player = server.getEntity('player')!;
      const grazer = server.getEntity('grazer')!;
      const item = server.getEntity('item')!;
      expect(player.position[0]).toBeGreaterThanOrEqual(0.3 - 1e-6);
      expect(grazer.position[0] - player.position[0]).toBeGreaterThanOrEqual(0.6 - 1e-6);
      expect(item.position[0]).toBeCloseTo(0.7, 6);
      expect(snapshot.entities.find((body) => body.id === 'player')?.grounded).toBe(true);
      expect(snapshot.entities.find((body) => body.id === 'grazer')?.grounded).toBe(true);
      expect(snapshot.entities.find((body) => body.id === 'grazer')?.body.position.x).toBe(grazer.position[0]);
      expect(
        snapshot.entities
          .find((body) => body.id === 'grazer')
          ?.contacts.every(
            (contact) => contact.point.x >= grazer.position[0] - 0.3 && contact.point.x <= grazer.position[0] + 0.3,
          ),
      ).toBe(true);
      return { player: player.position, grazer: grazer.position, item: item.position };
    };

    expect(run(false)).toEqual(run(true));
  });

  it('掉落物在 2.25 格内以 6 格每秒经统一 sweep 吸附，并在 0.75 格内只提交一次拾取', () => {
    const server = new EntityPhysicsServer([
      entity('player', 'player', [0, 0, 0.5]),
      entity('item', 'world-item', [2, 0, 0.5]),
    ]);
    const session = createSession(server);

    session.wake(1_000 / 60);
    expect(server.getEntity('item')?.position[0]).toBeCloseTo(1.983333, 6);
    expect(server.getEntity('item')?.physicsVelocity?.[0]).toBeCloseTo(-1, 6);

    for (let step = 2; step <= 6; step += 1) session.wake((step * 1_000) / 60);
    expect(server.getEntity('item')?.physicsVelocity?.[0]).toBeCloseTo(-6, 6);
    for (let step = 7; step <= 15; step += 1) session.wake((step * 1_000) / 60);
    expect(server.pickupCalls).toEqual([{ playerId: 'player', itemId: 'item' }]);
  });

  it('吸附以有界加速度进入单次三维积分，不重置既有下落速度', () => {
    const fallingItem = { ...entity('item', 'world-item', [2, 4, 0.5]), physicsVelocity: [0, -4, 0] } as Entity;
    const server = new EntityPhysicsServer([entity('player', 'player', [0, 4, 0.5]), fallingItem]);
    const session = createSession(server, { voxelAt: () => Voxel.Air });

    session.wake(1_000 / 60);

    expect(server.getEntity('item')!.physicsVelocity![0]).toBeLessThan(0);
    expect(server.getEntity('item')!.physicsVelocity![0]).toBeGreaterThanOrEqual(-1.01);
    expect(server.getEntity('item')!.physicsVelocity![1]).toBeLessThan(-3);
  });

  it('真实灯笼薄碰撞箱阻挡吸附路径，距离虽小于拾取阈值也不跨墙提交', () => {
    const server = new EntityPhysicsServer([
      entity('player', 'player', [0.85, 0, 0.5]),
      entity('item', 'world-item', [0.15, 0, 0.5]),
    ]);
    const session = createSession(server, {
      configFor: (candidate) => (candidate.type === 'world-item' ? smallItemConfig : smallCharacterConfig),
      voxelAt: (x, y, z) => {
        if (y === -1) return Voxel.Stone;
        return key(x, y, z) === '0,0,0' ? Voxel.Lantern : Voxel.Air;
      },
    });

    wakeSteps(session, 8);

    expect(server.getEntity('item')?.position[0]).toBeLessThanOrEqual(0.2 + 1e-6);
    expect(server.pickupCalls).toEqual([]);
  });

  it('完整三维身体 sweep 阻挡灯笼底面的近距离拾取', () => {
    const lowItemConfig: BodyConfig = {
      ...smallItemConfig,
      localAabb: { min: { x: -0.05, y: 0, z: -0.05 }, max: { x: 0.05, y: 0.05, z: 0.05 } },
    };
    const lowCharacterConfig: BodyConfig = {
      ...smallCharacterConfig,
      localAabb: { min: { x: -0.05, y: 0, z: -0.05 }, max: { x: 0.05, y: 0.1, z: 0.05 } },
    };
    const server = new EntityPhysicsServer([
      entity('player', 'player', [0.8, 0.3, 0.5]),
      entity('item', 'world-item', [0.5, -0.1, 0.5]),
    ]);
    const session = createSession(server, {
      configFor: (candidate) => (candidate.type === 'world-item' ? lowItemConfig : lowCharacterConfig),
      voxelAt: (x, y, z) => (key(x, y, z) === '0,0,0' ? Voxel.Lantern : Voxel.Air),
    });

    wakeSteps(session, 2);

    expect(server.pickupCalls).toEqual([]);
  });

  it('拾取失败只做有界退避，玩法状态改变后可成功重试且只删除一次', () => {
    const server = new EntityPhysicsServer([
      entity('player', 'player', [0, 0, 0.5]),
      entity('item', 'world-item', [0.7, 0, 0.5]),
    ]);
    const session = createSession(server);
    session.wake(1_000 / 60);
    expect(server.pickupCalls).toHaveLength(1);
    server.pickupSucceeds = true;

    for (let step = 2; step <= 20; step += 1) session.wake((step * 1_000) / 60);

    expect(server.pickupCalls).toHaveLength(2);
    expect(server.getEntity('item')).toBeNull();
  });

  it('较近但隔墙的玩家不会遮蔽范围内可达的稳定吸附目标', () => {
    const server = new EntityPhysicsServer([
      entity('a-blocked', 'player', [2.4, 0, 0.5]),
      entity('player', 'player', [-1.5, 0, 0.5]),
      entity('item', 'world-item', [0.5, 0, 0.5]),
    ]);
    const session = createSession(server, {
      configFor: (candidate) => (candidate.type === 'world-item' ? smallItemConfig : smallCharacterConfig),
      voxelAt: (x, y) => (x === 1 && y === 0 ? Voxel.Stone : y === -1 ? Voxel.Stone : Voxel.Air),
    });

    wakeSteps(session, 120);

    expect(server.getEntity('item')!.position[0]).toBeLessThan(0.5);
  });

  it('只在显式队列处理相邻体素恢复并记录原因、距离、失败和缺失实体', () => {
    const server = new EntityPhysicsServer([entity('player', 'player', [0, 0, 0])]);
    const session = createSession(server, {
      configFor: () => characterConfig,
      voxelAt: (x, y, z) => (x >= -1 && x <= 0 && y >= -1 && y <= 2 && z >= -1 && z <= 0 ? Voxel.Stone : Voxel.Air),
    });
    expect(session.requestBodyRecovery('player', 'legacy-restore', 2)).toBe(true);
    expect(session.requestBodyRecovery('missing', 'external-geometry-change', 1)).toBe(true);

    const recovered = wakeSteps(session, 1);
    expect(Math.abs(server.getEntity('player')!.position[0])).toBeCloseTo(1.300001, 6);
    expect(recovered.diagnostics?.recoveryResults).toEqual([
      {
        entityId: 'missing',
        reason: 'external-geometry-change',
        status: 'missing',
        distance: 0,
        physicsTick: 1,
      },
      {
        entityId: 'player',
        reason: 'legacy-restore',
        status: 'recovered',
        distance: expect.closeTo(1.300001, 6),
        physicsTick: 1,
      },
    ]);

    server.updateEntity('player', { position: [0, 0, 0], physicsVelocity: [0, 0, 0] });
    session.synchronizeExternalState();
    expect(session.requestBodyRecovery('player', 'external-geometry-change', 1.2)).toBe(true);
    const blocked = session.wake((2 * 1_000) / 60);
    expect(server.getEntity('player')?.position).toEqual([0, 0, 0]);
    expect(blocked.diagnostics?.recoveryResults.at(-1)).toMatchObject({
      entityId: 'player',
      reason: 'external-geometry-change',
      status: 'blocked',
      distance: 0,
    });

    const ordinaryStep = session.wake((3 * 1_000) / 60);
    expect(server.getEntity('player')?.position).toEqual([0, 0, 0]);
    expect(ordinaryStep.diagnostics?.recoveryResults).toHaveLength(3);
  });

  it('未知区域继续作为阻挡并仅发出异步加载请求', () => {
    const requests: string[] = [];
    const server = new EntityPhysicsServer([
      entity('player', 'player', [2.5, 0, 0.5]),
      entity('item', 'world-item', [0.5, 0, 0.5]),
    ]);
    const session = createSession(server, {
      unknownRequests: requests,
      voxelAt: (x, y) => (x === 1 && y >= 0 ? null : y === -1 ? Voxel.Stone : Voxel.Air),
    });

    wakeSteps(session, 8);

    expect(requests.length).toBeGreaterThan(0);
    expect(server.getEntity('item')!.position[0]).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(server.pickupCalls).toEqual([]);
  });

  it('每个物理步只处理固定数量的恢复请求并保留余项', () => {
    const server = new EntityPhysicsServer([entity('player', 'player', [0, 0, 0.5])]);
    const session = createSession(server);
    for (let index = 0; index < 10; index += 1)
      expect(session.requestBodyRecovery(`missing-${index}`, 'external-geometry-change', 8)).toBe(true);

    const first = session.wake(1_000 / 60);
    expect(first.diagnostics?.recoveryResults).toHaveLength(4);
    const second = session.wake((2 * 1_000) / 60);
    expect(second.diagnostics?.recoveryResults).toHaveLength(8);
    const third = session.wake((3 * 1_000) / 60);
    expect(third.diagnostics?.recoveryResults).toHaveLength(11);
  });

  it('合法最大距离的稠密恢复耗尽候选预算时记录阻挡，并继续同批请求和物理步', () => {
    const server = new EntityPhysicsServer([entity('player', 'player', [0.5, -0.5, 0.5])]);
    const session = createSession(server, {
      configFor: () => characterConfig,
      voxelAt: (_x, y) => (y <= 0 ? Voxel.Stone : Voxel.Air),
    });
    expect(session.requestBodyRecovery('player', 'external-geometry-change', 8)).toBe(true);
    expect(session.requestBodyRecovery('z-after', 'external-geometry-change', 1)).toBe(true);

    expect(() => session.wake(1_000 / 60)).not.toThrow();
    const snapshot = session.wake(1_000 / 60);
    expect(snapshot.physicsTick).toBe(1);
    expect(snapshot.diagnostics?.recoveryResults).toEqual([
      expect.objectContaining({ entityId: 'player', status: 'blocked', distance: 0 }),
      expect.objectContaining({ entityId: 'z-after', status: 'missing', distance: 0 }),
    ]);
  });
});
