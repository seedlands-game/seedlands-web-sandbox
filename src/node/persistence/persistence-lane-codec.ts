import type { NodeRpcPayload } from '../runtime/node-rpc-contract';
import { measureNodeRpcBytes } from '../runtime/node-rpc-bytes';
import { readGameSaveCheckpoint } from '../../server/persistence/game-save-checkpoint';
import { chunkKey } from '../../world/voxel';
import {
  PERSISTENCE_LANE_PROTOCOL_VERSION,
  type PersistenceEnsureResult,
  type PersistenceLaneIdentity,
  type PersistenceLaneRequestKind,
} from './persistence-lane-protocol';

function identity(value: unknown): PersistenceLaneIdentity {
  const candidate = value as Partial<PersistenceLaneIdentity>;
  if (
    !candidate ||
    typeof candidate.worldId !== 'string' ||
    typeof candidate.seedText !== 'string' ||
    !Number.isSafeInteger(candidate.generatorVersion) ||
    candidate.generatorVersion! < 1
  )
    throw new TypeError('Persistence lane 世界身份无效。');
  return candidate as PersistenceLaneIdentity;
}

function coordinates(value: unknown): { key: string; cx: number; cy: number; cz: number } {
  const candidate = value as { key?: unknown; cx?: unknown; cy?: unknown; cz?: unknown };
  if (
    !candidate ||
    typeof candidate.key !== 'string' ||
    !Number.isSafeInteger(candidate.cx) ||
    !Number.isSafeInteger(candidate.cy) ||
    !Number.isSafeInteger(candidate.cz) ||
    candidate.key !== chunkKey(candidate.cx as number, candidate.cy as number, candidate.cz as number)
  )
    throw new TypeError('Persistence lane Chunk 坐标无效。');
  return candidate as { key: string; cx: number; cy: number; cz: number };
}

function ensureResult(value: unknown): PersistenceEnsureResult {
  const result = value as Partial<PersistenceEnsureResult>;
  if (!result || typeof result.key !== 'string' || (result.status !== 'found' && result.status !== 'missing'))
    throw new TypeError('Persistence lane prepare 回复无效。');
  if (result.status === 'missing') {
    if (result.snapshot !== undefined) throw new TypeError('Persistence lane missing 回复不能携带快照。');
    return result as PersistenceEnsureResult;
  }
  const snapshot = result.snapshot;
  if (
    !snapshot ||
    !(snapshot.voxels instanceof Uint16Array) ||
    (snapshot.fluid !== undefined && !(snapshot.fluid instanceof Uint8Array)) ||
    snapshot.key !== result.key
  )
    throw new TypeError('Persistence lane found 回复未携带有效 TypedArray 快照。');
  coordinates(snapshot);
  return result as PersistenceEnsureResult;
}

function loadDiagnostics(value: unknown): void {
  const diagnostics = value as Record<string, unknown>;
  const numericFields = [
    'requestedKeyCount',
    'foundCount',
    'missingCount',
    'queueWaitMs',
    'databaseMs',
    'transactionReadMs',
    'decodeMs',
    'totalWorkerMs',
  ];
  if (
    !diagnostics ||
    numericFields.some(
      (field) =>
        typeof diagnostics[field] !== 'number' || !Number.isFinite(diagnostics[field]) || diagnostics[field] < 0,
    )
  )
    throw new TypeError('Persistence lane neighborhood 计时字段无效。');
  const status = diagnostics.measurementStatus as Record<string, unknown>;
  const required = ['queueWaitMs', 'databaseMs', 'transactionReadMs', 'decodeMs', 'totalWorkerMs'];
  if (
    !status ||
    required.some(
      (field) => status[field] !== 'measured' && status[field] !== 'not-collected' && status[field] !== 'unsupported',
    )
  )
    throw new TypeError('Persistence lane neighborhood measurementStatus 无效。');
}

