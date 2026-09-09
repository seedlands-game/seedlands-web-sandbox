import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitionScheduler } from '../../apps/agent-server/src/scheduler';

describe('CognitionScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces events and resets fallback only after a confirmed dispatch', async () => {
    const dispatch = vi.fn(() => ({ dispatched: true, completion: Promise.resolve() }));
    const scheduler = new CognitionScheduler({ fallbackSeconds: 180, debounceMs: 250, dispatch });
    await vi.advanceTimersByTimeAsync(10_000);
    scheduler.notifyEvent('dialogue');
    scheduler.notifyEvent('attacked');
    await vi.advanceTimersByTimeAsync(249);
    expect(dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledWith({ kind: 'event', reasons: ['dialogue', 'attacked'] });
    await vi.advanceTimersByTimeAsync(179_999);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenLastCalledWith({ kind: 'fallback', reasons: [] });
    scheduler.dispose();
  });

  it('does not accumulate missed fallback calls while paused', async () => {
    const dispatch = vi.fn(() => ({ dispatched: true, completion: Promise.resolve() }));
    const scheduler = new CognitionScheduler({ fallbackSeconds: 60, dispatch });
    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.pause();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(dispatch).not.toHaveBeenCalled();
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('does not treat a skipped event callback as a model dispatch', async () => {
    const dispatch = vi.fn(() => ({ dispatched: false, completion: Promise.resolve() }));
    const scheduler = new CognitionScheduler({ fallbackSeconds: 60, debounceMs: 1, dispatch });
    await vi.advanceTimersByTimeAsync(10_000);
    scheduler.notifyEvent('observation');
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(49_998);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});
