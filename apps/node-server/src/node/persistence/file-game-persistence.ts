import { lstat, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ChunkPersistence,
  ChunkPersistenceLoadDiagnostics,
  ChunkSnapshot,
} from '@seedlands/game-core/server/persistence/chunk-persistence';
import type { FrozenGameSaveSnapshot } from '@seedlands/game-core/server/persistence/game-save-snapshot';
import type { GameplayPersistence } from '@seedlands/game-core/server/persistence/gameplay-persistence';
import type { GameplaySnapshot } from '@seedlands/game-core/server/gameplay/gameplay-runtime';
import { chunkKey } from '@seedlands/game-core/world/voxel';
import { cloneFrozenGameSaveSnapshot } from '@seedlands/game-core/server/persistence/game-save-snapshot';
import { decodeChunkBlob, encodeChunkBlob } from './file-chunk-blob';
import { readBoundedFile, replaceDurableFile, syncDirectory, writeImmutableFile } from './durable-files';
import { FileStoreLock } from './file-store-lock';
import {
  encodePointer,
  loadManifestFromPointer,
  pointerExists,
  sha256,
  validateChunkBlobReference,
} from './file-store-manifest';
import { nodeCorePlatform } from '../runtime/node-core-platform';
import {
  DEFAULT_FILE_STORE_LIMITS,
  FILE_STORE_VERSION,
  type ChunkFileReference,
  type FileGamePersistenceFaultStage,
  type FileStoreLimits,
  type FileStoreManifest,
  type FileStorePointer,
  type PreviousCheckpointInspection,
} from './file-store-types';

export type { FileGamePersistenceFaultStage, FileStoreLimits, PreviousCheckpointInspection } from './file-store-types';

export type FileGamePersistenceOptions = Readonly<{
  directory: string;
  seedText: string;
  generatorVersion: number;
  worldId?: string;
  limits?: Partial<FileStoreLimits>;
  faultInjector?: (stage: FileGamePersistenceFaultStage) => void;
}>;

export type FileSnapshotLoadTiming = Readonly<{
  status: 'found' | 'missing';
  transactionReadMs: number;
  decodeMs: number;
}>;

const cloneChunk = (snapshot: ChunkSnapshot): ChunkSnapshot => ({
  ...snapshot,
  voxels: snapshot.voxels.slice(),
  ...(snapshot.fluid ? { fluid: snapshot.fluid.slice() } : {}),
});

const knownBlobName = /^(?:chunk|gameplay)-[a-f0-9]{64}\.json$/;
const knownManifestName = /^manifest-[0-9]+-[a-f0-9]{64}\.json$/;

function validatedOptions(options: FileGamePersistenceOptions) {
  const worldId = options.worldId ?? 'default';
  const limits = { ...DEFAULT_FILE_STORE_LIMITS, ...options.limits };
  if (!options.directory) throw new TypeError('持久化目录不能为空。');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(worldId)) throw new TypeError('worldId 格式无效。');
  if (!options.seedText || Buffer.byteLength(options.seedText) > limits.maxSeedBytes)
    throw new TypeError('seedText 为空或超过配置上限。');
  if (!Number.isSafeInteger(options.generatorVersion) || options.generatorVersion < 1)
    throw new TypeError('generatorVersion 无效。');
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`持久化限制 ${name} 无效。`);
  return { worldId, limits };
}

export class FileGamePersistence implements ChunkPersistence, GameplayPersistence {
  private readonly snapshots = new Map<string, ChunkSnapshot>();
  private readonly missing = new Set<string>();
  private readonly activeChunkLoads = new Set<Promise<void>>();
  private saveTail: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private closing = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  private constructor(
    private readonly options: FileGamePersistenceOptions,
    private readonly worldId: string,
    private readonly limits: FileStoreLimits,
    private readonly lock: FileStoreLock,
    private currentPointer: FileStorePointer | null,
    private currentManifest: FileStoreManifest | null,
    private gameplaySnapshot: unknown,
  ) {}

