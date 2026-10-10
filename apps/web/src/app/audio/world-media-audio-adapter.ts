import type { AudioMixer } from './audio-mixer';
import type { WorldMediaAudioPort, WorldMediaSourcePort } from './world-media-player';

/** Browser audio implementation for committed world media, sharing the application music bus. */
export class WorldMediaAudioAdapter implements WorldMediaAudioPort<AudioBuffer> {
  constructor(private readonly mixer: AudioMixer) {}

  get output(): AudioNode {
    return this.mixer.music;
  }

  playbackAllowed(): boolean {
    return this.mixer.context.state === 'running';
  }

  async resume(): Promise<boolean> {
    if (this.mixer.context.state === 'suspended') await this.mixer.context.resume();
    return this.playbackAllowed();
  }

  decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    return this.mixer.context.decodeAudioData(bytes);
  }

  createSource(decoded: AudioBuffer): WorldMediaSourcePort {
    const source = this.mixer.context.createBufferSource();
    source.buffer = decoded;
    return Object.freeze({
      connect: (output) => source.connect(output as AudioNode),
      start: () => source.start(),
      stop: () => source.stop(),
      disconnect: () => source.disconnect(),
      onEnded(listener) {
        source.addEventListener('ended', listener);
        return () => source.removeEventListener('ended', listener);
      },
    });
  }
}
