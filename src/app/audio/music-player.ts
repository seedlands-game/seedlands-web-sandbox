import * as Tone from 'tone';
import { composeMusicCue } from '../../client/audio/audio-composition';
import type { MusicPreset } from '../../client/audio/audio-types';
import type { AudioMixer } from './audio-mixer';

export class MusicPlayer {
  private voices: Tone.PolySynth[] = [];
  private gain: GainNode | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private retired: (() => void) | null = null;
  private reference: AudioBuffer | null = null;
  private referenceSource: AudioBufferSourceNode | null = null;
  private importSequence = 0;
  referenceName = '';
  cue = '';

  constructor(private readonly mixer: AudioMixer) {
    Tone.setContext(mixer.context, true);
  }

  get sharedContext() {
    return Tone.getContext().rawContext === this.mixer.context;
  }

  start(preset: MusicPreset, seed: number) {
    this.stop();
    const context = this.mixer.context;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + 1.8);
    gain.connect(this.mixer.music);
    this.gain = gain;
    if (this.reference) {
      const source = context.createBufferSource();
      source.buffer = this.reference;
      source.connect(gain);
      source.start();
      this.referenceSource = source;
      this.cue = `本地参考曲 · ${this.referenceName}`;
      return;
    }
    const pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 2.5, decay: 1, sustain: 0.45, release: 3.5 },
      volume: -10,
    });
    const bell = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2,
      modulationIndex: 1.4,
      envelope: { attack: 0.015, decay: 1.3, sustain: 0.08, release: 2.5 },
      modulationEnvelope: { attack: 0.01, decay: 0.6, sustain: 0.02, release: 1 },
      volume: -13,
    });
    const pluck = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.03, decay: 0.7, sustain: 0.03, release: 1.2 },
      volume: -18,
    });
    this.voices = [pad, bell, pluck];
    for (const voice of this.voices) voice.connect(gain);
    const cue = composeMusicCue(preset, seed);
    const instruments = { pad, bell, pluck };
    const start = Tone.now() + 0.1;
    for (const note of cue.notes)
      instruments[note.voice].triggerAttackRelease(
        Tone.Frequency(note.midi, 'midi').toFrequency(),
        note.duration,
        start + note.at,
        note.velocity,
      );
    this.cue = cue.id;
  }

  stop(immediate = false) {
    const gain = this.gain;
    const voices = this.voices;
    const reference = this.referenceSource;
    this.gain = null;
    this.voices = [];
    this.referenceSource = null;
    this.cue = '';
    this.finishRetired();
    if (!gain) return;
    const cleanup = () => {
      for (const voice of voices) voice.dispose();
      reference?.stop();
      reference?.disconnect();
      gain.disconnect();
    };
    if (immediate) return cleanup();
    const now = this.mixer.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.45);
    this.retired = cleanup;
    this.releaseTimer = setTimeout(() => this.finishRetired(), 500);
  }

  async importReference(file: File) {
    if (file.size > 30 * 1024 * 1024) throw new Error('参考曲请小于 30 MiB。');
    const sequence = ++this.importSequence;
    const bytes = await file.arrayBuffer();
    let buffer: AudioBuffer;
    try {
      buffer = await this.mixer.context.decodeAudioData(bytes);
    } catch {
      throw new Error('无法读取这首曲子，请选择可播放的音频文件。');
    }
    if (buffer.duration > 600) throw new Error('参考曲最长为 10 分钟。');
    if (sequence !== this.importSequence) return false;
    this.reference = buffer;
    this.referenceName = file.name;
    return true;
  }

  removeReference() {
    ++this.importSequence;
    this.reference = null;
    this.referenceName = '';
    this.stop();
  }

  private finishRetired() {
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    this.retired?.();
    this.retired = null;
  }
}
