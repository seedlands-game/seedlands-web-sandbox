import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_SETTINGS,
  FootstepTracker,
  MusicCueScheduler,
  sanitizeAudioSettings,
  SoundBudget,
} from '../../../src/client/audio/audio-policy';

const plains = { biome: 'plains', worldTime: 10, waterProximity: 0, danger: 0 };

describe('世界音频策略', () => {
  it('钳制音量并从损坏设置恢复，不将缺失值当作静音', () => {
    expect(sanitizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeAudioSettings({ master: -3, music: 2, sfx: 'bad', ambience: Number.NaN })).toEqual({
      master: 0,
      music: 1,
      sfx: DEFAULT_AUDIO_SETTINGS.sfx,
      ambience: DEFAULT_AUDIO_SETTINGS.ambience,
    });
  });

  it('去重短时间同目标声音，满载优先保留高优先级，释放后可复用预算', () => {
    const budget = new SoundBudget(2);
    budget.beginSession('a');
    const first = budget.acquire({ sessionId: 'a', key: 'step', priority: 0 }, 0)!;
    expect(first).not.toBeNull();
    expect(budget.acquire({ sessionId: 'a', key: 'step', priority: 0 }, 0.04)).toBeNull();
    const second = budget.acquire({ sessionId: 'a', key: 'water', priority: 0 }, 0.05)!;
    const damage = budget.acquire({ sessionId: 'a', key: 'damage', priority: 3 }, 0.06)!;
    expect(damage.evictedId).toBe(first.id);
    expect(budget.activeCount).toBe(2);
    expect(budget.acquire({ sessionId: 'a', key: 'leaf', priority: 0 }, 0.07)).toBeNull();
    budget.release(second.id);
    expect(budget.acquire({ sessionId: 'a', key: 'leaf', priority: 0 }, 0.2)).not.toBeNull();
    expect(budget.activeCount).toBe(2);
  });

  it('世界切换清理预算并拒绝旧会话迟到事件', () => {
    const budget = new SoundBudget();
    budget.beginSession('old');
    const old = budget.acquire({ sessionId: 'old', key: 'hit', priority: 1 }, 0)!;
    budget.beginSession('new');
    expect(budget.activeCount).toBe(0);
    expect(budget.acquire({ sessionId: 'old', key: 'damage', priority: 3 }, 1)).toBeNull();
    const current = budget.acquire({ sessionId: 'new', key: 'hit', priority: 1 }, 1)!;
    budget.release(old.id);
    expect(current.id).not.toBe(old.id);
    expect(budget.activeCount).toBe(1);
  });

  it('同一地面行走距离在不同采样频率有相同步数，空中与瞬移无脚步', () => {
    const walk = (samples: number) => {
      const tracker = new FootstepTracker();
      let steps = 0;
      for (let i = 0; i <= samples; i++) steps += tracker.sample([0, 2, (i * 10) / samples], true);
      return steps;
    };
    expect(walk(100)).toBe(walk(600));
    expect(walk(100)).toBeGreaterThan(3);
    const tracker = new FootstepTracker();
    tracker.sample([0, 2, 0], true);
    expect(tracker.sample([0, 3, 2], false)).toBe(0);
    expect(tracker.sample([0, 2, 50], true)).toBe(0);
    expect(tracker.sample([0, 2, 50], true)).toBe(0);
  });

  it('首次延后播放，曲间有留白，长时间跳跃不会补播积压曲目', () => {
    const scheduler = new MusicCueScheduler(42);
    expect(scheduler.update(plains, 0)).toEqual([]);
    expect(scheduler.update(plains, 7)).toEqual([]);
    const started = scheduler.update(plains, 8);
    expect(started).toMatchObject([{ type: 'start', preset: 'meadow' }]);
    expect(scheduler.update(plains, 90)).toEqual([]);
    const ended = scheduler.update(plains, 130);
    expect(ended).toMatchObject([{ type: 'stop' }]);
    expect(scheduler.update(plains, 160)).toEqual([]);
    expect(scheduler.update(plains, 600).filter((event) => event.type === 'start')).toHaveLength(1);
  });

  it('环境持续变化才切音乐，暂停不积压，恢复重新等待', () => {
    const scheduler = new MusicCueScheduler(42);
    scheduler.update(plains, 0);
    scheduler.update(plains, 8);
    const night = { ...plains, worldTime: 23 };
    expect(scheduler.update(night, 10)).toEqual([]);
    expect(scheduler.update(plains, 12)).toEqual([]);
    expect(scheduler.update(night, 20)).toEqual([]);
    expect(scheduler.update(night, 28)).toMatchObject([{ type: 'stop' }, { type: 'start', preset: 'night' }]);
    expect(scheduler.update(night, 29, true)).toMatchObject([{ type: 'stop' }]);
    expect(scheduler.update(night, 300, true)).toEqual([]);
    expect(scheduler.update(night, 301)).toEqual([]);
    expect(scheduler.update(night, 309)).toMatchObject([{ type: 'start', preset: 'night' }]);
  });
});
