import * as pc from 'playcanvas';
import { synthesizeSfx } from '../../client/audio/audio-composition';
import { DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings, SoundBudget } from '../../client/audio/audio-policy';
import type { AudioSettings, SfxKey } from '../../client/audio/audio-types';
import { AudioMixer } from './audio-mixer';
import { MusicPlayer } from './music-player';

const STORAGE_KEY = 'seedlands.audio.v1';

export class GlobalAudio {
  private mixer: AudioMixer | null = null;
  private player: MusicPlayer | null = null;
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private readonly sounds = new Map<SfxKey, pc.Sound>();
  private readonly voices = new Map<number, pc.SoundInstance>();
  private readonly budget = new SoundBudget(16);
  private worldSession = 'menu';
  private sequence = 0;
  private unlocked = false;
  private readonly recentSounds: { key: SfxKey; sequence: number }[] = [];
  private playedCount = 0;
  private error = '';
  private readonly subscribers = new Set<() => void>();

  constructor() {
    try {
      this.settings = sanitizeAudioSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    } catch {
      /* 损坏或受限存储不阻止无声游戏启动。 */
    }
    this.budget.beginSession(this.worldSession);
  }

  subscribe(subscriber: () => void) {
    this.subscribers.add(subscriber);
    subscriber();
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  snapshot() {
    return {
      ...this.mixer?.snapshot(),
      settings: { ...this.settings },
      unlocked: this.unlocked,
      error: this.error,
      voices: this.voices.size,
      playedCount: this.playedCount,
      recentSounds: this.recentSounds.map((sound) => ({ ...sound })),
      cachedSounds: this.sounds.size,
      dropped: this.budget.droppedCount,
      session: this.worldSession,
      sharedContext: this.player?.sharedContext ?? false,
      referenceName: this.player?.referenceName ?? '',
      cue: this.player?.cue ?? '',
    };
  }

  async unlock() {
    try {
      this.mixer ??= new AudioMixer();
      this.player ??= new MusicPlayer(this.mixer);
      this.mixer.apply(this.settings);
      this.unlocked = await this.mixer.unlock();
      this.error = '';
    } catch {
      this.error = '音频暂不可用，你仍可继续游戏。';
    }
    this.publish();
    return this.unlocked;
  }

  setVolume(bus: keyof AudioSettings, value: number) {
    this.settings = sanitizeAudioSettings({ ...this.settings, [bus]: value });
    this.mixer?.apply(this.settings);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* 本次会话仍生效。 */
    }
    this.publish();
  }

  get graph() {
    return this.mixer;
  }
  get music() {
    return this.player;
  }

  beginWorld() {
    this.endWorld();
    this.worldSession = `world-${++this.sequence}`;
    this.budget.beginSession(this.worldSession);
    return this.worldSession;
  }

  endWorld() {
    this.player?.stop(true);
    for (const id of this.voices.keys()) this.retire(id);
    this.worldSession = 'menu';
    this.budget.beginSession(this.worldSession);
  }

  play(
    key: SfxKey,
    options: {
      session?: string;
      position?: readonly [number, number, number];
      priority?: number;
      target?: string;
    } = {},
  ) {
    const mixer = this.mixer;
    if (!mixer || !this.unlocked || mixer.context.state !== 'running' || document.hidden) return false;
    const permit = this.budget.acquire(
      {
        sessionId: options.session ?? this.worldSession,
        key: `${key}:${options.target ?? ''}`,
        priority: options.priority ?? 1,
      },
      mixer.context.currentTime,
    );
    if (!permit) return false;
    if (permit.evictedId !== undefined) this.retire(permit.evictedId);
    let sound = this.sounds.get(key);
    if (!sound) {
      const samples = synthesizeSfx(key, mixer.context.sampleRate, 7819);
      const buffer = mixer.context.createBuffer(1, samples.length, mixer.context.sampleRate);
      buffer.copyToChannel(new Float32Array(samples), 0);
      sound = new pc.Sound(buffer);
      this.sounds.set(key, sound);
    }
    const voice = options.position
      ? new pc.SoundInstance3d(mixer.manager, sound, {
          position: new pc.Vec3(...options.position),
          refDistance: 2,
          maxDistance: 32,
          rollOffFactor: 1.4,
          distanceModel: pc.DISTANCE_INVERSE,
          volume: 0.55,
        })
      : new pc.SoundInstance(mixer.manager, sound, { volume: 0.4 });
    voice.setExternalNodes(mixer.sfx, mixer.output);
    voice.once('end', () => this.retire(permit.id));
    this.voices.set(permit.id, voice);
    voice.play();
    this.recentSounds.push({ key, sequence: ++this.playedCount });
    if (this.recentSounds.length > 32) this.recentSounds.shift();
    return true;
  }

  async importReference(file: File) {
    await this.unlock();
    if (!this.player) return;
    try {
      await this.player.importReference(file);
      this.error = '';
      this.player.start('meadow', 1);
    } catch (error) {
      this.error = error instanceof Error ? error.message : '无法读取参考曲。';
    }
    this.publish();
  }

  removeReference() {
    this.player?.removeReference();
    this.error = '';
    this.publish();
  }

  private retire(id: number) {
    const voice = this.voices.get(id);
    if (voice) {
      voice.off();
      voice.stop();
      voice.gain?.disconnect();
      if (voice instanceof pc.SoundInstance3d) voice.panner?.disconnect();
    }
    this.voices.delete(id);
    this.budget.release(id);
  }

  private publish() {
    this.subscribers.forEach((subscriber) => subscriber());
  }
}