  static async open(options: FileGamePersistenceOptions): Promise<FileGamePersistence> {
    const { worldId, limits } = validatedOptions(options);
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    await mkdir(join(options.directory, 'blobs'), { recursive: true, mode: 0o700 });
    await mkdir(join(options.directory, 'manifests'), { recursive: true, mode: 0o700 });
    await syncDirectory(options.directory);
    const lock = await FileStoreLock.acquire(options.directory);
    try {
      const identity = { worldId, seedText: options.seedText, generatorVersion: options.generatorVersion };
      const loaded = (await pointerExists(options.directory, 'CURRENT'))
        ? await loadManifestFromPointer(options.directory, 'CURRENT', identity, limits, {
            validateChunkContents: false,
          })
        : null;
      let canCollectGarbage = true;
      if (await pointerExists(options.directory, 'PREVIOUS')) {
        try {
          await loadManifestFromPointer(options.directory, 'PREVIOUS', identity, limits, {
            validateChunkContents: false,
          });
        } catch {
          canCollectGarbage = false;
        }
      }
      const store = new FileGamePersistence(
        options,
        worldId,
        limits,
        lock,
        loaded?.pointer ?? null,
        loaded?.manifest ?? null,
        loaded?.gameplay ?? null,
      );
      if (canCollectGarbage) await store.collectGarbage();
      return store;
    } catch (error) {
      await lock.release();
      throw error;
    }
  }

  static async inspectPreviousCheckpoint(
    options: FileGamePersistenceOptions,
  ): Promise<PreviousCheckpointInspection | null> {
    const { worldId, limits } = validatedOptions(options);
    if (!(await pointerExists(options.directory, 'PREVIOUS'))) return null;
    const loaded = await loadManifestFromPointer(
      options.directory,
      'PREVIOUS',
      { worldId, seedText: options.seedText, generatorVersion: options.generatorVersion },
      limits,
    );
    return {
      checkpoint: { ...loaded.manifest.checkpoint },
      chunkKeys: Object.keys(loaded.manifest.chunks).sort(),
      manifestPath: loaded.pointer.manifest,
    };
  }

  inspectPreviousCheckpoint(): Promise<PreviousCheckpointInspection | null> {
    return FileGamePersistence.inspectPreviousCheckpoint(this.options);
  }

  loadSnapshot(key: string): ChunkSnapshot | null {
    const snapshot = this.snapshots.get(key);
    return snapshot ? cloneChunk(snapshot) : null;
  }

  preparedSnapshotStatus(key: string) {
    if (this.snapshots.has(key)) return 'found' as const;
    if (this.missing.has(key)) return 'missing' as const;
    return 'unknown' as const;
  }

  async ensureSnapshot(cx: number, cy: number, cz: number): Promise<void> {
    await this.ensureSnapshotMeasured(cx, cy, cz);
  }

