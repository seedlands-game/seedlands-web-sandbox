import * as pc from 'playcanvas';
import { synthesizeSfx } from '../../client/audio/audio-composition';
import { DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings, SoundBudget } from '../../client/audio/audio-policy';
import type { AudioSettings, SfxKey } from '../../client/audio/audio-types';
import { AudioMixer } from './audio-mixer';
import { MusicPlayer } from './music-player';
import type {
  MediaPlaybackFactV1,
  MediaPlaybackProjectionV1,
  MediaResourceReferenceV1,
} from '@seedlands/stdlib/mod-api';
import type { SessionEpoch } from '@seedlands/stdlib/runtime/session-protocol';
import { WorldMediaAudioAdapter } from './world-media-audio-adapter';
import { WorldMediaRuntime } from './world-media-runtime';

const STORAGE_KEY = 'seedlands.audio.v1';
const MAX_PENDING_MEDIA_FACT_BATCHES = 64;
type MediaResources = Readonly<{
  validate(reference: MediaResourceReferenceV1): void;
  resolve(reference: MediaResourceReferenceV1): Promise<{ bytes: ArrayBuffer; release(): void }>;
  abort?(): void;
}>;

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
  private mediaError = '';
  private media: WorldMediaRuntime | null = null;
  private mediaWorld: Readonly<{
    epoch: SessionEpoch;
    resources: MediaResources;
    onError(message: string): void;
  }> | null = null;
  private mediaProjections: readonly MediaPlaybackProjectionV1[] = Object.freeze([]);
  private mediaFacts: readonly (readonly MediaPlaybackFactV1[])[] = Object.freeze([]);
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
      error: this.mediaError || this.error,
      voices: this.voices.size,
      playedCount: this.playedCount,
      recentSounds: this.recentSounds.map((sound) => ({ ...sound })),
      cachedSounds: this.sounds.size,
      dropped: this.budget.droppedCount,
      session: this.worldSession,
      sharedContext: this.player?.sharedContext ?? false,
      cue: this.player?.cue ?? '',
      underwaterFilterHz: this.mixer?.underwaterFilter?.frequency.value ?? 18_000,
      worldMedia: this.media?.snapshot() ?? null,
    };
  }

  async unlock() {
    try {
      this.mixer ??= new AudioMixer();
      this.player ??= new MusicPlayer(this.mixer);
      this.mixer.apply(this.settings);
      this.unlocked = await this.mixer.unlock();
      this.error = '';
      this.ensureMediaWorld();
      if (this.unlocked) await this.media?.resumeFromGesture();
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
    this.media?.dispose();
    this.media = null;
    this.mediaWorld = null;
    this.mediaProjections = Object.freeze([]);
    this.mediaFacts = Object.freeze([]);
    this.mediaError = '';
    this.player?.stop(true);
    for (const id of this.voices.keys()) this.retire(id);
    this.worldSession = 'menu';
    this.budget.beginSession(this.worldSession);
  }

  beginMediaWorld(epoch: SessionEpoch, resources: MediaResources, onError: (message: string) => void): void {
    this.media?.dispose();
    this.media = null;
    this.mediaError = '';
    this.mediaWorld = Object.freeze({ epoch, resources, onError });
    this.mediaProjections = Object.freeze([]);
    this.mediaFacts = Object.freeze([]);
    if (!this.mixer) {
      this.error ||= '音频暂不可用，你仍可继续游戏。';
      onError(this.error);
      this.publish();
      return;
    }
    this.ensureMediaWorld();
    this.publish();
  }

  installMediaProjections(projections: readonly MediaPlaybackProjectionV1[]): void {
    this.mediaProjections = projections;
    this.media?.installProjections(projections);
    this.publish();
  }

  consumeMediaFacts(facts: readonly MediaPlaybackFactV1[]): void {
    if (!this.media) {
      if (this.mediaFacts.length >= MAX_PENDING_MEDIA_FACT_BATCHES) {
        this.mediaError = '唱片事件暂存容量已满，请重新进入世界。';
        this.mediaWorld?.onError(this.mediaError);
        this.publish();
        return;
      }
      this.mediaFacts = Object.freeze([...this.mediaFacts, facts]);
      return;
    }
    void this.media?.consumeFacts(facts).then(() => {
      if (this.media?.snapshot().error === null) this.mediaError = '';
      this.publish();
    });
  }

  resumeMediaFromGesture(): void {
    void this.media?.resumeFromGesture().then(() => this.publish());
  }

  setWorldMediaPaused(paused: boolean): void {
    this.media?.setPaused(paused);
    this.publish();
  }

  play(
    key: SfxKey,
    options: {
      session?: string;
      position?: readonly [number, number, number];
      priority?: number;
      target?: string;
      scope?: 'world' | 'ui';
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
    voice.setExternalNodes(options.scope === 'ui' || key === 'hover' ? mixer.uiSfx : mixer.sfx, mixer.output);
    voice.once('end', () => this.retire(permit.id));
    this.voices.set(permit.id, voice);
    voice.play();
    this.recentSounds.push({ key, sequence: ++this.playedCount });
    if (this.recentSounds.length > 32) this.recentSounds.shift();
    return true;
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

  private ensureMediaWorld(): void {
    if (this.media || !this.mixer || !this.mediaWorld) return;
    const world = this.mediaWorld;
    this.media = new WorldMediaRuntime(world.epoch, world.resources, new WorldMediaAudioAdapter(this.mixer), () => {
      this.mediaError = '唱片播放失败，请检查资源或浏览器音频权限。';
      world.onError(this.mediaError);
      this.publish();
    });
    this.media.installProjections(this.mediaProjections);
    const pending = this.mediaFacts;
    this.mediaFacts = Object.freeze([]);
    for (const facts of pending) void this.media.consumeFacts(facts);
  }

  private publish() {
    this.subscribers.forEach((subscriber) => subscriber());
  }
}
