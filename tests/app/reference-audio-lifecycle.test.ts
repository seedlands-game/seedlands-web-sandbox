import { describe, expect, it, vi } from 'vitest';
const toneContexts = vi.hoisted(() => [] as unknown[]);
vi.mock('tone', () => ({
  Context: class {
    rawContext: unknown;
    constructor(options: { context: unknown }) {
      toneContexts.push(options);
      this.rawContext = options.context;
    }
  },
  setContext: vi.fn(),
  getContext: () => ({ rawContext: null }),
}));
const globalDecodes = vi.hoisted(() => [] as Array<(value: AudioBuffer) => void>);
vi.mock('../../apps/web/src/app/audio/audio-mixer', () => ({
  AudioMixer: class {
    context = { decodeAudioData: () => new Promise<AudioBuffer>((resolve) => globalDecodes.push(resolve)) };
    unlock = async () => true;
    apply = () => undefined;
    snapshot = () => ({});
  },
}));
import { GlobalAudio } from '../../apps/web/src/app/audio/global-audio';
import { MusicPlayer } from '../../apps/web/src/app/audio/music-player';
import type { AudioMixer } from '../../apps/web/src/app/audio/audio-mixer';

function fixture() {
  const pending: Array<(value: AudioBuffer) => void> = [];
  const decodeAudioData = vi.fn(() => new Promise<AudioBuffer>((resolve) => pending.push(resolve)));
  const player = new MusicPlayer({ context: { decodeAudioData } } as unknown as AudioMixer);
  const file = (name: string) => new File([new Uint8Array([1, 2])], name, { type: 'audio/wav' });
  return { player, pending, file, decodeAudioData };
}

describe('应用级参考曲异步隔离', () => {
  it('使用主线程timeout时钟而不额外创建Tone Worker', () => {
    toneContexts.length = 0;
    const context = { decodeAudioData: vi.fn() };
    new MusicPlayer({ context } as unknown as AudioMixer);
    expect(toneContexts).toEqual([{ context, clockSource: 'timeout' }]);
  });

  it('导入期间切世界只保留全局参考选择，不自动播放到新世界', async () => {
    globalDecodes.length = 0;
    const start = vi.spyOn(MusicPlayer.prototype, 'start').mockImplementation(() => undefined);
    const audio = new GlobalAudio();
    const importing = audio.importReference(new File([new Uint8Array([1])], 'across-world.wav'));
    await vi.waitFor(() => expect(globalDecodes).toHaveLength(1));
    audio.beginWorld();
    globalDecodes[0]({ duration: 10 } as AudioBuffer);
    await importing;
    expect(audio.snapshot().referenceName).toBe('across-world.wav');
    expect(start).not.toHaveBeenCalled();
    start.mockRestore();
  });
  it('最新选择优先，解码本身不能停止可能已切换世界的当前音乐', async () => {
    const f = fixture();
    const stop = vi.spyOn(f.player, 'stop');
    const first = f.player.importReference(f.file('first.wav'));
    const second = f.player.importReference(f.file('second.wav'));
    await vi.waitFor(() => expect(f.pending).toHaveLength(2));
    f.pending[1]({ duration: 10 } as AudioBuffer);
    const applied = await second;
    expect(stop).not.toHaveBeenCalled();
    expect(applied).toBe(true);
    f.pending[0]({ duration: 10 } as AudioBuffer);
    expect(await first).toBe(false);
    expect(f.player.referenceName).toBe('second.wav');
    expect(stop).not.toHaveBeenCalled();
  });
  it('移除引用后旧解码不得重新恢复曲子', async () => {
    const f = fixture();
    const result = f.player.importReference(f.file('removed.wav'));
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    f.player.removeReference();
    f.pending[0]({ duration: 10 } as AudioBuffer);
    expect(await result).toBe(false);
    expect(f.player.referenceName).toBe('');
  });
});
