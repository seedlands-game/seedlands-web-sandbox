import { describe, expect, it, vi } from 'vitest';
import { WorldMediaAudioAdapter } from '../../../src/app/audio/world-media-audio-adapter';
import type { AudioMixer } from '../../../src/app/audio/audio-mixer';

function fixture(state: AudioContextState = 'suspended') {
  let contextState = state;
  const listeners = new Map<string, EventListener>();
  const source = {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    }),
  };
  const decoded = { duration: 12 } as AudioBuffer;
  const context = {
    get state() {
      return contextState;
    },
    resume: vi.fn(async () => {
      contextState = 'running';
    }),
    decodeAudioData: vi.fn(async () => decoded),
    createBufferSource: vi.fn(() => source),
  };
  const mixer = { context, music: { bus: 'music' } } as unknown as AudioMixer;
  return {
    adapter: new WorldMediaAudioAdapter(mixer),
    context,
    decoded,
    source,
    end: () => listeners.get('ended')?.(new Event('ended')),
  };
}

describe('WorldMediaAudioAdapter', () => {
  it('uses the shared mixer context and music bus for decoded sources', async () => {
    const world = fixture('running');
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    await expect(world.adapter.decode(bytes)).resolves.toBe(world.decoded);
    expect(world.context.decodeAudioData).toHaveBeenCalledWith(bytes);
    expect(world.adapter.output).toEqual({ bus: 'music' });

    const playable = world.adapter.createSource(world.decoded);
    const ended = vi.fn();
    const remove = playable.onEnded(ended);
    playable.connect(world.adapter.output);
    playable.start();
    world.end();

    expect(world.source.buffer).toBe(world.decoded);
    expect(world.source.connect).toHaveBeenCalledWith(world.adapter.output);
    expect(world.source.start).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledOnce();
    remove();
    expect(world.source.removeEventListener).toHaveBeenCalledOnce();
    playable.stop();
    playable.disconnect();
    expect(world.source.stop).toHaveBeenCalledOnce();
    expect(world.source.disconnect).toHaveBeenCalledOnce();
  });

  it('only reports playback allowed after a successful shared-context resume', async () => {
    const world = fixture();
    expect(world.adapter.playbackAllowed()).toBe(false);

    await expect(world.adapter.resume()).resolves.toBe(true);

    expect(world.context.resume).toHaveBeenCalledOnce();
    expect(world.adapter.playbackAllowed()).toBe(true);
  });
});
