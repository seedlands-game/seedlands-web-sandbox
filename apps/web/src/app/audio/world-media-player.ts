import type {
  MediaPlaybackFactV1,
  MediaPlaybackProjectionV1,
  MediaResourceReferenceV1,
} from '@seedlands/stdlib/mod-api';
import { mediaFactMatchesProjection, mediaInstanceKey } from '../../client/authority/media-playback-admission';

export type WorldMediaResourceLease = Readonly<{
  /** Independently owned bytes; decoding may consume or detach the buffer. */
  bytes: ArrayBuffer;
  /** Releases fetch buffers and any temporary object URL owned by the resolver. */
  release(): void;
}>;

export type WorldMediaResourcePort = Readonly<{
  validate(resource: MediaResourceReferenceV1): void;
  resolve(resource: MediaResourceReferenceV1): Promise<WorldMediaResourceLease>;
}>;

export type WorldMediaSourcePort = Readonly<{
  connect(output: unknown): void;
  start(): void;
  stop(): void;
  disconnect(): void;
  onEnded(listener: () => void): () => void;
}>;

export type WorldMediaAudioPort<Decoded = unknown> = Readonly<{
  output: unknown;
  playbackAllowed(): boolean;
  resume(): Promise<boolean>;
  decode(bytes: ArrayBuffer): Promise<Decoded>;
  createSource(decoded: Decoded): WorldMediaSourcePort;
}>;

export type WorldMediaPlayerErrorCode = 'invalid-fact' | 'resource-unavailable' | 'decode-failed' | 'playback-failed';
export type WorldMediaPlayerError = Readonly<{
  code: WorldMediaPlayerErrorCode;
  message: string;
  instanceKey: string;
  trackId: string | null;
  revision: number;
}>;
export type WorldMediaPlayerSnapshot = Readonly<{
  phase: 'idle' | 'resume-pending' | 'loading' | 'playing' | 'error' | 'disposed';
  instanceKey: string | null;
  trackId: string | null;
  revision: number | null;
  error: WorldMediaPlayerError | null;
}>;

type ActiveSource = {
  generation: number;
  instanceKey: string;
  trackId: string;
  revision: number;
  source: WorldMediaSourcePort;
  removeEndedListener: () => void;
  retired: boolean;
};

const releaseLease = (lease: WorldMediaResourceLease | null): void => {
  if (!lease) return;
  try {
    lease.release();
  } catch {
    // Cleanup failures cannot revive or replace the authoritative playback state.
  }
};

export class WorldMediaPlayer<Decoded = unknown> {
  private generation = 0;
  private disposed = false;
  private desired: MediaPlaybackFactV1 | null = null;
  private active: ActiveSource | null = null;
  private phase: WorldMediaPlayerSnapshot['phase'] = 'idle';
  private error: WorldMediaPlayerError | null = null;
  private paused = false;
  private readonly factRevisions = new Map<string, number>();
  private readonly projections = new Map<string, MediaPlaybackProjectionV1>();

  constructor(
    private readonly resources: WorldMediaResourcePort,
    private readonly audio: WorldMediaAudioPort<Decoded>,
    private readonly onError: (error: WorldMediaPlayerError) => void = () => undefined,
  ) {}

  snapshot(): WorldMediaPlayerSnapshot {
    return Object.freeze({
      phase: this.disposed ? 'disposed' : this.phase,
      instanceKey: this.active?.instanceKey ?? (this.desired ? mediaInstanceKey(this.desired) : null),
      trackId: this.active?.trackId ?? this.desired?.trackId ?? null,
      revision: this.active?.revision ?? this.desired?.revision ?? null,
      error: this.error,
    });
  }

  async consume(fact: MediaPlaybackFactV1): Promise<boolean> {
    if (this.disposed) return false;
    const key = mediaInstanceKey(fact);
    const projection = this.projections.get(key);
    if (projection && !mediaFactMatchesProjection(fact, projection)) return false;
    const currentRevision = this.factRevisions.get(key) ?? -1;
    if (fact.revision <= currentRevision) return false;
    this.factRevisions.set(key, fact.revision);

    if (!fact.playing && !fact.resumePending) {
      if (this.desired && mediaInstanceKey(this.desired) === key) this.desired = null;
      if (this.active?.instanceKey === key) this.invalidateAndRetire();
      this.error = null;
      this.phase = this.active || this.desired ? this.phase : 'idle';
      return true;
    }

    this.desired = fact;
    this.error = null;
    this.invalidateAndRetire();
    if (this.paused || fact.resumePending || !this.audio.playbackAllowed()) {
      this.phase = 'resume-pending';
      return true;
    }
    return this.startDesired();
  }

  restoreProjection(projection: MediaPlaybackProjectionV1): void {
    if (this.disposed || !this.observeProjection(projection)) return;
    if (!projection.resumePending || !projection.slot || !projection.resource) return;
    this.desired = this.factFromProjection(projection);
    this.error = null;
    this.invalidateAndRetire();
    this.phase = 'resume-pending';
  }