function requestValue(kind: PersistenceLaneRequestKind, value: unknown): unknown {
  if (kind === 'persistence-open') {
    const request = value as { version?: unknown; identity?: unknown };
    if (request?.version !== PERSISTENCE_LANE_PROTOCOL_VERSION) throw new TypeError('Persistence lane 版本无效。');
    identity(request.identity);
    return value;
  }
  if (kind === 'persistence-ensure') {
    coordinates(value);
    return value;
  }
  if (kind === 'persistence-ensure-neighborhood') {
    const request = value as { cx?: unknown; cy?: unknown; cz?: unknown; residentKeys?: unknown };
    if (
      !request ||
      !Number.isSafeInteger(request.cx) ||
      !Number.isSafeInteger(request.cy) ||
      !Number.isSafeInteger(request.cz) ||
      !Array.isArray(request.residentKeys) ||
      request.residentKeys.length > 27 ||
      request.residentKeys.some((key) => typeof key !== 'string')
    )
      throw new TypeError('Persistence lane neighborhood 请求无效。');
    return value;
  }
  if (kind === 'persistence-save-frozen') {
    const snapshot = (value as { snapshot?: unknown })?.snapshot as {
      version?: unknown;
      commitSequence?: unknown;
      worldRevision?: unknown;
      chunks?: unknown;
    };
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      !Number.isSafeInteger(snapshot.commitSequence) ||
      !Number.isSafeInteger(snapshot.worldRevision) ||
      !Array.isArray(snapshot.chunks)
    )
      throw new TypeError('Persistence lane save 请求无效。');
    return value;
  }
  if (kind === 'persistence-inspect-previous' || kind === 'persistence-close') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('Persistence lane 空请求无效。');
    return value;
  }
  throw new TypeError(`Persistence lane 请求 kind 不受支持：${kind}`);
}

function responseValue(kind: PersistenceLaneRequestKind, value: unknown): unknown {
  if (kind === 'persistence-open') {
    const response = value as { version?: unknown; identity?: unknown; checkpoint?: unknown };
    if (response?.version !== PERSISTENCE_LANE_PROTOCOL_VERSION) throw new TypeError('Persistence lane 版本无效。');
    identity(response.identity);
    readGameSaveCheckpoint(response.checkpoint);
    return value;
  }
  if (kind === 'persistence-ensure') return ensureResult(value);
  if (kind === 'persistence-ensure-neighborhood') {
    const response = value as { entries?: unknown; diagnostics?: unknown };
    if (!Array.isArray(response?.entries) || response.entries.length !== 27 || !response.diagnostics)
      throw new TypeError('Persistence lane neighborhood 回复无效。');
    response.entries.forEach(ensureResult);
    loadDiagnostics(response.diagnostics);
    return value;
  }
  if (kind === 'persistence-save-frozen') {
    const response = value as { checkpoint?: unknown };
    if (!readGameSaveCheckpoint(response?.checkpoint)) throw new TypeError('Persistence lane save ACK 无效。');
    return value;
  }
  if (kind === 'persistence-inspect-previous') {
    const response = value as { inspection?: unknown };
    if (!response || !Object.hasOwn(response, 'inspection'))
      throw new TypeError('Persistence lane previous checkpoint 回复无效。');
    return value;
  }
  if (kind === 'persistence-close') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('Persistence lane close 回复无效。');
    return value;
  }
  throw new TypeError(`Persistence lane 回复 kind 不受支持：${kind}`);
}

export function validatePersistenceLaneRequest(kind: string, value: unknown): NodeRpcPayload {
  const validated = requestValue(kind as PersistenceLaneRequestKind, value);
  return { value: validated, bytes: measureNodeRpcBytes(validated) };
}

export function validatePersistenceLaneResponse(kind: string, value: unknown): NodeRpcPayload {
  const validated = responseValue(kind as PersistenceLaneRequestKind, value);
  return { value: validated, bytes: measureNodeRpcBytes(validated) };
}
