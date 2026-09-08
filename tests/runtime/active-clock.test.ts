import { describe, expect, it } from 'vitest';
import {
  ActiveMonotonicClock,
  createClockHandshake,
  toSessionTime,
} from '../../packages/game-core/src/runtime/active-monotonic-clock';

describe('ActiveMonotonicClock', () => {
  it('暂停期间冻结活跃时间且恢复后不补算睡眠区间', () => {
    const clock = new ActiveMonotonicClock(1_000);

    expect(clock.sample(1_120).activeTimeMs).toBe(120);
    clock.pause(1_150);
    expect(clock.sample(6_000)).toMatchObject({ activeTimeMs: 150, paused: true });
    clock.resume(8_000);

    expect(clock.sample(8_025)).toMatchObject({ activeTimeMs: 175, paused: false });
  });

  it('拒绝倒退的单调时间', () => {
    const clock = new ActiveMonotonicClock(10);
    clock.sample(20);

    expect(() => clock.sample(19)).toThrow(/monotonic/i);
  });

  it('通过握手换算执行环境时间而不假定 performance.now 原点相同', () => {
    const handshake = createClockHandshake({ sessionTimeMs: 12_000, localTimeMs: 350 });

    expect(toSessionTime(handshake, 410)).toBe(12_060);
  });
});
