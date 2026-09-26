import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toneState = vi.hoisted(() => ({
  contexts: [] as unknown[],
  current: null as { rawContext: unknown } | null,
  voices: [] as unknown[],
}));
const playbackState = vi.hoisted(() => ({ instances: [] as unknown[] }));
const mixerState = vi.hoisted(() => ({ instances: [] as unknown[], gains: [] as unknown[] }));

vi.mock('tone', () => {
  class Context {
    rawContext: unknown;
    constructor(options: { context: unknown }) {
      toneState.contexts.push(options);
      this.rawContext = options.context;
    }
  }
  class PolySynth {
    connect = vi.fn();
    triggerAttackRelease = vi.fn();
    dispose = vi.fn();
    constructor() {
      toneState.voices.push(this);
    }
  }
  return {
    Context,
    PolySynth,
    Synth: class {},
    FMSynth: class {},
    setContext: vi.fn((context: Context) => {
      toneState.current = context;
    }),
    getContext: () => toneState.current ?? { rawContext: null },
    now: () => 2,
    Frequency: () => ({ toFrequency: () => 440 }),
  };
});

vi.mock('playcanvas', () => {
  class Sound {
    constructor(readonly buffer: unknown) {}
  }
  class SoundInstance {
    gain = { disconnect: vi.fn() };
    setExternalNodes = vi.fn();
    once = vi.fn();
    play = vi.fn();
    off = vi.fn();
    stop = vi.fn();
    constructor() {
      playbackState.instances.push(this);
    }
  }
  class SoundInstance3d extends SoundInstance {
    panner = { disconnect: vi.fn() };
  }
  return {
    Sound,
    SoundInstance,
    SoundInstance3d,
    Vec3: class {
      constructor(
        readonly x: number,
        readonly y: number,
        readonly z: number,
      ) {}
    },
    DISTANCE_INVERSE: 'inverse',
  };
});

