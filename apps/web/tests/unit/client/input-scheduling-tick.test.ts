import { describe, expect, it, vi } from 'vitest';
import { InputCommandBuffer } from '@seedlands/stdlib/runtime/session-protocol';
import { PlayerInputStream } from '../../../src/client/player-input-stream';
import { BrowserInputSchedulingClock, inputSchedulingTick } from '../../../src/client/authority/input-scheduling-tick';

const snapshot = { physicsTick: 100, paused: false };
describe('Browser input scheduling age', () => {
  it('客户端时钟接收完整快照后保留已有物理积压', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    try {
      const clock = new BrowserInputSchedulingClock();
      const indebted = { ...snapshot, physicsDebtMs: 500 } as Parameters<typeof clock.accept>[0];
      clock.accept(indebted, performance.timeOrigin + 1_000);
      expect(clock.tick(60)).toBe(130);
      expect(indebted.physicsTick).toBe(100);
    } finally {
      now.mockRestore();
    }
  });
  it.each([30, 60, 120] as const)('%iHz把已有物理积压放在新输入之前', (hz) => {
    const indebted = { ...snapshot, physicsDebtMs: 500 };
    expect(inputSchedulingTick(indebted, hz, 1_000, 1_000)).toBe(100 + hz / 2);
    expect(inputSchedulingTick(indebted, hz, 1_000, 1_500)).toBe(100 + hz);
    expect(indebted.physicsTick).toBe(100);
  });
  it('快照年龄与积压共用原两秒上限，paused积压不推算', () => {
    const indebted = { ...snapshot, physicsDebtMs: 1_750 };
    expect(inputSchedulingTick(indebted, 120, 1_000, 1_500)).toBe(340);
    expect(inputSchedulingTick({ ...indebted, paused: true }, 120, 1_000, 1_500)).toBe(100);
  });
  it.each([NaN, Infinity, -1, '500', null])('坏积压%s不能制造估计tick', (physicsDebtMs) => {
    const indebted = { ...snapshot, physicsDebtMs } as unknown as Parameters<typeof inputSchedulingTick>[0];
    expect(inputSchedulingTick(indebted, 60, 1_000, 1_500)).toBe(100);
  });
  it('正式buffer追赶积压时新按键保持未来，释放仍在原未来门禁内', () => {
    const indebted = { ...snapshot, physicsDebtMs: 500 };
    const buffer = new InputCommandBuffer('world:1', 'player-input');
    buffer.consumeForTick(100);
    const stream = new PlayerInputStream('world:1');
    const command = stream.sample({
      physicsTick: inputSchedulingTick(indebted, 60, 1_000, 1_000),
      issuedAtMs: 1_000,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: true, back: false, left: false, right: false, jump: false, crouch: false },
    })!;
    expect(command.targetPhysicsTick).toBe(132);
    expect(buffer.push(command)).toBe('accepted');
    for (let tick = 101; tick <= 131; tick++)
      expect(buffer.consumeForTick(tick)).toMatchObject({ state: { moveZ: 0 }, acknowledgedSequence: -1 });
    expect(buffer.consumeForTick(132)).toMatchObject({ state: { moveZ: -1 }, acknowledgedSequence: 0 });
    const released = stream.release(inputSchedulingTick(indebted, 60, 1_000, 1_080), 1_080);
    expect(released.targetPhysicsTick).toBe(136);
    expect(buffer.push(released)).toBe('accepted');
    expect(buffer.consumeForTick(136)).toMatchObject({ state: { moveZ: 0 }, acknowledgedSequence: 1 });
    expect(buffer.requiresResync).toBe(false);
  });
  it.each([30, 60, 120] as const)('%iHz advances scheduling only across a queued half-second', (hz) => {
    expect(inputSchedulingTick(snapshot, hz, 1_000, 1_500)).toBe(100 + hz / 2);
    expect(snapshot.physicsTick).toBe(100);
    expect(inputSchedulingTick(snapshot, hz, 1_000, 1_501)).toBe(100 + hz / 2);
  });
  it.each([undefined, NaN, Infinity, -1, 1_501])('invalid or future source time %s falls back', (source) => {
    expect(inputSchedulingTick(snapshot, 60, source, 1_500)).toBe(100);
  });
  it.each([NaN, Infinity, -Infinity])('invalid current time %s falls back', (now) => {
    expect(inputSchedulingTick(snapshot, 60, 1_000, now)).toBe(100);
  });
  it.each([1_000n, '1000', null, {}])('malformed structured-clone source metadata %s fails closed', (source) => {
    expect(inputSchedulingTick(snapshot, 60, source as number, 1_500)).toBe(100);
    expect(inputSchedulingTick(snapshot, 60, 1_000, source as number)).toBe(100);
  });
  it('paused snapshots never extrapolate and long age stays bounded', () => {
    expect(inputSchedulingTick({ ...snapshot, paused: true }, 120, 1_000, 9_000)).toBe(100);
    expect(inputSchedulingTick(snapshot, 120, 1_000, 9_000)).toBe(340);
    expect(inputSchedulingTick({ ...snapshot, physicsTick: Number.MAX_SAFE_INTEGER }, 120, 1_000, 9_000)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
  it('停滞的Authority仍按原too-far-ahead门禁拒绝过度超前输入', () => {
    const buffer = new InputCommandBuffer('world:1', 'player-input');
    buffer.consumeForTick(100);
    const stream = new PlayerInputStream('world:1');
    const command = stream.sample({
      physicsTick: inputSchedulingTick(snapshot, 120, 1_000, 9_000),
      issuedAtMs: 9_000,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: true, back: false, left: false, right: false, jump: false, crouch: false },
    })!;
    expect(command.targetPhysicsTick).toBe(342);
    expect(buffer.push(command)).toBe('too-far-ahead');
    expect(buffer.requiresResync).toBe(true);
  });
});
