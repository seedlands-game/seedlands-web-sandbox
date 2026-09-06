import type { ChunkSnapshot } from '../../server/persistence/chunk-persistence';
import { isValidChunkSnapshot } from '../../server/persistence/validate-chunk-snapshot';
import {
  createStoredChunkRecord,
  decodeStoredChunkRecord,
  type ChunkRecordCodec,
  type StoredChunkRecord,
  validateStoredFluid,
} from '../../world/chunk-snapshot-codec';
import { makeChunk } from '../../world/chunk-generation';
import { normalizeSeed } from '../../world/voxel';

type SerializedChunkBlob = Readonly<{
  version: 1;
  worldId: string;
  seedText: string;
  cx: number;
  cy: number;
  cz: number;
  revision: number;
  formatVersion: 1;
  voxelSchemaVersion: 1;
  generatorVersion: number;
  codec: ChunkRecordCodec;
  payload: string;
  payloadBytes: number;
  payloadChecksum: number;
  proceduralBaseSignature?: number;
  fluidVersion?: 1;
  fluid?: string;
  fluidChecksum?: number;
}>;

export function encodeChunkBlob(worldId: string, snapshot: ChunkSnapshot): { data: Buffer; codec: ChunkRecordCodec } {
  if (
    !isValidChunkSnapshot(snapshot, {
      seedText: snapshot.seedText,
      generatorVersion: snapshot.generatorVersion,
      key: snapshot.key,
      cx: snapshot.cx,
      cy: snapshot.cy,
      cz: snapshot.cz,
    })
  )
    throw new TypeError(`Chunk 快照无效：${snapshot.key}`);
  const record = createStoredChunkRecord({
    worldId,
    seedText: snapshot.seedText,
    cx: snapshot.cx,
    cy: snapshot.cy,
    cz: snapshot.cz,
    revision: snapshot.revision,
    formatVersion: 1,
    voxelSchemaVersion: 1,
    generatorVersion: snapshot.generatorVersion,
    voxels: snapshot.voxels,
    proceduralVoxels: makeChunk(
      normalizeSeed(snapshot.seedText),
      snapshot.cx,
      snapshot.cy,
      snapshot.cz,
      [],
      snapshot.generatorVersion,
    ),
    fluid: snapshot.fluid,
  });
  const serialized: SerializedChunkBlob = {
    version: 1,
    worldId: record.worldId,
    seedText: record.seedText,
    cx: record.cx,
    cy: record.cy,
    cz: record.cz,
    revision: record.revision,
    formatVersion: 1,
    voxelSchemaVersion: 1,
    generatorVersion: record.generatorVersion,
    codec: record.codec,
    payload: Buffer.from(record.payload).toString('base64'),
    payloadBytes: record.payloadBytes,
    payloadChecksum: record.payloadChecksum,
    ...(record.proceduralBaseSignature === undefined
      ? {}
      : { proceduralBaseSignature: record.proceduralBaseSignature }),
    ...(record.fluidVersion === undefined ? {} : { fluidVersion: record.fluidVersion }),
    ...(record.fluid ? { fluid: Buffer.from(record.fluid).toString('base64') } : {}),
    ...(record.fluidChecksum === undefined ? {} : { fluidChecksum: record.fluidChecksum }),
  };
  return { data: Buffer.from(JSON.stringify(serialized)), codec: record.codec };
}

function parseBlob(data: Uint8Array): SerializedChunkBlob {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(data).toString('utf8'));
  } catch (error) {
    throw new Error('Chunk blob JSON 损坏。', { cause: error });
  }
  const blob = value as Partial<SerializedChunkBlob>;
  if (
    blob.version !== 1 ||
    blob.formatVersion !== 1 ||
    blob.voxelSchemaVersion !== 1 ||
    typeof blob.worldId !== 'string' ||
    typeof blob.seedText !== 'string' ||
    !Number.isSafeInteger(blob.cx) ||
    !Number.isSafeInteger(blob.cy) ||
    !Number.isSafeInteger(blob.cz) ||
    !Number.isSafeInteger(blob.revision) ||
    blob.revision! < 0 ||
    !Number.isSafeInteger(blob.generatorVersion) ||
    !['procedural-diff-v1', 'palette-bitpack-v1', 'raw-u16-v1'].includes(blob.codec ?? '') ||
    typeof blob.payload !== 'string' ||
    !Number.isSafeInteger(blob.payloadBytes) ||
    !Number.isSafeInteger(blob.payloadChecksum)
  )
    throw new Error('Chunk blob 元数据损坏或版本不受支持。');
  return blob as SerializedChunkBlob;
}

export function inspectChunkBlob(data: Uint8Array): Omit<SerializedChunkBlob, 'payload' | 'fluid'> {
  const metadata = { ...parseBlob(data) } as Record<string, unknown>;
  delete metadata.payload;
  delete metadata.fluid;
  return metadata as Omit<SerializedChunkBlob, 'payload' | 'fluid'>;
}

export function decodeChunkBlob(
  data: Uint8Array,
  expected: {
    worldId: string;
    seedText: string;
    generatorVersion: number;
    key: string;
    cx: number;
    cy: number;
    cz: number;
  },
): ChunkSnapshot {
  const blob = parseBlob(data);
  const payload = Buffer.from(blob.payload, 'base64');
  const fluid = blob.fluid === undefined ? undefined : Buffer.from(blob.fluid, 'base64');
  const record: StoredChunkRecord = {
    worldId: blob.worldId,
    seedText: blob.seedText,
    cx: blob.cx,
    cy: blob.cy,
    cz: blob.cz,
    revision: blob.revision,
    formatVersion: blob.formatVersion,
    voxelSchemaVersion: blob.voxelSchemaVersion,
    generatorVersion: blob.generatorVersion,
    codec: blob.codec,
    payload,
    payloadBytes: blob.payloadBytes,
    payloadChecksum: blob.payloadChecksum,
    ...(blob.proceduralBaseSignature === undefined ? {} : { proceduralBaseSignature: blob.proceduralBaseSignature }),
    ...(blob.fluidVersion === undefined ? {} : { fluidVersion: blob.fluidVersion }),
    ...(fluid ? { fluid } : {}),
    ...(blob.fluidChecksum === undefined ? {} : { fluidChecksum: blob.fluidChecksum }),
  };
  const proceduralVoxels = makeChunk(
    normalizeSeed(expected.seedText),
    expected.cx,
    expected.cy,
    expected.cz,
    [],
    expected.generatorVersion,
  );
  const voxels = decodeStoredChunkRecord(record, {
    worldId: expected.worldId,
    seedText: expected.seedText,
    cx: expected.cx,
    cy: expected.cy,
    cz: expected.cz,
    revision: blob.revision,
    formatVersion: 1,
    voxelSchemaVersion: 1,
    generatorVersion: expected.generatorVersion,
    proceduralVoxels,
  });
  const validatedFluid = validateStoredFluid(record);
  const snapshot: ChunkSnapshot = {
    key: expected.key,
    seedText: expected.seedText,
    cx: expected.cx,
    cy: expected.cy,
    cz: expected.cz,
    revision: blob.revision,
    generatorVersion: expected.generatorVersion,
    voxels,
    ...(validatedFluid ? { fluidVersion: 1, fluid: validatedFluid } : {}),
  };
  if (!isValidChunkSnapshot(snapshot, expected)) throw new Error(`Chunk blob 解码结果无效：${expected.key}`);
  return snapshot;
}
