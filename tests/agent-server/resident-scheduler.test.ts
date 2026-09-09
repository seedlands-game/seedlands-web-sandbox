import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResidentScheduler } from '../../apps/agent-server/src/resident-scheduler';

describe('resident active-clock scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces episodes, refreshes at logical round admission, and never replays the old deadline', async () => {
    const dispatch = vi.fn(() => ({ accepted: true, completion: Promise.resolve() }));
    const scheduler = new ResidentScheduler({ dispatch });
    await vi.advanceTimersByTimeAsync(10000);
    scheduler.notify({ source: 'conversation', episode: 1, reason: 'heard a question' });
    scheduler.notify({ source: 'conversation', episode: 1, reason: 'duplicate page' });
    scheduler.notify({ source: 'food', episode: 2, reason: 'food depleted' });
    await vi.advanceTimersByTimeAsync(250);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]).toEqual([{ kind: 'event', reasons: ['heard a question', 'food depleted'] }]);
    await vi.advanceTimersByTimeAsync(169750);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10250);
    expect(dispatch).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('retains one merged pending wake while a round runs; duplicate episodes remain consumed after restore', async () => {
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const dispatch = vi
      .fn()
      .mockReturnValueOnce({ accepted: true, completion })
      .mockReturnValue({ accepted: true, completion: Promise.resolve() });
    const scheduler = new ResidentScheduler({ fallbackSeconds: 60, dispatch });
    scheduler.notify({ source: 'dialogue', episode: 1, reason: 'first' });
    await vi.advanceTimersByTimeAsync(250);
    for (let episode = 2; episode < 20; episode++)
      scheduler.notify({ source: 'dialogue', episode, reason: 'new dialogue' });
    await vi.advanceTimersByTimeAsync(120000);
    expect(dispatch).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(250);
    expect(dispatch).toHaveBeenCalledTimes(2);
    const saved = scheduler.snapshot();
    scheduler.dispose();
    const restored = new ResidentScheduler({ dispatch, restored: saved });
    restored.notify({ source: 'dialogue', episode: 19, reason: 'retransmitted page' });
    await vi.advanceTimersByTimeAsync(250);
    expect(dispatch).toHaveBeenCalledTimes(2);
    restored.dispose();
  });

  it('does not reset the logical deadline for compaction or a rejected admission; blocked time still passes', async () => {
    const dispatch = vi
      .fn()
      .mockReturnValueOnce({ accepted: false, completion: Promise.resolve() })
      .mockReturnValue({ accepted: true, completion: Promise.resolve() });
    const scheduler = new ResidentScheduler({ fallbackSeconds: 60, dispatch });
    await vi.advanceTimersByTimeAsync(60000);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(scheduler.snapshot().remainingMs).toBe(0);
    await vi.advanceTimersByTimeAsync(300000);
    expect(dispatch).toHaveBeenCalledTimes(1);
    scheduler.unblock();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(scheduler.snapshot().remainingMs).toBeGreaterThan(59000);
    scheduler.block();
    await vi.advanceTimersByTimeAsync(20000);
    scheduler.unblock();
    expect(scheduler.snapshot().remainingMs).toBeLessThanOrEqual(40000);
    scheduler.dispose();
  });

  it('preserves remaining active time through pause, export and restore', async () => {
    const dispatch = vi.fn(() => ({ accepted: true, completion: Promise.resolve() }));
    const scheduler = new ResidentScheduler({ fallbackSeconds: 60, dispatch });
    await vi.advanceTimersByTimeAsync(20000);
    scheduler.pause();
    const saved = scheduler.snapshot();
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(999000);
    const restored = new ResidentScheduler({ restored: saved, dispatch });
    await vi.advanceTimersByTimeAsync(999000);
    expect(dispatch).not.toHaveBeenCalled();
    restored.resume();
    await vi.advanceTimersByTimeAsync(39999);
    expect(dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    restored.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps an interrupted snapshot blocked until its owner explicitly finishes recovery', async () => {
    const dispatch = vi.fn(() => ({ accepted: true, completion: Promise.resolve() }));
    const restored = new ResidentScheduler({
      dispatch,
      restored: {
        version: 1,
        fallbackSeconds: 60,
        remainingMs: 0,
        paused: false,
        blocked: false,
        inFlight: true,
        pendingReasons: ['interrupted dialogue'],
        episodes: [['dialogue', 4]],
      },
    });
    expect(restored.needsRecovery()).toBe(true);
    expect(restored.snapshot()).toMatchObject({ blocked: true, inFlight: true });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(dispatch).not.toHaveBeenCalled();
    restored.finishRecovery();
    expect(restored.snapshot()).toMatchObject({ blocked: false, inFlight: false });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(dispatch).not.toHaveBeenCalled();
    restored.activateRecovered();
    await vi.advanceTimersByTimeAsync(250);
    expect(dispatch).toHaveBeenCalledTimes(1);
    restored.dispose();
  });
});
