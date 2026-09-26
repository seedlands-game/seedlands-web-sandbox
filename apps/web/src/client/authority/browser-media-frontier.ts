import type { MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';
import type { SessionEpoch } from '@seedlands/stdlib/runtime/session-protocol';
import {
  cloneMediaPlaybackCommittedBatchV1,
  cloneMediaPlaybackProjectionsV1,
  type MediaPlaybackCommittedBatchV1,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { mediaFactEndsPlayback, mediaFactMatchesProjection, mediaInstanceKey } from './media-playback-admission';

export class BrowserMediaFrontier {
  private epoch: SessionEpoch;
  private projections: readonly MediaPlaybackProjectionV1[] = Object.freeze([]);
  private projectionRevisions = new Map<string, number>();
  private factRevisions = new Map<string, number>();

  constructor(
    epoch: SessionEpoch,
    private readonly onProjection: (projections: readonly MediaPlaybackProjectionV1[]) => void = () => undefined,
    private readonly onFacts: (batch: MediaPlaybackCommittedBatchV1) => void = () => undefined,
  ) {
    this.epoch = epoch;
  }

  get current(): readonly MediaPlaybackProjectionV1[] {
    return this.projections;
  }

  clone(raw: readonly MediaPlaybackProjectionV1[] | undefined): readonly MediaPlaybackProjectionV1[] {
    return cloneMediaPlaybackProjectionsV1(raw);
  }

  tryClone(
    raw: readonly MediaPlaybackProjectionV1[] | undefined,
  ): Readonly<{ ok: true; value: readonly MediaPlaybackProjectionV1[] }> | Readonly<{ ok: false; error: Error }> {
    try {
      return Object.freeze({ ok: true as const, value: this.clone(raw) });
    } catch (error) {
      return Object.freeze({
        ok: false as const,
        error: error instanceof Error ? error : new Error('Authority media projection is invalid.'),
      });
    }
  }

  acceptFactsSafely(messageEpoch: SessionEpoch, raw: MediaPlaybackCommittedBatchV1): void {
    try {
      this.acceptFacts(messageEpoch, raw);
    } catch {
      // A malformed all-or-nothing media batch cannot disturb the active world.
    }
  }

  replaceEpoch(epoch: SessionEpoch, raw: readonly MediaPlaybackProjectionV1[] | undefined, publish = true): void {
    const projections = cloneMediaPlaybackProjectionsV1(raw);
    const revisions = new Map(projections.map((entry) => [mediaInstanceKey(entry), entry.revision] as const));
    this.epoch = epoch;
    this.projections = projections;
    this.projectionRevisions = revisions;
    this.factRevisions = new Map();
    if (publish) this.onProjection(projections);
  }

  publishCurrent(): void {
    this.onProjection(this.projections);
  }

  acceptProjections(epoch: SessionEpoch, raw: readonly MediaPlaybackProjectionV1[] | undefined): boolean {
    if (epoch !== this.epoch) return false;
    const projections = cloneMediaPlaybackProjectionsV1(raw);
    let changed = projections.length !== this.projections.length;
    const previousByKey = new Map(this.projections.map((entry) => [mediaInstanceKey(entry), entry] as const));
    for (const entry of projections) {
      const key = mediaInstanceKey(entry);
      const previousRevision = this.projectionRevisions.get(key);
      if (previousRevision !== undefined && entry.revision < previousRevision) return false;
      if (previousRevision === entry.revision && JSON.stringify(previousByKey.get(key)) !== JSON.stringify(entry))
        return false;
      if (previousRevision !== entry.revision) changed = true;
    }
    if (!changed) return false;
    this.projections = projections;
    this.projectionRevisions = new Map(projections.map((entry) => [mediaInstanceKey(entry), entry.revision] as const));
    this.factRevisions = new Map([...this.factRevisions].filter(([key]) => this.projectionRevisions.has(key)));
    this.onProjection(projections);
    return true;
  }

  acceptFacts(messageEpoch: SessionEpoch, raw: MediaPlaybackCommittedBatchV1): boolean {
    if (messageEpoch !== this.epoch) return false;
    const batch = cloneMediaPlaybackCommittedBatchV1(raw, messageEpoch);
    const next = new Map(this.factRevisions);
    const projected = new Map(this.projections.map((entry) => [mediaInstanceKey(entry), entry] as const));
    const accepted: MediaPlaybackFactV1[] = [];
    for (const fact of batch.facts) {
      const key = mediaInstanceKey(fact);
      const projection = projected.get(key);
      if (!projection) {
        if (mediaFactEndsPlayback(fact)) accepted.push(fact);
        continue;
      }
      if (!mediaFactMatchesProjection(fact, projection)) continue;
      const previous = next.get(key) ?? -1;
      if (fact.revision <= previous) continue;
      next.set(key, fact.revision);
      accepted.push(fact);
    }
    if (!accepted.length) return false;
    this.factRevisions = next;
    this.onFacts(Object.freeze({ ...batch, facts: Object.freeze(accepted) }));
    return true;
  }
}