  reconcileProjection(projection: MediaPlaybackProjectionV1): void {
    if (this.disposed || !this.observeProjection(projection)) return;
    if (projection.resumePending) {
      this.restoreProjection(projection);
      return;
    }
    const key = mediaInstanceKey(projection);
    if (projection.playing && projection.slot) {
      if (
        this.active?.instanceKey === key &&
        this.active.trackId === projection.slot.trackId &&
        this.active.revision === projection.revision
      )
        return;
      if (this.desired && mediaInstanceKey(this.desired) === key) this.desired = null;
      this.invalidateAndRetire();
      this.phase = 'idle';
      return;
    }
    if (this.desired && mediaInstanceKey(this.desired) === key) this.desired = null;
    if (this.active?.instanceKey === key) this.invalidateAndRetire();
    this.phase = this.active || this.desired ? this.phase : 'idle';
  }

  async resumeFromGesture(): Promise<boolean> {
    if (this.disposed || this.paused || !this.desired) return false;
    const generation = this.generation;
    let allowed: boolean;
    try {
      allowed = await this.audio.resume();
    } catch {
      if (generation === this.generation && this.desired) this.fail('playback-failed', this.desired);
      return false;
    }
    if (this.disposed || generation !== this.generation || !this.desired) return false;
    if (!allowed || !this.audio.playbackAllowed()) {
      this.phase = 'resume-pending';
      return false;
    }
    return this.startDesired();
  }

  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    if (!paused) return;
    this.invalidateAndRetire();
    this.phase = this.desired ? 'resume-pending' : 'idle';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.desired = null;
    this.error = null;
    this.invalidateAndRetire();
    this.factRevisions.clear();
    this.projections.clear();
    this.phase = 'disposed';
  }

  private async startDesired(): Promise<boolean> {
    const fact = this.desired;
    if (!fact?.trackId || !fact.resource || this.disposed) return false;
    const generation = ++this.generation;
    this.phase = 'loading';
    let lease: WorldMediaResourceLease | null = null;
    try {
      try {
        lease = await this.resources.resolve(fact.resource);
      } catch {
        if (generation === this.generation && !this.disposed) this.fail('resource-unavailable', fact);
        return false;
      }
      if (!this.isCurrent(generation, fact)) {
        releaseLease(lease);
        lease = null;
        return false;
      }

      let decoded: Decoded;
      try {
        decoded = await this.audio.decode(lease.bytes);
      } catch {
        if (generation === this.generation && !this.disposed) this.fail('decode-failed', fact);
        return false;
      } finally {
        releaseLease(lease);
        lease = null;
      }
      if (!this.isCurrent(generation, fact)) return false;

      const source = this.audio.createSource(decoded);
      const active: ActiveSource = {
        generation,
        instanceKey: mediaInstanceKey(fact),
        trackId: fact.trackId,
        revision: fact.revision,
        source,
        removeEndedListener: () => undefined,
        retired: false,
      };
      try {
        active.removeEndedListener = source.onEnded(() => this.finish(active));
        source.connect(this.audio.output);
        this.active = active;
        source.start();
      } catch {
        this.retire(active, true);
        if (generation === this.generation && !this.disposed) this.fail('playback-failed', fact);
        return false;
      }
      this.phase = 'playing';
      return true;
    } catch {
      releaseLease(lease);
      if (generation === this.generation && !this.disposed) this.fail('playback-failed', fact);
      return false;
    }
  }

  private isCurrent(generation: number, fact: MediaPlaybackFactV1): boolean {
    return !this.disposed && generation === this.generation && this.desired === fact;
  }

  private observeProjection(projection: MediaPlaybackProjectionV1): boolean {
    const key = mediaInstanceKey(projection);
    const previous = this.projections.get(key)?.revision ?? -1;
    if (projection.revision < previous) return false;
    this.projections.set(key, projection);
    return true;
  }

  private invalidateAndRetire(): void {
    this.generation += 1;
    if (this.active) this.retire(this.active, true);
  }

  private finish(active: ActiveSource): void {
    this.retire(active, false);
    if (this.active === null && active.generation === this.generation) {
      this.desired = null;
      this.phase = 'idle';
    }
  }

  private retire(active: ActiveSource, stop: boolean): void {
    if (active.retired) return;
    active.retired = true;
    active.removeEndedListener();
    if (stop) {
      try {
        active.source.stop();
      } catch {
        // A source may already have ended; disconnection still has to run.
      }
    }
    try {
      active.source.disconnect();
    } catch {
      // Disconnect is best effort after the source has been retired.
    }
    if (this.active === active) this.active = null;
  }

  private fail(code: WorldMediaPlayerErrorCode, fact: MediaPlaybackFactV1): void {
    this.phase = 'error';
    this.error = Object.freeze({
      code,
      message: `World media playback failed: ${code}.`,
      instanceKey: mediaInstanceKey(fact),
      trackId: typeof fact?.trackId === 'string' ? fact.trackId : null,
      revision: Number.isSafeInteger(fact?.revision) ? fact.revision : -1,
    });
    this.onError(this.error);
  }

  private factFromProjection(projection: MediaPlaybackProjectionV1): MediaPlaybackFactV1 {
    return Object.freeze({
      version: 1,
      kind: projection.slot ? 'activate' : 'eject',
      device: projection.device,
      revision: projection.revision,
      previousTrackId: projection.slot?.trackId ?? null,
      trackId: projection.slot?.trackId ?? null,
      resource: projection.resource,
      playing: projection.playing,
      resumePending: projection.resumePending,
    });
  }
}
