import { describe, expect, it } from 'vitest';
import { AuthorityReceiveWallObserver } from '../../../src/client/authority/authority-receive-wall-observer';

describe('AuthorityReceiveWallObserver', () => {
  it('records synchronous wall time, preserves return values, and counts only the outer reentrant call', () => {
    let now = 10;
    const epoch: string | null = 'epoch-a';
    const observer = new AuthorityReceiveWallObserver(
      () => now,
      () => epoch,
    );

    const result = observer.measure(() => {
      now = 12;
      expect(
        observer.measure(() => {
          now = 15;
          return 'nested';
        }),
      ).toBe('nested');
      now = 18;
      return 42;
    });

    expect(result).toBe(42);
    expect(observer.snapshot()).toMatchObject({ runtimeEpoch: 'epoch-a', count: 1, totalWallMs: 8 });
  });

  it('resets by runtime epoch and returns null while no epoch is active', () => {
    let now = 0;
    let epoch: string | null = 'epoch-a';
    const observer = new AuthorityReceiveWallObserver(
      () => now,
      () => epoch,
    );
    observer.measure(() => {
      now = 4;
    });
    const first = observer.snapshot();
    expect(first).toMatchObject({ runtimeEpoch: 'epoch-a', count: 1, totalWallMs: 4 });

    epoch = 'epoch-b';
    expect(observer.snapshot()).toMatchObject({ runtimeEpoch: 'epoch-b', count: 0, totalWallMs: 0 });
    expect(observer.snapshot()!.generation).toBeGreaterThan(first!.generation);
    observer.measure(() => {
      now = 7;
    });
    expect(observer.snapshot()).toMatchObject({ runtimeEpoch: 'epoch-b', count: 1, totalWallMs: 3 });

    epoch = null;
    expect(observer.snapshot()).toBeNull();
    let ran = false;
    expect(
      observer.measure(() => {
        ran = true;
        return 'still runs';
      }),
    ).toBe('still runs');
    expect(ran).toBe(true);
    expect(observer.snapshot()).toBeNull();
  });

  it('records elapsed time even when the measured callback throws, then rethrows the same error', () => {
    let now = 1;
    const error = new Error('consumer failed');
    const observer = new AuthorityReceiveWallObserver(
      () => now,
      () => 'epoch-a',
    );

    expect(() =>
      observer.measure(() => {
        now = 6;
        throw error;
      }),
    ).toThrow(error);
    expect(observer.snapshot()).toMatchObject({ runtimeEpoch: 'epoch-a', count: 1, totalWallMs: 5 });
  });

  it('breaks the generation on invalid or backward clocks while still running the callback', () => {
    let now = 10;
    let epoch: string | null = 'epoch-a';
    let clockThrows = false;
    const clockError = new Error('clock unavailable');
    const observer = new AuthorityReceiveWallObserver(
      () => {
        if (clockThrows) throw clockError;
        return now;
      },
      () => epoch,
    );
    observer.measure(() => {
      now = 12;
    });
    const before = observer.snapshot()!;

    now = 11;
    let ran = false;
    observer.measure(() => {
      ran = true;
      now = 13;
    });
    expect(ran).toBe(true);
    expect(observer.snapshot()!.generation).toBeGreaterThan(before.generation);
    expect(observer.snapshot()).toMatchObject({ runtimeEpoch: 'epoch-a', count: 0, totalWallMs: 0 });

    epoch = 'epoch-b';
    now = Number.NaN;
    observer.measure(() => {
      ran = false;
    });
    expect(ran).toBe(false);
    expect(observer.snapshot()).toMatchObject({ runtimeEpoch: 'epoch-b', count: 0, totalWallMs: 0 });

    const beforeClockError = observer.snapshot()!;
    clockThrows = true;
    ran = false;
    observer.measure(() => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(observer.snapshot()!.generation).toBeGreaterThan(beforeClockError.generation);
    expect(observer.snapshot()).toMatchObject({ runtimeEpoch: 'epoch-b', count: 0, totalWallMs: 0 });
  });
});
