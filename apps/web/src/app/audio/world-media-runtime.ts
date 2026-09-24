import type {
  MediaPlaybackFactV1,
  MediaPlaybackProjectionV1,
  MediaResourceReferenceV1,
} from '@seedlands/stdlib/mod-api';
import type { SessionEpoch } from '@seedlands/stdlib/runtime/session-protocol';
import {
  mediaFactEndsPlayback,
  mediaFactMatchesProjection,
  mediaInstanceKey,
} from '../../client/authority/media-playback-admission';
import { WorldMediaPlayer, type WorldMediaAudioPort, type WorldMediaPlayerError } from './world-media-player';

const MAX_MEDIA_INSTANCES = 4_096;

type Player = WorldMediaPlayer<AudioBuffer>;
export type WorldMediaRuntimeSnapshot = Readonly<{
  epoch: SessionEpoch;
  instances: readonly Readonly<{
    key: string;
    phase: ReturnType<Player['snapshot']>['phase'];
    revision: number | null;
  }>[];
  error: WorldMediaPlayerError | null;
}>;

/** World-scoped manager that repeats projection admission to protect buffered delivery before audio startup. */
export class WorldMediaRuntime {
  private readonly players = new Map<string, Player>();
  private readonly projections = new Map<string, MediaPlaybackProjectionV1>();
  private error: WorldMediaPlayerError | null = null;
  private paused = false;
  private disposed = false;

  constructor(
    readonly epoch: SessionEpoch,
    private readonly resources: Readonly<{
      validate(reference: MediaResourceReferenceV1): void;
      resolve(reference: MediaResourceReferenceV1): Promise<{ bytes: ArrayBuffer; release(): void }>;
      abort?(): void;
    }>,
    private readonly audio: WorldMediaAudioPort<AudioBuffer>,
    private readonly onError: (error: WorldMediaPlayerError) => void = () => undefined,
  ) {}

  installProjections(projections: readonly MediaPlaybackProjectionV1[]): void {
    if (this.disposed) return;
    const previousKeys = new Set(this.projections.keys());
    const previous = new Map(this.projections);
    const next = this.projectionMap(projections);
    for (const projection of projections) if (projection.resource) this.resources.validate(projection.resource);
    for (const projection of projections) {
      const key = mediaInstanceKey(projection);
      previousKeys.delete(key);
      if (JSON.stringify(previous.get(key)) === JSON.stringify(projection)) continue;
      if (projection.resumePending && projection.slot && projection.resource)
        this.playerFor(projection).restoreProjection(projection);
      else this.players.get(key)?.reconcileProjection(projection);
    }
    for (const key of previousKeys) {
      this.players.get(key)?.dispose();
      this.players.delete(key);
    }
    this.projections.clear();
    for (const [key, projection] of next) this.projections.set(key, projection);
  }

  async consumeFacts(facts: readonly MediaPlaybackFactV1[]): Promise<void> {
    if (this.disposed) return;
    const accepted = facts.filter((fact) =>
      mediaFactMatchesProjection(fact, this.projections.get(mediaInstanceKey(fact))),
    );
    for (const fact of accepted) if (fact.resource) this.resources.validate(fact.resource);
    this.error = null;
    await Promise.all(
      accepted.map((fact) => {
        const key = mediaInstanceKey(fact);
        if (mediaFactEndsPlayback(fact) || (!fact.playing && !fact.resumePending))
          return this.players.get(key)?.consume(fact) ?? false;
        return this.playerFor(fact).consume(fact);
      }),
    );
  }

  async resumeFromGesture(): Promise<boolean> {
    if (this.disposed || this.paused) return false;
    const results = await Promise.all([...this.players.values()].map((player) => player.resumeFromGesture()));
    return results.some(Boolean);
  }

  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    for (const player of this.players.values()) player.setPaused(paused);
  }

  snapshot(): WorldMediaRuntimeSnapshot {
    return Object.freeze({
      epoch: this.epoch,
      instances: Object.freeze(
        [...this.players].map(([key, player]) => {
          const snapshot = player.snapshot();
          return Object.freeze({ key, phase: snapshot.phase, revision: snapshot.revision });
        }),
      ),
      error: this.error,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const player of this.players.values()) player.dispose();
    this.players.clear();
    this.projections.clear();
    this.resources.abort?.();
  }

  private projectionMap(projections: readonly MediaPlaybackProjectionV1[]): Map<string, MediaPlaybackProjectionV1> {
    if (projections.length > MAX_MEDIA_INSTANCES) throw new RangeError('World media projection capacity exceeded.');
    const next = new Map<string, MediaPlaybackProjectionV1>();
    for (const projection of projections) {
      const key = mediaInstanceKey(projection);
      if (next.has(key)) throw new TypeError('World media projection instance is duplicated.');
      next.set(key, projection);
    }
    return next;
  }

  private playerFor(entry: MediaPlaybackFactV1 | MediaPlaybackProjectionV1): Player {
    const key = mediaInstanceKey(entry);
    let player = this.players.get(key);
    if (!player) {
      player = new WorldMediaPlayer(this.resources, this.audio, (error) => {
        this.error = error;
        this.onError(error);
      });
      player.setPaused(this.paused);
      this.players.set(key, player);
    }
    return player;
  }
}
