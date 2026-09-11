import type { AuthorityPersistence } from '@seedlands/stdlib/server/authority/authority-runtime-options';
import type { ChunkSnapshot } from '@seedlands/stdlib/server/persistence/chunk-persistence';
import type { GameplaySnapshot } from '@seedlands/stdlib/server/gameplay/gameplay-runtime';
import type { FrozenGameSaveSnapshot } from '@seedlands/stdlib/server/persistence/game-save-snapshot';

/** Keeps an already validated runtime alive while its durable backing store is atomically replaced. */
export class SwitchableAuthorityPersistence implements AuthorityPersistence {
  constructor(private delegate: AuthorityPersistence) {}

  replace(delegate: AuthorityPersistence): void {
    this.delegate = delegate;
  }

  loadSnapshot(key: string) {
    return this.delegate.loadSnapshot(key);
  }

  saveSnapshots(snapshots: readonly ChunkSnapshot[]) {
    return this.delegate.saveSnapshots(snapshots);
  }

  ensureSnapshot(cx: number, cy: number, cz: number) {
    return this.delegate.ensureSnapshot?.(cx, cy, cz) ?? Promise.resolve();
  }

  ensureNeighborhood(cx: number, cy: number, cz: number, residentKeys?: readonly string[]) {
    return this.delegate.ensureNeighborhood?.(cx, cy, cz, residentKeys) ?? Promise.resolve();
  }

  preparedSnapshotStatus(key: string) {
    return this.delegate.preparedSnapshotStatus?.(key) ?? 'unknown';
  }

  releaseNeighborhood(cx: number, cy: number, cz: number): void {
    this.delegate.releaseNeighborhood?.(cx, cy, cz);
  }

  evictSnapshot(key: string): void {
    this.delegate.evictSnapshot?.(key);
  }

  loadGameplaySnapshot() {
    return this.delegate.loadGameplaySnapshot?.() ?? null;
  }

  saveGameplaySnapshot(snapshot: GameplaySnapshot) {
    return this.delegate.saveGameplaySnapshot?.(snapshot) ?? Promise.resolve();
  }

  saveFrozenSnapshot(snapshot: FrozenGameSaveSnapshot) {
    return this.delegate.saveFrozenSnapshot?.(snapshot) ?? Promise.resolve();
  }

  loadGameCheckpoint() {
    return this.delegate.loadGameCheckpoint?.() ?? null;
  }

  loadLegacyPlayerPosition() {
    return this.delegate.loadLegacyPlayerPosition?.() ?? null;
  }

  metrics() {
    return this.delegate.metrics?.() ?? { recordBytes: 0 };
  }
}
