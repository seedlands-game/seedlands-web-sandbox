import { describe, expect, it } from 'vitest';
import {
  LocalPlayerPrediction,
  type PredictionAuthorityState,
} from '../../apps/web/src/client/local-player-prediction';
import {
  AuthoritySnapshotGate,
  type AuthoritySnapshotOrder,
} from '../../apps/web/src/client/authority/authority-snapshot-gate';
import type { AuthoritySnapshot } from '../../packages/game-core/src/server/authority/authority-session';
import type { Collider, PhysicsWorld, WorldAabb } from '../../packages/game-core/src/physics';
import { InputCommandBuffer, type InputCommand } from '../../packages/game-core/src/runtime/session-protocol';

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
  revisionVector(_keys?: Iterable<string>): Record<string, number> {
    return { '0,0,0': this.revision };
  }
}

class LazyRevisionWorld extends RevisionWorld {
  private queried = false;
  override querySolids(bounds: WorldAabb): readonly Collider[] {
    this.queried = true;
    return super.querySolids(bounds);
  }
  override revisionVector(keys?: Iterable<string>): Record<string, number> {
    if (keys) return Object.fromEntries([...keys].map((key) => [key, this.revision]));
    return this.queried ? super.revisionVector() : {};
  }
}

const controls = {
  forward: { x: 1, z: 0 },
  right: { x: 0, z: 1 },
  keys: { forward: true, back: false, left: false, right: false, jump: false, crouch: false },
};

describe('生产本地玩家预测运行时', () => {
  it('asks for retained prediction chunk revisions beyond the authority contact window', () => {
    const runtime = new LocalPlayerPrediction('world:1', 60);
    const world = new LazyRevisionWorld();
    world.revisionVector = (keys?: Iterable<string>) =>
      keys ? Object.fromEntries([...keys].map((key) => [key, 1])) : { '0,0,0': 1, '1,0,0': 1 };
    runtime.advance({ ...controls, elapsedSeconds: 1 / 60, snapshot: snapshot(), world, issuedAtMs: 1 });
    expect(runtime.applyAuthoritySnapshot(snapshot(), world).resetReason).toBeNull();
    expect(runtime.pendingFrames).toHaveLength(1);
  });
  it('公开校正的最小字段可直接用于排序与预测，无需内部快照诊断', () => {
    const state: PredictionAuthorityState & AuthoritySnapshotOrder = {
      epoch: 'world:1',
      physicsTick: 1,
      commitSequence: 1,
      paused: false,
      acknowledgedInputSequence: -1,
      inputResyncRequired: false,
      player: { body: body().body, grounded: false },
      chunkRevisions: { '0,0,0': 1 },
    };
    const gate = new AuthoritySnapshotGate('world:1');
    const runtime = new LocalPlayerPrediction('world:1', 60);
    expect(gate.accept(state)).toBeNull();
    expect(runtime.applyAuthoritySnapshot(state, new RevisionWorld()).body).toEqual(state.player.body);
    expect(gate.accept({ ...state, epoch: 'old:1', physicsTick: 2 })).toBe('wrong-epoch');
    expect(gate.accept(state)).toBe('duplicate');
  });
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
    runtime.resynchronize(snapshot(2));
    expect(runtime.resetCounts).toMatchObject({ 'collision-history-missing': 1, 'authority-resync': 1 });
  });

  it('碰撞历史重置后仍保留传输预算并把下一输入投递到未来tick', () => {
    const runtime = new LocalPlayerPrediction('world:1', 120, { estimatedInputTransitMs: 334 });
    const world = new RevisionWorld();
    const authority = new InputCommandBuffer('world:1', 'player-input');
    authority.consumeForTick(140);
    for (let frame = 0; frame < 3; frame += 1) {
      const command = runtime.advance({
        elapsedSeconds: 1 / 120,
        snapshot: snapshot(100),
        world,
        issuedAtMs: frame,
        ...controls,
      }).commands[0];
      expect(authority.push(command)).toBe('accepted');
    }
    world.revision = 2;
    expect(runtime.applyAuthoritySnapshot(snapshot(101), world).resetReason).toBe('collision-history-missing');

    const next = runtime.advance({
      elapsedSeconds: 1 / 120,
      snapshot: snapshot(101),
      world,
      issuedAtMs: 2,
      ...controls,
    }).commands[0];

    expect(next.targetPhysicsTick).toBe(146);
    expect(authority.push(next)).toBe('accepted');
    expect(authority.requiresResync).toBe(false);
  });

  it('Authority明确要求输入重同步时允许从当前权威tick重建目标时间线', () => {
    const runtime = new LocalPlayerPrediction('world:1', 120, { estimatedInputTransitMs: 334 });
    const world = new RevisionWorld();
    let tooFarCommand: InputCommand | undefined;
    for (let frame = 0; frame < 199; frame += 1)
      tooFarCommand = runtime.advance({
        elapsedSeconds: 1 / 120,
        snapshot: snapshot(100),
        world,
        issuedAtMs: frame,
        ...controls,
        keys: { forward: false, back: false, left: false, right: false, jump: false, crouch: false },
      }).commands[0];
    const authority = new InputCommandBuffer('world:1', 'player-input');
    authority.consumeForTick(100);
    expect(authority.push(tooFarCommand!)).toBe('too-far-ahead');
    expect(authority.requiresResync).toBe(true);

    runtime.applyAuthoritySnapshot({ ...snapshot(100), inputResyncRequired: true }, world);
    const next = runtime.advance({
      elapsedSeconds: 1 / 120,
      snapshot: snapshot(100),
      world,
      issuedAtMs: 200,
      ...controls,
    }).commands[0];

    expect(next.targetPhysicsTick).toBe(143);
    expect(authority.push(next)).toBe('accepted');
    expect(authority.requiresResync).toBe(false);
    expect(runtime.resetCounts['authority-resync']).toBe(1);
  });

  it('全新碰撞查询实例可按已加载chunk核对revision而不误清历史', () => {
    const runtime = new LocalPlayerPrediction('world:1', 60);
    runtime.advance({
      elapsedSeconds: 1 / 60,
      snapshot: snapshot(),
      world: new LazyRevisionWorld(),
      issuedAtMs: 1,
      ...controls,
    });

    const result = runtime.applyAuthoritySnapshot(snapshot(1), new LazyRevisionWorld());

    expect(result.resetReason).toBeNull();
    expect(result.replayed).toBe(1);
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

  it('按双向延迟与多轮入站乱序预算投递目标tick且不触发持续重同步', () => {
    const runtime = new LocalPlayerPrediction('world:1', 120, { estimatedInputTransitMs: 334 });
    const authority = new InputCommandBuffer('world:1', 'player-input');
    const decisions: string[] = [];
    for (let cycle = 0; cycle < 8; cycle += 1) {
      const observedTick = 100 + cycle * 2;
      authority.consumeForTick(observedTick + 40);
      const command = runtime.advance({
        elapsedSeconds: 1 / 120,
        snapshot: snapshot(observedTick),
        world: new RevisionWorld(),
        issuedAtMs: cycle,
        ...controls,
      }).commands[0];
      decisions.push(authority.push(command));
      if (cycle === 0) expect(command.targetPhysicsTick).toBe(143);
    }

    expect(decisions).toEqual(Array(8).fill('accepted'));
    expect(authority.requiresResync).toBe(false);
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
