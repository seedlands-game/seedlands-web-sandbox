import { describe, expect, it } from 'vitest';
import { InputCommandBuffer } from '@seedlands/stdlib/runtime/session-protocol';
import { PlayerInputStream } from '../../../src/client/player-input-stream';
import { inputSchedulingTick } from '../../../src/client/authority/input-scheduling-tick';

const snapshot = { physicsTick: 100, paused: false };
describe('Browser input scheduling age', () => {
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
