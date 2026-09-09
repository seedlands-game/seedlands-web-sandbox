import { chunkKey } from '../../world/voxel';
import type { GameplaySnapshotV3 } from '../gameplay/gameplay-runtime';
import type { ServerChunk } from '../game-server-types';
import type { ChunkPersistence } from './chunk-persistence';
import { createChunkSnapshot } from './create-chunk-snapshot';
import {
  cloneFrozenGameSaveSnapshot,
  GAME_SAVE_FLUID_SCHEMA,
  GAME_SAVE_SCHEMA_VERSION,
  type FrozenGameSaveSnapshot,
} from './game-save-snapshot';
import type { GameplayPersistence } from './gameplay-persistence';
import type { CoreClone } from '../../runtime/platform-ports';

type Persistence = ChunkPersistence & Partial<GameplayPersistence>;
type SaveResult = { savedChunks: string[]; gameplaySaved: boolean; commitSequence: number };
type Options = {
  seedText: string;
  generatorVersion: number;
  persistence?: Persistence;
  chunks: Map<string, ServerChunk>;
  getWorldRevision: () => number;
  createGameplaySnapshot: () => GameplaySnapshotV3;
  markGameplayPersisted: (revision: number) => void;
  clone: CoreClone;
};

export class GameSaveRuntime {
  private readonly frozenSaves = new WeakMap<FrozenGameSaveSnapshot, FrozenGameSaveSnapshot>();
  private saveQueue: Promise<void> = Promise.resolve();
  private persistedCommitSequence = -1;

  constructor(private readonly options: Options) {}

  freeze(commitSequence: number): FrozenGameSaveSnapshot {
    return this.freezeSelected(commitSequence, (chunk) => chunk.dirty);
  }

  /** 导出可移植检查点时包含当前 Authority 持有的全部 canonical Chunk，而不只包含脏块。 */
  freezePortable(commitSequence: number): FrozenGameSaveSnapshot {
    return this.freezeSelected(commitSequence, () => true);
  }

  private freezeSelected(commitSequence: number, include: (chunk: ServerChunk) => boolean): FrozenGameSaveSnapshot {
    if (!Number.isSafeInteger(commitSequence) || commitSequence < 0)
      throw new TypeError('Save commit sequence must be a non-negative safe integer.');
    const gameplay = this.options.createGameplaySnapshot();
    const chunks = [...this.options.chunks.values()]
      .filter(include)
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((chunk) => createChunkSnapshot(this.options.seedText, chunk));
    const snapshot: FrozenGameSaveSnapshot = {
      version: GAME_SAVE_SCHEMA_VERSION,
      commitSequence,
      seedText: this.options.seedText,
      generatorVersion: this.options.generatorVersion,
      worldRevision: this.options.getWorldRevision(),
      physicsSchema: { ...gameplay.physicsSchema },
      fluidSchema: { ...GAME_SAVE_FLUID_SCHEMA },
      gameplay,
      chunks,
    };
    this.frozenSaves.set(snapshot, cloneFrozenGameSaveSnapshot(snapshot, this.options.clone));
    return snapshot;
  }

  saveFrozen(snapshot: FrozenGameSaveSnapshot): Promise<SaveResult> {
    const owned = this.frozenSaves.get(snapshot);
    if (!owned) return Promise.reject(new Error('Frozen save token does not belong to this server.'));
    return this.enqueue(() => this.persistFrozen(owned)).then((result) => {
      this.frozenSaves.delete(snapshot);
      return result;
    });
  }

  save(commitSequence = 0): Promise<SaveResult> {
    return this.saveFrozen(this.freeze(commitSequence));
  }

  async flushDirtyChunks(): Promise<string[]> {
    const dirty = [...this.options.chunks.values()].filter((chunk) => chunk.dirty);
    if (!dirty.length || !this.options.persistence) return [];
    if (this.hasGameplayPort())
      throw new Error('Atomic frozen game persistence is required instead of a standalone Chunk flush.');
    const snapshots = dirty.map((chunk) => createChunkSnapshot(this.options.seedText, chunk));
    await this.options.persistence.saveSnapshots(snapshots);
    this.acknowledgeChunks(snapshots);
    return snapshots.map((snapshot) => snapshot.key);
  }

  async evictChunk(cx: number, cy: number, cz: number): Promise<boolean> {
    const key = chunkKey(cx, cy, cz);
    const chunk = this.options.chunks.get(key);
    if (!chunk) return true;
    return this.evictChunkIfCurrent(key, chunk, chunk.accessEpoch, chunk.revision);
  }

  evictChunkIfCurrent(key: string, chunk: ServerChunk, accessEpoch: number, revision: number): boolean {
    const current = this.options.chunks.get(key);
    if (
      current !== chunk ||
      current.accessEpoch !== accessEpoch ||
      current.revision !== revision ||
      current.dirty ||
      current.persistedRevision !== current.revision
    )
      return false;
    this.options.chunks.delete(key);
    this.options.persistence?.evictSnapshot?.(key);
    return true;
  }

  private async persistFrozen(snapshot: FrozenGameSaveSnapshot): Promise<SaveResult> {
    const persistence = this.options.persistence;
    if (!persistence) return { savedChunks: [], gameplaySaved: false, commitSequence: snapshot.commitSequence };
    if (snapshot.commitSequence < this.persistedCommitSequence)
      throw new Error('Cannot persist an older frozen game checkpoint.');
    if (this.hasGameplayPort() && !persistence.saveFrozenSnapshot)
      throw new Error('Atomic frozen game persistence is required when Gameplay is persisted.');
    if (persistence.saveFrozenSnapshot) await persistence.saveFrozenSnapshot(snapshot);
    else if (snapshot.chunks.length) await persistence.saveSnapshots(snapshot.chunks);
    this.acknowledgeChunks(snapshot.chunks);
    if (persistence.saveFrozenSnapshot) this.options.markGameplayPersisted(snapshot.gameplay.revision);
    this.persistedCommitSequence = snapshot.commitSequence;
    return {
      savedChunks: snapshot.chunks.map((chunk) => chunk.key),
      gameplaySaved: Boolean(persistence.saveFrozenSnapshot),
      commitSequence: snapshot.commitSequence,
    };
  }

  private acknowledgeChunks(snapshots: readonly { key: string; revision: number }[]): void {
    snapshots.forEach((saved) => {
      const chunk = this.options.chunks.get(saved.key);
      if (!chunk) return;
      chunk.persistedRevision = Math.max(chunk.persistedRevision, saved.revision);
      chunk.dirty = chunk.revision > chunk.persistedRevision;
    });
  }

  private hasGameplayPort(): boolean {
    return Boolean(
      this.options.persistence?.loadGameplaySnapshot ||
      this.options.persistence?.saveGameplaySnapshot ||
      this.options.persistence?.saveFrozenSnapshot,
    );
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.saveQueue.then(operation);
    this.saveQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
