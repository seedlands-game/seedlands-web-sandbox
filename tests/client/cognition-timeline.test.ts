import { describe, expect, it } from 'vitest';
import { CognitionTimeline } from '../../apps/web/src/client/persistence/cognition-timeline';

describe('cognition timeline recovery boundary', () => {
  it('persists an unfinished memory restore across UI recreation and keeps worlds isolated', () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    const before = new CognitionTimeline(storage);
    before.select('old-world', 'future-memory');
    before.beginRestore('old-world');
    const fork = before.fork('old-world');
    expect(fork).not.toBe('future-memory');
    const afterReload = new CognitionTimeline(storage);
    expect(afterReload.requiresRestore('old-world')).toBe(true);
    expect(afterReload.current('old-world')).toBe(fork);
    expect(afterReload.requiresRestore('other-world')).toBe(false);
    expect(afterReload.hasMemory('other-world')).toBe(false);
    afterReload.finishRestore('old-world');
    expect(new CognitionTimeline(storage).requiresRestore('old-world')).toBe(false);
    expect(afterReload.current('old-world')).toBe(fork);
  });
});
