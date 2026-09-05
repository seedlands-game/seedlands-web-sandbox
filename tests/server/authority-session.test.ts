import { describe, expect, it } from 'vitest';
import type { BodyConfig } from '../../src/physics';
import { AuthoritySession, type AuthorityServerPort } from '../../src/server/authority/authority-session';
import { VoxelCollisionWorld } from '../../src/server/authority/voxel-collision-world';
import { Voxel } from '../../src/world/voxel';
import { PROTOCOL_VERSION, type InputCommand } from '../../src/runtime/session-protocol';

type Entity = ReturnType<AuthorityServerPort['queryEntities']>[number];

class MemoryAuthorityServer implements AuthorityServerPort {
  worldRevision = 0;
  mutationCount = 0;
  worldTime = 8;
  readonly entities = new Map<string, Entity>();
  gameplayAdvanceSeconds = 0;

  constructor(entity: Entity) {
    this.entities.set(entity.id, entity);
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
    if (!entity) throw new Error('missing entity');
    this.entities.set(id, { ...entity, ...update });
  }

  advanceGameplayRules(seconds: number) {
    this.gameplayAdvanceSeconds += seconds;
  }

  advanceWorldClock(hours: number) {
    this.worldTime += hours;
  }
}

const bodyConfig: BodyConfig = {
  localAabb: { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: 1.8, z: 0.3 } },
  gravity: 20,
  terminalVelocity: 30,
  maxHorizontalSpeed: 4,
  groundAcceleration: 40,
  airAcceleration: 10,
  jumpSpeed: 7,
};

const player = (): Entity => ({
  id: 'player-1',
  type: 'player',
  position: [0.5, 0, 0.5],
  physicsVelocity: [0, 0, 0],
});

const input = (sequence: number, moveX: number, jumpHeld = false): InputCommand => ({
  kind: 'input',
  protocolVersion: PROTOCOL_VERSION,
  epoch: 'test-world:1',
  stream: 'player-input',
  sequence,
  targetPhysicsTick: 0,
  issuedAtMs: sequence,
  state: { moveX, moveZ: 0, verticalIntent: 0, jumpHeld },
  edges: { jumpPressed: jumpHeld },
});

describe('AuthoritySession', () => {
  it('以单一序号排序物理、玩法和外部权威提交，并单列体素写入次数', () => {
    const server = new MemoryAuthorityServer(player());
    const session = new AuthoritySession({
      epoch: 'test-world:1',
      playerId: 'player-1',
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: {
        getLoadedVoxel: (_x, y) => ({ voxel: y === -1 ? Voxel.Stone : Voxel.Air, chunkKey: 'loaded', revision: 0 }),
      },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
    });
    server.mutationCount = 7;
    const due = session.wake(50);
    expect(due.physicsTick).toBe(3);
    expect(due.commitSequence).toBe(4);
    expect(due.worldMutationCount).toBe(7);
    expect(due.worldTime).toBeCloseTo(8.002, 7);

    session.commitExternalState();
    expect(session.wake(50).commitSequence).toBe(5);
  });

  it('在逻辑没有返回新意图时仍独立产出固定物理快照', () => {
    const server = new MemoryAuthorityServer(player());
    const session = new AuthoritySession({
      epoch: 'test-world:1',
      playerId: 'player-1',
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: {
        getLoadedVoxel: (_x, y) => ({ voxel: y === -1 ? Voxel.Stone : Voxel.Air, chunkKey: 'loaded', revision: 0 }),
      },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
    });
    session.receiveInput(input(1, 1));

    let snapshot = session.wake(0);
    for (let frame = 1; frame <= 60; frame += 1) snapshot = session.wake((frame * 1_000) / 60);

    expect(snapshot.physicsTick).toBe(60);
    expect(snapshot.player.body.position.x).toBeGreaterThan(3);
    expect(snapshot.acknowledgedInputSequence).toBe(1);
    expect(server.gameplayAdvanceSeconds).toBeCloseTo(1, 7);
  });

  it('暂停后不补算暂停区间并清空持续输入', () => {
    const server = new MemoryAuthorityServer(player());
    const session = new AuthoritySession({
      epoch: 'test-world:1',
      playerId: 'player-1',
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: {
        getLoadedVoxel: (_x, y) => ({ voxel: y === -1 ? Voxel.Stone : Voxel.Air, chunkKey: 'loaded', revision: 0 }),
      },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
    });
    session.receiveInput(input(1, 1));
    session.wake(100);
    const beforePause = server.getEntity('player-1')!;
    session.pause(100);
    const duringPause = session.wake(5_000);

    expect(server.getEntity('player-1')?.position).toEqual(beforePause.position);
    expect(server.getEntity('player-1')?.physicsVelocity?.[0]).toBe(0);
    expect(duringPause.physicsTick).toBe(4);
    expect(duringPause.physicsDebtMs).toBeGreaterThan(30);

    session.resume(5_000);
    session.wake(5_100);
    const snapshot = session.wake(5_100);

    expect(snapshot.activeTimeMs).toBeCloseTo(200, 7);
    expect(snapshot.player.body.velocity.x).toBe(0);
    expect(snapshot.paused).toBe(false);
  });

  it('按目标 tick 回放输入，消息逐步到达和预先批量到达结果一致', () => {
    const create = () => {
      const server = new MemoryAuthorityServer(player());
      const session = new AuthoritySession({
        epoch: 'test-world:1',
        playerId: 'player-1',
        server,
        bodyConfigFor: () => bodyConfig,
        voxelSource: {
          getLoadedVoxel: (_x, y) => ({ voxel: y === -1 ? Voxel.Stone : Voxel.Air, chunkKey: 'loaded', revision: 0 }),
        },
        frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
        startTimeMs: 0,
      });
      return { server, session };
    };
    const move = { ...input(1, 1), targetPhysicsTick: 1 };
    const stop = { ...input(2, 0), targetPhysicsTick: 2 };
    const incremental = create();
    incremental.session.receiveInput(move);
    incremental.session.wake(1_000 / 60);
    incremental.session.receiveInput(stop);
    const incrementalSnapshot = incremental.session.wake(2_000 / 60);
    const batched = create();
    batched.session.receiveInput(move);
    batched.session.receiveInput(stop);
    expect(batched.session.wake(0).acknowledgedInputSequence).toBe(-1);
    const batchedSnapshot = batched.session.wake(2_000 / 60);

    expect(batchedSnapshot.player.body).toEqual(incrementalSnapshot.player.body);
    expect(batchedSnapshot.acknowledgedInputSequence).toBe(2);
  });

  it('实体消失后从权威快照移除旧身体', () => {
    const server = new MemoryAuthorityServer(player());
    server.entities.set('item-1', {
      id: 'item-1',
      type: 'world-item',
      position: [2, 2, 2],
      physicsVelocity: [0, 0, 0],
    });
    const session = new AuthoritySession({
      epoch: 'test-world:1',
      playerId: 'player-1',
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: {
        getLoadedVoxel: () => ({ voxel: Voxel.Air, chunkKey: 'loaded', revision: 0 }),
      },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
    });
    expect(session.wake(0).entities.map((entity) => entity.id)).toContain('item-1');
    server.entities.delete('item-1');

    expect(session.wake(1_000 / 60).entities.map((entity) => entity.id)).not.toContain('item-1');
  });

  it('流体到期时只请求派生计算，不在 Authority 唤醒内同步推进旧流体', () => {
    const server = new MemoryAuthorityServer(player());
    const fluidRequests: number[] = [];
    const session = new AuthoritySession({
      epoch: 'test-world:1',
      playerId: 'player-1',
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: {
        getLoadedVoxel: (_x, y) => ({ voxel: y === -1 ? Voxel.Stone : Voxel.Air, chunkKey: 'loaded', revision: 0 }),
      },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
      requestFluidWork: (elapsedPeriods) => fluidRequests.push(elapsedPeriods),
    });

    session.wake(100);

    expect(fluidRequests).toEqual([3]);
    expect('advanceFluid' in server).toBe(false);
  });
});

