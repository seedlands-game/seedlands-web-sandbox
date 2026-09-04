import * as pc from 'playcanvas';
import { sanitizeAudioSettings } from '../../client/audio/audio-policy';
import type { AudioSettings } from '../../client/audio/audio-types';

/** 应用级唯一音频图；世界退出只释放源，不关闭菜单音频的 context。 */
export class AudioMixer {
  readonly manager = new pc.SoundManager();
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly music: GainNode;
  readonly sfx: GainNode;
  readonly ambience: GainNode;
  readonly output: DynamicsCompressorNode;
  readonly analyser: AnalyserNode;
  private settings = sanitizeAudioSettings(null);

  constructor() {
    const context = this.manager.context;
    if (!context) throw new Error('此浏览器不支持 Web Audio。');
    this.context = context;
    this.master = context.createGain();
    this.music = context.createGain();
    this.sfx = context.createGain();
    this.ambience = context.createGain();
    this.output = context.createDynamicsCompressor();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.output.threshold.value = -8;
    this.output.knee.value = 12;
    this.output.ratio.value = 4;
    this.output.attack.value = 0.006;
    this.output.release.value = 0.2;
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.ambience.connect(this.master);
    this.master.connect(this.output);
    this.output.connect(this.analyser);
    this.output.connect(context.destination);
    this.apply(this.settings);
  }

  async unlock() {
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context.state === 'running';
  }

  apply(settings: AudioSettings) {
    this.settings = sanitizeAudioSettings(settings);
    for (const key of ['master', 'music', 'sfx', 'ambience'] as const)
      this[key].gain.setTargetAtTime(this.settings[key], this.context.currentTime, 0.025);
  }

  snapshot() {
    const samples = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(samples);
    let energy = 0;
    let peak = 0;
    for (const sample of samples) {
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return {
      contextState: this.context.state,
      settings: { ...this.settings },
      rms: Math.sqrt(energy / samples.length),
      peak,
    };
  }
}