vi.mock('../../../src/app/audio/audio-mixer', () => ({
  AudioMixer: class {
    manager = {};
    context = {
      state: 'running',
      currentTime: 1,
      sampleRate: 48_000,
      createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
      createGain: vi.fn(() => {
        const gain = {
          gain: {
            value: 0,
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        mixerState.gains.push(gain);
        return gain;
      }),
    };
    master = {};
    music = {};
    sfx = {};
    uiSfx = {};
    ambience = {};
    output = {};
    underwaterFilter = { frequency: { value: 18_000 } };
    unlock = vi.fn(async () => true);
    apply = vi.fn();
    snapshot = vi.fn(() => ({ contextState: 'running' }));
    constructor() {
      mixerState.instances.push(this);
    }
  },
}));

import { GlobalAudio } from '../../../src/app/audio/global-audio';
import type { AudioMixer } from '../../../src/app/audio/audio-mixer';
import { MusicPlayer } from '../../../src/app/audio/music-player';
import type { MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';

function musicFixture() {
  const gain = {
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const music = {};
  const context = { currentTime: 1, createGain: vi.fn(() => gain) };
  const player = new MusicPlayer({ context, music } as unknown as AudioMixer);
  return { context, gain, music, player };
}

describe('本地参考曲上传退场', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toneState.contexts.length = 0;
    toneState.current = null;
    toneState.voices.length = 0;
    playbackState.instances.length = 0;
    mixerState.instances.length = 0;
    mixerState.gains.length = 0;
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
    vi.stubGlobal('document', { hidden: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('不再暴露File上传或移除API和参考曲名称字段', () => {
    const player = musicFixture().player;
    const audio = new GlobalAudio();

    expect('importReference' in player).toBe(false);
    expect('removeReference' in player).toBe(false);
    expect('importReference' in audio).toBe(false);
    expect('removeReference' in audio).toBe(false);
    expect(audio.snapshot()).not.toHaveProperty('referenceName');
    expect(audio.snapshot().cue).toBe('');
  });

  it('继续在应用AudioContext和music bus上播放并观测内置合成cue', async () => {
    const audio = new GlobalAudio();
    await expect(audio.unlock()).resolves.toBe(true);
    const mixer = mixerState.instances[0] as { context: unknown; music: unknown };

    expect(toneState.contexts).toEqual([{ context: mixer.context, clockSource: 'timeout' }]);
    expect(audio.snapshot().sharedContext).toBe(true);

    audio.beginWorld();
    audio.music?.start('meadow', 42);
    expect(audio.snapshot().cue).toBe('meadow-42');
    const gain = mixerState.gains[0] as { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
    expect(gain.connect).toHaveBeenCalledWith(mixer.music);
    expect(toneState.voices).toHaveLength(3);
    expect(
      toneState.voices.some(
        (voice) =>
          (voice as { triggerAttackRelease: ReturnType<typeof vi.fn> }).triggerAttackRelease.mock.calls.length > 0,
      ),
    ).toBe(true);

    audio.endWorld();
    expect(audio.snapshot().cue).toBe('');
    expect(gain.disconnect).toHaveBeenCalledOnce();
    for (const voice of toneState.voices)
      expect((voice as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalledOnce();
  });

  it('保留四路音量、普通SFX与世界结束清理', async () => {
    const audio = new GlobalAudio();
    await expect(audio.unlock()).resolves.toBe(true);
    expect(audio.snapshot().sharedContext).toBe(true);
    const mixer = mixerState.instances[0] as {
      apply: ReturnType<typeof vi.fn>;
      sfx: unknown;
      output: unknown;
    };
    mixer.apply.mockClear();

    audio.setVolume('master', 0.8);
    audio.setVolume('music', 0.6);
    audio.setVolume('sfx', 0.4);
    audio.setVolume('ambience', 0.2);
    expect(mixer.apply.mock.calls).toEqual([
      [{ master: 0.8, music: 0.28, sfx: 0.7, ambience: 0.32 }],
      [{ master: 0.8, music: 0.6, sfx: 0.7, ambience: 0.32 }],
      [{ master: 0.8, music: 0.6, sfx: 0.4, ambience: 0.32 }],
      [{ master: 0.8, music: 0.6, sfx: 0.4, ambience: 0.2 }],
    ]);
    expect(audio.snapshot().settings).toEqual({ master: 0.8, music: 0.6, sfx: 0.4, ambience: 0.2 });
    expect(localStorage.setItem).toHaveBeenCalledTimes(4);

    const session = audio.beginWorld();
    expect(audio.play('pickup', { session })).toBe(true);
    expect(audio.snapshot()).toMatchObject({ session: 'world-1', voices: 1, cachedSounds: 1, playedCount: 1 });
    const instance = playbackState.instances[0] as {
      setExternalNodes: ReturnType<typeof vi.fn>;
      off: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    };
    expect(instance.setExternalNodes).toHaveBeenCalledWith(mixer.sfx, mixer.output);

    audio.endWorld();
    expect(audio.snapshot()).toMatchObject({ session: 'menu', voices: 0, cachedSounds: 1, playedCount: 1 });
    expect(instance.off).toHaveBeenCalledOnce();
    expect(instance.stop).toHaveBeenCalledOnce();
  });

  it('通过共享music bus暴露并清理world media状态', async () => {
    const audio = new GlobalAudio();
    await audio.unlock();
    const resources = { validate: vi.fn(), resolve: vi.fn(), abort: vi.fn() };

    audio.beginMediaWorld('runtime:1', resources, vi.fn());
    expect(audio.snapshot().worldMedia).toMatchObject({ epoch: 'runtime:1', instances: [] });

    audio.setWorldMediaPaused(true);
    audio.resumeMediaFromGesture();
    audio.endWorld();

    expect(resources.abort).toHaveBeenCalledOnce();
    expect(audio.snapshot().worldMedia).toBeNull();
  });

  it('在共享mixer创建前保留world media投影和事实', async () => {
    const audio = new GlobalAudio();
    const resources = { validate: vi.fn(), resolve: vi.fn(), abort: vi.fn() };
    const device = { kind: 'voxel' as const, position: [1, 2, 3] as const, definitionId: 'sample:jukebox' };
    const slot = { itemId: 'sample:disc', trackId: 'sample:track' };
    const resource = { packId: 'sample:pack', path: 'assets/audio/track.mp3' };
    const projection: MediaPlaybackProjectionV1 = {
      version: 1,
      device,
      revision: 2,
      slot,
      resource,
      playing: false,
      resumePending: false,
    };
    const historicalStart: MediaPlaybackFactV1 = {
      version: 1,
      kind: 'insert-and-activate',
      device,
      revision: 1,
      previousTrackId: null,
      trackId: slot.trackId,
      resource,
      playing: true,
      resumePending: false,
      insertedItemId: slot.itemId,
    };

    audio.beginMediaWorld('runtime:1', resources, vi.fn());
    audio.installMediaProjections([projection]);
    audio.consumeMediaFacts([historicalStart]);
    expect(audio.snapshot().worldMedia).toBeNull();

    await expect(audio.unlock()).resolves.toBe(true);
    await vi.waitFor(() => expect(audio.snapshot().worldMedia?.instances).toEqual([]));
    expect(resources.validate).toHaveBeenCalledOnce();
    expect(resources.resolve).not.toHaveBeenCalled();
  });
});