describe('VoxelCollisionWorld', () => {
  it('未知 Chunk 变成合成阻挡并触发异步加载请求', () => {
    const requests: string[] = [];
    const world = new VoxelCollisionWorld({ getLoadedVoxel: () => null }, (chunkKey) => requests.push(chunkKey));

    const colliders = world.querySolids({ min: { x: 31.8, y: 2, z: 0 }, max: { x: 32.2, y: 3, z: 1 } });

    expect(colliders.length).toBeGreaterThan(0);
    expect(colliders.every((collider) => collider.id?.startsWith('unknown:'))).toBe(true);
    expect(new Set(requests)).toEqual(new Set(['0,0,0', '1,0,0']));
  });

  it('已装载空气与未知区域明确区分且灯笼使用注册碰撞形状', () => {
    const world = new VoxelCollisionWorld({
      getLoadedVoxel: (x, y, z) => ({
        voxel: x === 2 && y === 0 && z === 3 ? Voxel.Lantern : Voxel.Air,
        chunkKey: 'loaded',
        revision: 4,
      }),
    });

    expect(world.querySolids({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } })).toEqual([]);
    expect(world.querySolids({ min: { x: 2, y: 0, z: 3 }, max: { x: 3, y: 1, z: 4 } })).toEqual([
      expect.objectContaining({
        id: 'voxel:2,0,3:0',
        aabb: { min: { x: 2.25, y: 0, z: 3.25 }, max: { x: 2.75, y: 0.94, z: 3.75 } },
      }),
    ]);
  });

  it('流体体积与渲染水面共用7/8源水高度且上方覆水时才满格', () => {
    const world = new VoxelCollisionWorld({
      getLoadedVoxel: (_x, y) => ({
        voxel: y === 0 || y === 1 ? Voxel.Water : Voxel.Air,
        chunkKey: 'loaded',
        revision: 2,
        ...(y === 0 || y === 1 ? { fluid: { level: 8 } } : {}),
      }),
    });

    expect(world.sampleFluid!({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } })[0]).toMatchObject({
      aabb: { max: { y: 1 } },
    });
    expect(world.sampleFluid!({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } })[0]).not.toHaveProperty(
      'surfaceY',
    );
    expect(world.sampleFluid!({ min: { x: 0, y: 1, z: 0 }, max: { x: 1, y: 2, z: 1 } })[0]).toMatchObject({
      aabb: { max: { y: 1 + 7 / 8 } },
      surfaceY: 1 + 7 / 8,
    });

    const unknownAbove = new VoxelCollisionWorld({
      getLoadedVoxel: (_x, y) =>
        y === 0 ? { voxel: Voxel.Water, chunkKey: 'loaded', revision: 2, fluid: { level: 8 } } : null,
    });
    expect(unknownAbove.sampleFluid!({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } })[0]).not.toHaveProperty(
      'surfaceY',
    );
  });
});
