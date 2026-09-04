import { describe, expect, it } from 'vitest';
import { createUiBridge } from '../../src/app/ui/ui-bridge';

type Timer = { callback: () => void; delay: number };

const createFixture = () => {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, Timer>();
  const bridge = createUiBridge({
    now: () => now,
    setTimer: (callback, delay) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    debugIntervalMs: 250,
  });
  return {
    bridge,
    setNow: (value: number) => {
      now = value;
    },
    timers,
    fireTimer: (id: number) => {
      const timer = timers.get(id);
      timers.delete(id);
      timer?.callback();
    },
  };
};

describe('UiBridge retained presentation channels', () => {
  it('publishes shell, HUD, interaction and debug independently and skips equal values', () => {
    const { bridge } = createFixture();
    const counts = { shell: 0, hud: 0, interaction: 0, debug: 0 };
    const initial = {
      shell: bridge.shell.get(),
      hud: bridge.hud.get(),
      interaction: bridge.interaction.get(),
      debug: bridge.debug.get(),
    };
    const unsubscribers = [
      bridge.shell.subscribe(() => counts.shell++),
      bridge.hud.subscribe(() => counts.hud++),
      bridge.interaction.subscribe(() => counts.interaction++),
      bridge.debug.subscribe(() => counts.debug++),
    ];
    counts.shell = counts.hud = counts.interaction = counts.debug = 0;

    expect(bridge.publishShell({ phase: 'menu', seed: 'retained-ui' })).toBe(true);
    expect(bridge.publishShell({ phase: 'menu', seed: 'retained-ui' })).toBe(false);
    expect(counts).toEqual({ shell: 1, hud: 0, interaction: 0, debug: 0 });
    expect(bridge.hud.get()).toBe(initial.hud);
    expect(bridge.interaction.get()).toBe(initial.interaction);
    expect(bridge.debug.get()).toBe(initial.debug);
    expect(bridge.shell.get()).not.toBe(initial.shell);

    unsubscribers.forEach((unsubscribe) => unsubscribe());
  });

  it('gates lazy debug projection to four hertz and preserves stable HUD identity', () => {
    const { bridge, setNow } = createFixture();
    const session = bridge.beginWorldSession('world-a');
    const hudIdentity = bridge.hud.get();
    let projections = 0;
    let publishes = 0;
    const unsubscribe = bridge.debug.subscribe(() => publishes++);
    publishes = 0;

    for (let frame = 0; frame < 60; frame += 1) {
      setNow(frame * (1000 / 60));
      session.sampleDebug(frame + 1, () => {
        projections += 1;
        return { fps: 60 - frame / 100, position: [frame, 34, 0] };
      });
    }

    expect(projections).toBeLessThanOrEqual(4);
    expect(publishes).toBeLessThanOrEqual(4);
    expect(bridge.hud.get()).toBe(hudIdentity);
    expect(bridge.metrics()).toMatchObject({ debugProjectionCount: projections, debugPublishCount: publishes });
    unsubscribe();
  });

  it('publishes target state only when identity changes', () => {
    const { bridge } = createFixture();
    const session = bridge.beginWorldSession('world-a');
    let publishes = 0;
    const unsubscribe = bridge.interaction.subscribe(() => publishes++);
    publishes = 0;

    expect(session.publishTarget(1, { kind: 'voxel', id: '1,2,3', label: '石头' })).toBe(true);
    expect(session.publishTarget(2, { kind: 'voxel', id: '1,2,3', label: '石头' })).toBe(false);
    expect(session.publishTarget(3, { kind: 'entity', id: 'entity-1', label: '掉落物' })).toBe(true);
    expect(session.publishTarget(4, null)).toBe(true);
    expect(publishes).toBe(3);
    unsubscribe();
  });

  it('rejects stale sessions and non-increasing per-channel sequences', () => {
    const { bridge } = createFixture();
    const worldA = bridge.beginWorldSession('world-a');
    expect(worldA.publishHud(1, { worldClock: 'Day · 08:00' })).toBe(true);
    expect(worldA.publishHud(1, { worldClock: 'Day · 08:01' })).toBe(false);
    expect(worldA.publishHud(0, { worldClock: 'Day · 08:02' })).toBe(false);

    const worldB = bridge.beginWorldSession('world-b');
    const before = bridge.hud.get();
    expect(worldA.publishHud(2, { worldClock: 'Day · 23:59' })).toBe(false);
    expect(bridge.hud.get()).toBe(before);
    expect(worldB.publishHud(1, { worldClock: 'Night · 20:00' })).toBe(true);
    expect(bridge.metrics().staleUpdateCount).toBe(3);
  });

  it('replaces feedback timers safely and disposes world-scoped work', () => {
    const { bridge, timers, fireTimer } = createFixture();
    const session = bridge.beginWorldSession('world-a');
    session.publishFeedback(1, { message: '第一条', tone: 'info', durationMs: 900 });
    const firstTimer = [...timers.keys()][0];
    session.publishFeedback(2, { message: '第二条', tone: 'success', durationMs: 900 });
    const secondTimer = [...timers.keys()][0];
    expect(firstTimer).not.toBe(secondTimer);
    expect(timers.has(firstTimer)).toBe(false);
    expect(bridge.interaction.get().feedback?.message).toBe('第二条');

    fireTimer(firstTimer);
    expect(bridge.interaction.get().feedback?.message).toBe('第二条');
    session.dispose();
    expect(timers.has(secondTimer)).toBe(false);
    fireTimer(secondTimer);
    expect(bridge.interaction.get().feedback).toBeNull();
    expect(session.publishTarget(3, { kind: 'voxel', id: '0,0,0', label: '泥土' })).toBe(false);
  });
});