  async ensureSnapshotMeasured(cx: number, cy: number, cz: number): Promise<FileSnapshotLoadTiming> {
    this.assertReadable();
    if (this.closing) throw new Error('文件持久化实例正在关闭，不能开始新的 Chunk 读取。');
    const key = chunkKey(cx, cy, cz);
    if (this.snapshots.has(key)) return { status: 'found', transactionReadMs: 0, decodeMs: 0 };
    if (this.missing.has(key)) return { status: 'missing', transactionReadMs: 0, decodeMs: 0 };
    const reference = this.currentManifest?.chunks[key];
    if (!reference) {
      this.missing.add(key);
      return { status: 'missing', transactionReadMs: 0, decodeMs: 0 };
    }
    let completeLoad!: () => void;
    const activeLoad = new Promise<void>((resolve) => {
      completeLoad = resolve;
    });
    this.activeChunkLoads.add(activeLoad);
    try {
      const readStarted = performance.now();
      const data = await readBoundedFile(join(this.options.directory, reference.path), this.limits.maxBlobBytes);
      if (data.byteLength !== reference.bytes || sha256(data) !== reference.sha256)
        throw new Error(`Chunk ${key} 在启动后发生损坏。`);
      validateChunkBlobReference(data, key, reference, {
        worldId: this.worldId,
        seedText: this.options.seedText,
        generatorVersion: this.options.generatorVersion,
      });
      const transactionReadMs = performance.now() - readStarted;
      const decodeStarted = performance.now();
      const snapshot = decodeChunkBlob(data, {
        worldId: this.worldId,
        seedText: this.options.seedText,
        generatorVersion: this.options.generatorVersion,
        key,
        cx,
        cy,
        cz,
      });
      const decodeMs = performance.now() - decodeStarted;
      if (this.currentManifest?.chunks[key] !== reference) {
        if (this.snapshots.has(key)) return { status: 'found', transactionReadMs, decodeMs };
        throw new Error(`Chunk ${key} 读取期间检查点已改变且新快照未就绪。`);
      }
      this.snapshots.set(key, snapshot);
      return { status: 'found', transactionReadMs, decodeMs };
    } catch (error) {
      throw this.markFailed(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activeChunkLoads.delete(activeLoad);
      completeLoad();
    }
  }

  async ensureNeighborhood(
    cx: number,
    cy: number,
    cz: number,
    _residentKeys?: readonly string[],
  ): Promise<ChunkPersistenceLoadDiagnostics> {
    const started = performance.now();
    const keys: Array<[number, number, number]> = [];
    for (let y = cy - 1; y <= cy + 1; y += 1)
      for (let z = cz - 1; z <= cz + 1; z += 1) for (let x = cx - 1; x <= cx + 1; x += 1) keys.push([x, y, z]);
    const loads = await Promise.all(keys.map(([x, y, z]) => this.ensureSnapshotMeasured(x, y, z)));
    const foundCount = loads.filter((load) => load.status === 'found').length;
    const transactionReadMs = loads.reduce((total, load) => total + load.transactionReadMs, 0);
    const decodeMs = loads.reduce((total, load) => total + load.decodeMs, 0);
    return {
      requestedKeyCount: keys.length,
      foundCount,
      missingCount: keys.length - foundCount,
      queueWaitMs: 0,
      databaseMs: 0,
      transactionReadMs,
      decodeMs,
      totalWorkerMs: performance.now() - started,
      measurementStatus: {
        queueWaitMs: 'measured',
        databaseMs: 'unsupported',
        transactionReadMs: 'measured',
        decodeMs: 'measured',
        totalWorkerMs: 'measured',
      },
      codecs: {},
    };
  }

  evictSnapshot(key: string): void {
    this.snapshots.delete(key);
    this.missing.delete(key);
  }

  loadGameplaySnapshot(): unknown {
    this.assertReadable();
    return structuredClone(this.gameplaySnapshot);
  }

  loadGameCheckpoint() {
    this.assertReadable();
    return this.currentManifest ? { ...this.currentManifest.checkpoint } : null;
  }

  saveSnapshots(_snapshots: readonly ChunkSnapshot[]): never {
    throw new Error('文件存储只允许通过原子冻结快照 saveFrozenSnapshot 写入。');
  }

  saveGameplaySnapshot(_snapshot: GameplaySnapshot): never {
    throw new Error('文件存储只允许通过原子冻结快照 saveFrozenSnapshot 写入。');
  }

  saveFrozenSnapshot(snapshot: FrozenGameSaveSnapshot): Promise<void> {
    this.assertWritable();
    const frozen = cloneFrozenGameSaveSnapshot(snapshot, nodeCorePlatform.clone);
    this.validateFrozen(frozen);
    const operation = this.saveTail.then(() => {
      this.assertReadable();
      return this.publish(frozen);
    });
    this.saveTail = operation.catch(() => undefined);
    return operation;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const accepted = this.saveTail;
    this.closePromise = (async () => {
      await accepted;
      await Promise.all([...this.activeChunkLoads]);
      await this.lock.release();
      this.closed = true;
    })();
    return this.closePromise;
  }

  private validateFrozen(snapshot: FrozenGameSaveSnapshot): void {
    if (
      snapshot.version !== 1 ||
      snapshot.seedText !== this.options.seedText ||
      snapshot.generatorVersion !== this.options.generatorVersion
    )
      throw new TypeError('冻结快照的世界身份或版本不匹配。');
    if (
      snapshot.gameplay.version !== 3 ||
      snapshot.physicsSchema.version !== 1 ||
      snapshot.physicsSchema.bodyRegistryVersion !== 1 ||
      snapshot.fluidSchema.version !== 1 ||
      snapshot.fluidSchema.encoding !== 'chunk-level-source-byte' ||
      !Number.isSafeInteger(snapshot.commitSequence) ||
      snapshot.commitSequence < 0 ||
      !Number.isSafeInteger(snapshot.worldRevision) ||
      snapshot.worldRevision < 0
    )
      throw new TypeError('冻结快照的 schema 或 checkpoint 无效。');
    if (this.currentManifest && snapshot.commitSequence < this.currentManifest.checkpoint.commitSequence)
      throw new Error('拒绝用更旧的冻结检查点覆盖当前检查点。');
    const nextKeys = new Set(Object.keys(this.currentManifest?.chunks ?? {}));
    snapshot.chunks.forEach((chunk) => nextKeys.add(chunk.key));
    if (nextKeys.size > this.limits.maxChunks) throw new Error('Chunk 数量可能超过配置上限。');
    const keys = new Set<string>();
    for (const chunk of snapshot.chunks) {
      if (
        chunk.seedText !== snapshot.seedText ||
        chunk.generatorVersion !== snapshot.generatorVersion ||
        chunk.key !== chunkKey(chunk.cx, chunk.cy, chunk.cz) ||
        keys.has(chunk.key)
      )
        throw new TypeError(`冻结 Chunk 身份无效或重复：${chunk.key}`);
      keys.add(chunk.key);
    }
  }

  private async publish(snapshot: FrozenGameSaveSnapshot): Promise<void> {
    try {
      const chunks: Record<string, ChunkFileReference> = { ...(this.currentManifest?.chunks ?? {}) };
      const writtenSnapshots = new Map<string, ChunkSnapshot>();
      for (const chunk of snapshot.chunks) {
        const encoded = encodeChunkBlob(this.worldId, chunk);
        if (encoded.data.byteLength > this.limits.maxBlobBytes) throw new Error(`Chunk ${chunk.key} blob 超过上限。`);
        const hash = sha256(encoded.data);
        const path = `blobs/chunk-${hash}.json`;
        await writeImmutableFile(this.options.directory, path, encoded.data);
        chunks[chunk.key] = {
          path,
          bytes: encoded.data.byteLength,
          sha256: hash,
          key: chunk.key,
          cx: chunk.cx,
          cy: chunk.cy,
          cz: chunk.cz,
          revision: chunk.revision,
          codec: encoded.codec,
          ...(chunk.fluid ? { fluidVersion: 1 } : {}),
        };
        writtenSnapshots.set(chunk.key, cloneChunk(chunk));
      }
      this.inject('after-chunk-blobs');
      const gameplayData = Buffer.from(JSON.stringify(snapshot.gameplay));
      if (gameplayData.byteLength > this.limits.maxGameplayBytes) throw new Error('Gameplay blob 超过配置上限。');
      const gameplayHash = sha256(gameplayData);
      const gameplayPath = `blobs/gameplay-${gameplayHash}.json`;
      await writeImmutableFile(this.options.directory, gameplayPath, gameplayData);
      this.inject('after-gameplay-blob');

      const manifest: FileStoreManifest = {
        version: FILE_STORE_VERSION,
        worldId: this.worldId,
        seedText: snapshot.seedText,
        generatorVersion: snapshot.generatorVersion,
        gameSaveSchemaVersion: 1,
        gameplaySchemaVersion: 3,
        physicsSchema: { ...snapshot.physicsSchema },
        fluidSchema: { ...snapshot.fluidSchema },
        checkpoint: { commitSequence: snapshot.commitSequence, worldRevision: snapshot.worldRevision },
        gameplay: { path: gameplayPath, bytes: gameplayData.byteLength, sha256: gameplayHash },
        chunks,
      };
      if (Object.keys(chunks).length > this.limits.maxChunks) throw new Error('manifest Chunk 数量超过配置上限。');
      const manifestData = Buffer.from(JSON.stringify(manifest));
      if (manifestData.byteLength > this.limits.maxManifestBytes) throw new Error('manifest 超过配置上限。');
      const manifestHash = sha256(manifestData);
      if (this.currentManifest?.checkpoint.commitSequence === snapshot.commitSequence) {
        if (!this.currentPointer || manifestHash !== this.currentPointer.sha256)
          throw new Error('同一 commitSequence 只能重复发布内容完全相同的幂等检查点。');
        for (const [key, saved] of writtenSnapshots) {
          this.snapshots.set(key, saved);
          this.missing.delete(key);
        }
        return;
      }
      const manifestPath = `manifests/manifest-${snapshot.commitSequence}-${manifestHash}.json`;
      await writeImmutableFile(this.options.directory, manifestPath, manifestData);
      this.inject('after-manifest');

      if (this.currentPointer) {
        const previousData = Buffer.from(JSON.stringify(this.currentPointer));
        await replaceDurableFile(this.options.directory, 'PREVIOUS', previousData);
      }
      this.inject('after-previous-pointer');
      this.inject('before-current-pointer');
      const pointerData = encodePointer(manifestPath, manifestData, manifest.checkpoint);
      await replaceDurableFile(this.options.directory, 'CURRENT', pointerData);
      this.inject('after-current-pointer');

      this.currentPointer = JSON.parse(pointerData.toString('utf8')) as FileStorePointer;
      this.currentManifest = manifest;
      this.gameplaySnapshot = structuredClone(snapshot.gameplay);
      for (const [key, saved] of writtenSnapshots) {
        this.snapshots.set(key, saved);
        this.missing.delete(key);
      }
      await this.collectGarbage();
    } catch (error) {
      throw this.markFailed(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async collectGarbage(): Promise<void> {
    await Promise.all([...this.activeChunkLoads]);
    const reachable = new Set<string>();
    for (const pointerName of ['CURRENT', 'PREVIOUS'] as const) {
      if (!(await pointerExists(this.options.directory, pointerName))) continue;
      const loaded = await loadManifestFromPointer(
        this.options.directory,
        pointerName,
        { worldId: this.worldId, seedText: this.options.seedText, generatorVersion: this.options.generatorVersion },
        this.limits,
        { validateChunkContents: false },
      );
      reachable.add(loaded.pointer.manifest);
      reachable.add(loaded.manifest.gameplay.path);
      for (const reference of Object.values(loaded.manifest.chunks)) reachable.add(reference.path);
    }
    await this.removeUnreachableKnownFiles('blobs', knownBlobName, reachable);
    await this.removeUnreachableKnownFiles('manifests', knownManifestName, reachable);
  }

  private async removeUnreachableKnownFiles(
    directoryName: 'blobs' | 'manifests',
    pattern: RegExp,
    reachable: ReadonlySet<string>,
  ): Promise<void> {
    const directory = join(this.options.directory, directoryName);
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error(`持久化子目录类型无效，拒绝回收：${directoryName}`);
    let removed = false;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      const relativePath = `${directoryName}/${entry.name}`;
      if (reachable.has(relativePath)) continue;
      try {
        await unlink(join(directory, entry.name));
        removed = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (removed) await syncDirectory(directory);
  }

  private inject(stage: FileGamePersistenceFaultStage): void {
    this.options.faultInjector?.(stage);
  }

  private markFailed(error: Error): Error {
    this.failure ??= error;
    return error;
  }

  private assertReadable(): void {
    if (this.closed) throw new Error('文件持久化实例已关闭。');
    if (this.failure) throw new Error('文件持久化已进入失败状态。', { cause: this.failure });
  }

  private assertWritable(): void {
    this.assertReadable();
    if (this.closing) throw new Error('文件持久化实例正在关闭，不能接纳新写入。');
  }
}
