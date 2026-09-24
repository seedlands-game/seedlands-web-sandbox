import type { MediaPlaybackCommittedBatchV1 } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';
import { createBrowserPackMediaLoader, type PackMediaLoader } from '../../client/presentation/pack-media-loader';
import type { GlobalAudio } from './global-audio';

const MAX_PENDING_MEDIA_BATCHES = 64;
type Loader = Pick<PackMediaLoader, 'validate' | 'resolve' | 'abort' | 'dispose'>;

export class GameMediaController {
  private loader: Loader | null = null;
  private pendingProjection: readonly MediaPlaybackProjectionV1[] = Object.freeze([]);
  private pendingFacts: readonly MediaPlaybackCommittedBatchV1[] = Object.freeze([]);
  private activeEpoch: string | null = null;

  constructor(
    private readonly audio: GlobalAudio | undefined,
    private readonly failed: (message: string) => void,
    private readonly loadMedia: (packDirectory: URL) => Promise<Loader> = createBrowserPackMediaLoader,
  ) {}

  readonly callbacks = Object.freeze({
    onMediaProjection: (projection: readonly MediaPlaybackProjectionV1[]) => this.projection(projection),
    onMediaFacts: (batch: MediaPlaybackCommittedBatchV1) => this.facts(batch),
  });

  async load(packDirectory: URL): Promise<void> {
    if (this.audio) this.loader ??= await this.loadMedia(packDirectory);
  }

  beginWorld(epoch: string): void {
    if (!this.audio || !this.loader) return;
    this.activeEpoch = epoch;
    this.audio.beginMediaWorld(epoch, this.loader, this.failed);
    this.audio.installMediaProjections(this.pendingProjection);
    const pending = this.pendingFacts.filter((batch) => batch.worldEpoch === epoch);
    this.pendingFacts = Object.freeze([]);
    for (const batch of pending) this.audio.consumeMediaFacts(batch.facts);
  }

  beginRestore(epoch: string): void {
    this.pendingProjection = Object.freeze([]);
    this.beginWorld(epoch);
  }

  projection(value: readonly MediaPlaybackProjectionV1[]): void {
    try {
      for (const projection of value) if (projection.resource) this.loader?.validate(projection.resource);
    } catch {
      this.failed('唱片资源未通过当前世界资源锁校验。');
      return;
    }
    this.pendingProjection = value;
    this.audio?.installMediaProjections(value);
  }

  facts(batch: MediaPlaybackCommittedBatchV1): void {
    try {
      for (const fact of batch.facts) if (fact.resource) this.loader?.validate(fact.resource);
    } catch {
      this.failed('唱片资源未通过当前世界资源锁校验。');
      return;
    }
    if (this.activeEpoch === batch.worldEpoch) {
      this.audio?.consumeMediaFacts(batch.facts);
      return;
    }
    if (this.activeEpoch !== null) return;
    if (this.pendingFacts.length >= MAX_PENDING_MEDIA_BATCHES) {
      this.failed('唱片事件暂存容量已满，请重新进入世界。');
      return;
    }
    this.pendingFacts = Object.freeze([...this.pendingFacts, batch]);
  }

  pause(paused: boolean): void {
    this.audio?.setWorldMediaPaused(paused);
  }

  endWorld(): void {
    this.activeEpoch = null;
    this.pendingProjection = Object.freeze([]);
    this.pendingFacts = Object.freeze([]);
  }

  dispose(): void {
    this.loader?.dispose();
    this.loader = null;
    this.endWorld();
  }
}
