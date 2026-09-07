import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readGameSaveCheckpoint } from '@seedlands/game-core/server/persistence/game-save-checkpoint';
import { chunkKey } from '@seedlands/game-core/world/voxel';
import { readBoundedFile } from './durable-files';
import { inspectChunkBlob } from './file-chunk-blob';
import {
  FILE_STORE_VERSION,
  type ChunkFileReference,
  type FileReference,
  type FileStoreLimits,
  type FileStoreManifest,
  type FileStorePointer,
} from './file-store-types';

export const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

const hashPattern = /^[a-f0-9]{64}$/;
const blobPathPattern = /^blobs\/(?:chunk|gameplay)-[a-f0-9]{64}\.json$/;
const manifestPathPattern = /^manifests\/manifest-[0-9]+-[a-f0-9]{64}\.json$/;

function parseJson(data: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(data).toString('utf8'));
  } catch (error) {
    throw new Error(`${label} JSON 损坏。`, { cause: error });
  }
}

function assertReference(
  reference: Partial<FileReference>,
  pathPattern: RegExp,
  label: string,
): asserts reference is FileReference {
  if (
    typeof reference.path !== 'string' ||
    !pathPattern.test(reference.path) ||
    !Number.isSafeInteger(reference.bytes) ||
    reference.bytes! < 1 ||
    typeof reference.sha256 !== 'string' ||
    !hashPattern.test(reference.sha256)
  )
    throw new Error(`${label} 引用格式无效。`);
}

async function readReferencedFile(
  root: string,
  reference: FileReference,
  maximumBytes: number,
  label: string,
): Promise<Buffer> {
  if (reference.bytes > maximumBytes) throw new Error(`${label} 长度超过配置上限。`);
  const data = await readBoundedFile(join(root, reference.path), maximumBytes);
  if (data.byteLength !== reference.bytes) throw new Error(`${label} length 与 manifest 不一致。`);
  if (sha256(data) !== reference.sha256) throw new Error(`${label} hash 损坏。`);
  return data;
}

function parsePointer(data: Uint8Array): FileStorePointer {
  const value = parseJson(data, '检查点指针') as Partial<FileStorePointer>;
  if (value.version !== FILE_STORE_VERSION) throw new Error('检查点指针版本不受支持。');
  const reference = { path: value.manifest, bytes: value.bytes, sha256: value.sha256 };
  assertReference(reference, manifestPathPattern, 'manifest');
  const checkpoint = readGameSaveCheckpoint(value.checkpoint);
  if (!checkpoint) throw new Error('检查点指针缺少 checkpoint。');
  return { version: 1, manifest: reference.path, bytes: reference.bytes, sha256: reference.sha256, checkpoint };
}

function validateManifestHeader(
  value: unknown,
  identity: { worldId: string; seedText: string; generatorVersion: number },
  limits: FileStoreLimits,
): FileStoreManifest {
  const manifest = value as Partial<FileStoreManifest>;
  if (
    manifest.version !== FILE_STORE_VERSION ||
    manifest.worldId !== identity.worldId ||
    manifest.seedText !== identity.seedText ||
    manifest.generatorVersion !== identity.generatorVersion
  )
    throw new Error('manifest 世界身份或版本不匹配。');
  if (
    manifest.gameSaveSchemaVersion !== 1 ||
    manifest.gameplaySchemaVersion !== 3 ||
    manifest.physicsSchema?.version !== 1 ||
    manifest.physicsSchema.bodyRegistryVersion !== 1 ||
    manifest.fluidSchema?.version !== 1 ||
    manifest.fluidSchema.encoding !== 'chunk-level-source-byte'
  )
    throw new Error('manifest schema 版本不受支持。');
  const checkpoint = readGameSaveCheckpoint(manifest.checkpoint);
  if (!checkpoint) throw new Error('manifest 缺少 checkpoint。');
  if (!manifest.gameplay || typeof manifest.gameplay !== 'object') throw new Error('manifest 缺少 Gameplay 引用。');
  assertReference(manifest.gameplay, blobPathPattern, 'Gameplay blob');
  if (!manifest.chunks || typeof manifest.chunks !== 'object' || Array.isArray(manifest.chunks))
    throw new Error('manifest Chunk 索引无效。');
  if (Object.keys(manifest.chunks).length > limits.maxChunks) throw new Error('manifest Chunk 数量超过配置上限。');
  return { ...(manifest as FileStoreManifest), checkpoint };
}

