import { describe, expect, it } from 'vitest';
import { LocalPlayerPrediction } from '../../src/client/local-player-prediction';
import type { AuthoritySnapshot } from '../../src/server/authority/authority-session';
import type { Collider, PhysicsWorld, WorldAabb } from '../../src/physics';

const body = (x = 0) => ({
  id: 'player-1',
  type: 'player' as const,
  body: { position: { x, y: 5, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
  grounded: false,
  contacts: [],
});

const snapshot = (physicsTick = 0, acknowledgedInputSequence = -1): AuthoritySnapshot => ({
  kind: 'snapshot',
  protocolVersion: 1,
  epoch: 'world:1',
  physicsTick,
  commitSequence: physicsTick,
  worldMutationCount: 0,
  acknowledgedInputSequence,
  inputResyncRequired: false,
  activeTimeMs: physicsTick * 10,
  integratedPhysicsTimeMs: physicsTick * 10,
  physicsDebtMs: 0,
  player: body(),
  entities: [body()],
  chunkRevisions: { '0,0,0': 1 },
  worldRevision: 1,
  worldTime: 9,
  paused: false,
});

class RevisionWorld implements PhysicsWorld {
  revision = 1;
  wall = false;
  wallMin = 0.3;
  wallMax = 1;
  querySolids(_bounds: WorldAabb): readonly Collider[] {
    return this.wall
      ? [{ id: 'wall', aabb: { min: { x: this.wallMin, y: 0, z: -1 }, max: { x: this.wallMax, y: 8, z: 1 } } }]
      : [];
  }
  revisionVector() {
    return { '0,0,0': this.revision };
  }
}

const controls = {
  forward: { x: 1, z: 0 },
  right: { x: 0, z: 1 },
  keys: { forward: true, back: false, left: false, right: false, jump: false, crouch: false },
};

describe('生产本地玩家预测运行时', () => {
  it.each([30, 60, 120] as const)('%iHz 下不受 30/60/120fps 渲染分片影响', (physicsHz) => {
    const outcomes = ([30, 60, 120] as const).map((renderHz) => {
      const runtime = new LocalPlayerPrediction('world:1', physicsHz);
      const world = new RevisionWorld();
      const commands = [];
      for (let frame = 0; frame < renderHz / 2; frame += 1)
        commands.push(
          ...runtime.advance({
            elapsedSeconds: 1 / renderHz,
            snapshot: snapshot(),
            world,
            issuedAtMs: frame * (1000 / renderHz),
            ...controls,
          }).commands,
        );
      return { commands, state: runtime.physicalBody! };
    });

    expect(outcomes.map((value) => value.commands.length)).toEqual([physicsHz / 2, physicsHz / 2, physicsHz / 2]);
    expect(outcomes[1].commands.map((command) => [command.sequence, command.targetPhysicsTick])).toEqual(
      outcomes[0].commands.map((command) => [command.sequence, command.targetPhysicsTick]),
    );
    expect(outcomes[2].state.position.x).toBeCloseTo(outcomes[0].state.position.x, 8);
    expect(outcomes[2].state.position.y).toBeCloseTo(outcomes[0].state.position.y, 8);
  });

  it('碰撞历史版本缺失时不使用当前新地形重放旧输入', () => {
    const runtime = new LocalPlayerPrediction('world:1', 60);
    const world = new RevisionWorld();
    runtime.advance({ elapsedSeconds: 1 / 60, snapshot: snapshot(), world, issuedAtMs: 1, ...controls });
    world.revision = 2;

    const result = runtime.applyAuthoritySnapshot(snapshot(1), world);

    expect(result.resetReason).toBe('collision-history-missing');
    expect(result.replayed).toBe(0);
    expect(runtime.physicalBody).toEqual(snapshot(1).player.body);
    expect(runtime.lastResetReason).toBe('collision-history-missing');
  });

  it('小误差只形成安全表现偏移，偏移会与墙相交时立即清零', () => {
    const runtime = new LocalPlayerPrediction('world:1', 60);
    const world = new RevisionWorld();
    runtime.advance({ elapsedSeconds: 1 / 60, snapshot: snapshot(), world, issuedAtMs: 1, ...controls });
    const base = snapshot(1);
    const authoritative = {
      ...base,
      player: {
        ...base.player,
        body: { ...base.player.body, position: { ...base.player.body.position, x: -0.05 } },
      },
    };

    const reconciled = runtime.applyAuthoritySnapshot(authoritative, world);
    expect(reconciled.resetReason).toBeNull();
    expect(runtime.presentationOffset.x).toBeGreaterThan(0);
    expect(runtime.physicalBody?.position.x).toBeLessThan(runtime.presentedBody(world, 0).position.x);

    world.wall = true;
    expect(runtime.presentedBody(world, 1 / 60)).toEqual(runtime.physicalBody);
    expect(runtime.presentationOffset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('输入中断立即生成新序号的全零持续状态并清空跳跃边沿', () => {
    const runtime = new LocalPlayerPrediction('world:1', 60);
    const world = new RevisionWorld();
    const moving = runtime.advance({
      elapsedSeconds: 1 / 60,
      snapshot: snapshot(),
      world,
      issuedAtMs: 1,
      ...controls,
      keys: { ...controls.keys, jump: true },
    }).commands[0];

    const stopped = runtime.interrupt(snapshot(), 2);

    expect(stopped.sequence).toBe(moving.sequence + 1);
    expect(stopped.state).toEqual({ moveX: 0, moveZ: 0, verticalIntent: 0, jumpHeld: false });
    expect(stopped.edges).toEqual({ jumpPressed: false });
    expect(runtime.pendingFrames).toEqual([]);
  });

  it('按受控双向传输时间把目标tick投递到预计抵达时刻之后', () => {
    const runtime = new LocalPlayerPrediction('world:1', 120, { estimatedOneWayLatencyMs: 150 });
    const command = runtime.advance({
      elapsedSeconds: 1 / 120,
      snapshot: snapshot(100),
      world: new RevisionWorld(),
      issuedAtMs: 1,
      ...controls,
    }).commands[0];

    expect(command.targetPhysicsTick).toBe(138);
  });

  it('表现偏移两端均为空但路径穿过薄墙时也立即校正', () => {
    const runtime = new LocalPlayerPrediction('world:1', 60, { maxSmoothError: 100 });
    const world = new RevisionWorld();
    let lastSequence = -1;
    for (let frame = 0; frame < 60; frame += 1) {
      const advanced = runtime.advance({
        elapsedSeconds: 1 / 60,
        snapshot: snapshot(),
        world,
        issuedAtMs: frame,
        ...controls,
      });
      lastSequence = advanced.commands.at(-1)?.sequence ?? lastSequence;
    }
    const base = snapshot(60, lastSequence);
    const authoritative = {
      ...base,
      player: { ...base.player, body: { ...base.player.body, position: { ...base.player.body.position, x: -0.5 } } },
    };
    world.wall = true;
    world.wallMin = 0;
    world.wallMax = 0.05;

    runtime.applyAuthoritySnapshot(authoritative, world);

    expect(runtime.presentationOffset.x).toBeGreaterThan(1);
    expect(runtime.presentedBody(world, 0)).toEqual(runtime.physicalBody);
    expect(runtime.presentationOffset).toEqual({ x: 0, y: 0, z: 0 });
  });
});
