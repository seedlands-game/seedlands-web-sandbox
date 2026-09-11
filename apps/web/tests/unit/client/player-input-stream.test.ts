import { describe, expect, it } from 'vitest';
import { PlayerInputStream } from '../../../src/client/player-input-stream';

describe('PlayerInputStream', () => {
  it('把视角相对按键转换成世界坐标输入，并为每个预测步分配唯一目标 tick', () => {
    const stream = new PlayerInputStream('session:1');
    const forward = stream.sample({
      physicsTick: 10,
      issuedAtMs: 100,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: true, back: false, left: false, right: true, jump: false, crouch: false },
    });
    expect(forward).toMatchObject({
      sequence: 0,
      targetPhysicsTick: 12,
      state: { jumpHeld: false, verticalIntent: 0 },
    });
    expect(forward!.state.moveX).toBeCloseTo(Math.SQRT1_2);
    expect(forward!.state.moveZ).toBeCloseTo(-Math.SQRT1_2);
    const changed = stream.sample({
      physicsTick: 10,
      issuedAtMs: 102,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: false, back: false, left: false, right: false, jump: true, crouch: false },
    });
    expect(changed).toMatchObject({
      sequence: 1,
      targetPhysicsTick: 13,
      state: { moveX: 0, moveZ: 0, jumpHeld: true, verticalIntent: 1 },
      edges: { jumpPressed: true },
    });
  });

  it('持续按住 Space 每个新物理步都保留 jumpHeld，释放后不会被旧 press 重新粘住', () => {
    const stream = new PlayerInputStream('session:2');
    const held = stream.sample({
      physicsTick: 20,
      issuedAtMs: 1,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: false, back: false, left: false, right: false, jump: true, crouch: false },
    })!;
    const repeated = stream.sample({
      physicsTick: 21,
      issuedAtMs: 2,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: false, back: false, left: false, right: false, jump: true, crouch: false },
    })!;
    const released = stream.sample({
      physicsTick: 21,
      issuedAtMs: 3,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: false, back: false, left: false, right: false, jump: false, crouch: false },
    })!;

    expect(held.edges.jumpPressed).toBe(true);
    expect(repeated).toMatchObject({ targetPhysicsTick: 23, state: { jumpHeld: true }, edges: { jumpPressed: false } });
    expect(released).toMatchObject({
      targetPhysicsTick: 24,
      state: { jumpHeld: false },
      edges: { jumpPressed: false },
    });
    expect([held, repeated, released].map((command) => command.sequence)).toEqual([0, 1, 2]);
  });

  it('重同步后从权威 tick 的有限 lead 重新开始', () => {
    const stream = new PlayerInputStream('session:3');
    const sample = {
      physicsTick: 2,
      issuedAtMs: 1,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: true, back: false, left: false, right: false, jump: false, crouch: false },
    } as const;
    expect(stream.sample(sample)?.targetPhysicsTick).toBe(4);
    stream.resynchronize(100);
    expect(stream.sample({ ...sample, physicsTick: 100, issuedAtMs: 2 })?.targetPhysicsTick).toBe(102);
  });
});