async function validateChunkReference(
  root: string,
  key: string,
  reference: ChunkFileReference,
  manifest: FileStoreManifest,
  limits: FileStoreLimits,
): Promise<void> {
  assertReference(reference, blobPathPattern, `Chunk ${key}`);
  if (
    reference.key !== key ||
    key !== chunkKey(reference.cx, reference.cy, reference.cz) ||
    !Number.isSafeInteger(reference.cx) ||
    !Number.isSafeInteger(reference.cy) ||
    !Number.isSafeInteger(reference.cz) ||
    !Number.isSafeInteger(reference.revision) ||
    reference.revision < 0 ||
    !['procedural-diff-v1', 'palette-bitpack-v1', 'raw-u16-v1'].includes(reference.codec)
  )
    throw new Error(`Chunk ${key} manifest 元数据无效。`);
  const data = await readReferencedFile(root, reference, limits.maxBlobBytes, `Chunk ${key}`);
  const metadata = inspectChunkBlob(data);
  if (
    metadata.worldId !== manifest.worldId ||
    metadata.seedText !== manifest.seedText ||
    metadata.generatorVersion !== manifest.generatorVersion ||
    metadata.cx !== reference.cx ||
    metadata.cy !== reference.cy ||
    metadata.cz !== reference.cz ||
    metadata.revision !== reference.revision ||
    metadata.codec !== reference.codec ||
    metadata.fluidVersion !== reference.fluidVersion
  )
    throw new Error(`Chunk ${key} blob 身份与 manifest 不一致。`);
}

export async function loadManifestFromPointer(
  root: string,
  pointerName: 'CURRENT' | 'PREVIOUS',
  identity: { worldId: string; seedText: string; generatorVersion: number },
  limits: FileStoreLimits,
): Promise<{ pointer: FileStorePointer; manifest: FileStoreManifest; gameplay: unknown }> {
  const pointer = parsePointer(await readBoundedFile(join(root, pointerName), 64 * 1_024));
  const manifestData = await readReferencedFile(
    root,
    { path: pointer.manifest, bytes: pointer.bytes, sha256: pointer.sha256 },
    limits.maxManifestBytes,
    'manifest',
  );
  const manifest = validateManifestHeader(parseJson(manifestData, 'manifest'), identity, limits);
  if (
    manifest.checkpoint.commitSequence !== pointer.checkpoint.commitSequence ||
    manifest.checkpoint.worldRevision !== pointer.checkpoint.worldRevision
  )
    throw new Error('CURRENT checkpoint 与 manifest 不一致。');
  const gameplayData = await readReferencedFile(root, manifest.gameplay, limits.maxGameplayBytes, 'Gameplay blob');
  const gameplay = parseJson(gameplayData, 'Gameplay blob');
  if ((gameplay as { version?: unknown })?.version !== manifest.gameplaySchemaVersion)
    throw new Error('Gameplay blob schema 与 manifest 不一致。');
  for (const [key, reference] of Object.entries(manifest.chunks))
    await validateChunkReference(root, key, reference, manifest, limits);
  return { pointer, manifest, gameplay };
}

export async function pointerExists(root: string, name: 'CURRENT' | 'PREVIOUS'): Promise<boolean> {
  try {
    await lstat(join(root, name));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function encodePointer(
  manifestPath: string,
  manifestData: Uint8Array,
  checkpoint: FileStorePointer['checkpoint'],
): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: FILE_STORE_VERSION,
      manifest: manifestPath,
      bytes: manifestData.byteLength,
      sha256: sha256(manifestData),
      checkpoint,
    }),
  );
}
