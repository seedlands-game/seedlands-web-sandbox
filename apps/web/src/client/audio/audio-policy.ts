import {
  audioRandom,
  MUSIC_CUE_DURATION,
  type AudioSettings,
  type MusicContext,
  type MusicPreset,
} from './audio-types';

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  master: 0.65,
  music: 0.28,
  sfx: 0.7,
  ambience: 0.32,
});

export function sanitizeAudioSettings(value: unknown): AudioSettings {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const gain = (name: keyof AudioSettings) => {
    const candidate = source[name];
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.min(1, Math.max(0, candidate))
      : DEFAULT_AUDIO_SETTINGS[name];
  };
  return { master: gain('master'), music: gain('music'), sfx: gain('sfx'), ambience: gain('ambience') };
}

type SoundRequest = { sessionId: string; key: string; priority: number };

export class SoundBudget {
  private sessionId = '';
  private sequence = 0;
  private readonly active = new Map<number, number>();
  private readonly recent = new Map<string, number>();
  droppedCount = 0;

  constructor(private readonly capacity = 16) {}

  beginSession(sessionId: string) {
    this.sessionId = sessionId;
    this.active.clear();
    this.recent.clear();
  }

  get activeCount() {
    return this.active.size;
  }

  acquire(request: SoundRequest, now: number): { id: number; evictedId?: number } | null {
    if (
      request.sessionId !== this.sessionId ||
      !Number.isFinite(now) ||
      now - (this.recent.get(request.key) ?? -Infinity) < 0.08
    ) {
      this.droppedCount++;
      return null;
    }
    let evictedId: number | undefined;
    if (this.active.size >= this.capacity) {
      let leastPriority = request.priority;
      for (const [id, priority] of this.active) {
        if (priority < leastPriority) {
          leastPriority = priority;
          evictedId = id;
        }
      }
      if (evictedId === undefined) {
        this.droppedCount++;
        return null;
      }
      this.active.delete(evictedId);
    }
    const id = ++this.sequence;
    this.active.set(id, request.priority);
    this.recent.delete(request.key);
    this.recent.set(request.key, now);
    if (this.recent.size > 128) this.recent.delete(this.recent.keys().next().value!);
    return { id, evictedId };
  }

  release(id: number) {
    this.active.delete(id);
  }
}

export class FootstepTracker {
  private previous: readonly [number, number, number] | null = null;
  private distance = 0;

  sample(position: readonly [number, number, number], grounded: boolean) {
    const previous = this.previous;
    this.previous = [...position];
    if (!previous) return 0;
    const displacement = Math.hypot(position[0] - previous[0], position[2] - previous[2]);
    if (!grounded || displacement > 4 || !Number.isFinite(displacement)) {
      this.distance = 0;
      return 0;
    }
    this.distance += displacement;
    const steps = Math.floor((this.distance + 1e-8) / 1.7);
    this.distance = Math.max(0, this.distance - steps * 1.7);
    return Math.min(2, steps);
  }

  reset() {
    this.previous = null;
    this.distance = 0;
  }
}

export type MusicCueAction = { type: 'start'; preset: MusicPreset; seed: number; duration: number } | { type: 'stop' };

export function musicPreset(context: MusicContext): MusicPreset {
  if (context.worldTime < 6 || context.worldTime >= 19.5) return 'night';
  if (context.waterProximity > 0.4 || /forest|wood|river|lake|林|河|湖/i.test(context.biome)) return 'waterside';
  return 'meadow';
}

export class MusicCueScheduler {
  private nextAt: number | null = null;
  private current: { preset: MusicPreset; endAt: number } | null = null;
  private candidate: { preset: MusicPreset; since: number } | null = null;
  private wasPaused = false;
  private readonly random: () => number;

  constructor(seed: number) {
    this.random = audioRandom(seed);
  }

  update(context: MusicContext, now: number, paused = false): MusicCueAction[] {
    if (!Number.isFinite(now)) return [];
    if (paused) {
      this.wasPaused = true;
      this.candidate = null;
      const playing = this.current !== null;
      this.current = null;
      return playing ? [{ type: 'stop' }] : [];
    }
    if (this.wasPaused || this.nextAt === null) {
      this.wasPaused = false;
      this.nextAt = now + 8;
    }
    const preset = musicPreset(context);
    if (this.current) {
      if (now >= this.current.endAt) {
        this.current = null;
        this.candidate = null;
        this.nextAt = now + 45 + this.random() * 75;
        return [{ type: 'stop' }];
      }
      if (preset === this.current.preset) this.candidate = null;
      else if (this.candidate?.preset !== preset) this.candidate = { preset, since: now };
      else if (now - this.candidate.since >= 8) return [{ type: 'stop' }, this.start(preset, now)];
      return [];
    }
    return now >= this.nextAt ? [this.start(preset, now)] : [];
  }

  private start(preset: MusicPreset, now: number): Extract<MusicCueAction, { type: 'start' }> {
    this.current = { preset, endAt: now + MUSIC_CUE_DURATION };
    this.candidate = null;
    return { type: 'start', preset, duration: MUSIC_CUE_DURATION, seed: Math.floor(this.random() * 0xffffffff) };
  }
}
