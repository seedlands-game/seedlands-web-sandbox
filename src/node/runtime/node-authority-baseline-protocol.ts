import { chunkKey } from '../../world/voxel';
import type { AuthorityBaselineCaptureResult } from '../../server/authority/authority-baseline-capture-types';

export const AUTHORITY_BASELINE_KINDS = [
  'authority-capture-mesh-baseline',
  'authority-capture-collision-baseline',
  'authority-cancel-baseline-capture',
] as const;

const MESH_KIND = AUTHORITY_BASELINE_KINDS[0];
const CANCEL_KIND = AUTHORITY_BASELINE_KINDS[2];
const MESH_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const COLLISION_RESPONSE_BYTES = 128 * 1_024;
const CANCEL_RESPONSE_BYTES = 1_024;

function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Authority capture 必须是对象。');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key)))
    throw new TypeError('Authority capture 字段无效。');
  return value as Record<string, unknown>;
}

function integer(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Authority capture 编号或 revision 无效。');
}

function coordinates(value: unknown): [number, number, number] {
  if (typeof value !== 'string' || value.length > 96) throw new TypeError('Authority capture key 无效。');
  const result = value.split(',').map(Number);
  if (
    result.length !== 3 ||
    !result.every(Number.isSafeInteger) ||
    chunkKey(result[0]!, result[1]!, result[2]!) !== value
  )
    throw new TypeError('Authority capture key 非 canonical。');
  return result as [number, number, number];
}

function purpose(kind: string): 'mesh' | 'collision-resync' {
  return kind === MESH_KIND ? 'mesh' : 'collision-resync';
}

function expectedKeys(key: unknown, mesh: boolean): string[] {
  const [cx, cy, cz] = coordinates(key);
  const keys = [key as string];
  if (mesh) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const [x, y, z] = [cx + dx, cy + dy, cz + dz];
          if (![x, y, z].every(Number.isSafeInteger)) throw new RangeError('Authority capture 邻域坐标溢出。');
          if (x !== cx || y !== cy || z !== cz) keys.push(chunkKey(x, y, z));
        }
      }
    }
  }
  return keys;
}

export function validateAuthorityBaselineRequest(kind: string, value: unknown): void {
  const request = object(
    value,
    kind === CANCEL_KIND ? ['captureId'] : ['captureId', 'purpose', 'key', 'minimumRevision'],
  );
  integer(request.captureId);
  if (kind === CANCEL_KIND) return;
  if (request.purpose !== purpose(kind)) throw new TypeError('Authority capture purpose 与 operation 不匹配。');
  integer(request.minimumRevision);
  expectedKeys(request.key, kind === MESH_KIND);
}

export function validateAuthorityBaselineResponse(kind: string, value: unknown): void {
  if (kind === CANCEL_KIND) {
    const result = object(value, ['captureId', 'captureGeneration', 'status']);
    integer(result.captureId);
    if (result.status === 'unknown') {
      if (result.captureGeneration !== null) throw new TypeError('Authority capture unknown generation 必须为空。');
    } else {
      if (result.status !== 'cancelled' && result.status !== 'already-settled')
        throw new TypeError('Authority capture cancel status 无效。');
      integer(result.captureGeneration);
    }
    return;
  }
  const available = !!value && typeof value === 'object' && 'status' in value && value.status === 'available';
  const result = object(value, [
    'status',
    'captureId',
    'captureGeneration',
    'purpose',
    'key',
    ...(available ? ['checkpoint', 'entries'] : ['reason']),
  ]);
  integer(result.captureId);
  integer(result.captureGeneration);
  if (result.purpose !== purpose(kind)) throw new TypeError('Authority capture response purpose 无效。');
  const keys = expectedKeys(result.key, kind === MESH_KIND);
  if (!available) {
    if (
      result.status !== 'unavailable' ||
      !['cancelled', 'not-available', 'residency-pressure', 'superseded', 'stopping'].includes(result.reason as string)
    )
      throw new TypeError('Authority capture unavailable reason 无效。');
    return;
  }
  const checkpoint = object(result.checkpoint, ['epoch', 'physicsTick', 'commitSequence', 'worldRevision']);
  if (typeof checkpoint.epoch !== 'string' || !checkpoint.epoch.trim())
    throw new TypeError('Authority capture checkpoint epoch 无效。');
  integer(checkpoint.physicsTick);
  integer(checkpoint.commitSequence);
  integer(checkpoint.worldRevision);
  if (!Array.isArray(result.entries) || result.entries.length !== keys.length)
    throw new TypeError('Authority capture entries 数量无效。');
  const arrayKeys = Reflect.ownKeys(result.entries);
  if (
    arrayKeys.length !== keys.length + 1 ||
    arrayKeys.some(
      (key) =>
        key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= keys.length),
    )
  )
    throw new TypeError('Authority capture entries 必须是无扩展的密集数组。');
  const buffers = new Set<ArrayBuffer>();
  let generatorVersion: number | undefined;
  for (let index = 0; index < keys.length; index += 1) {
    const entry = object(result.entries[index], [
      'role',
      'key',
      'chunkRevision',
      'generatorVersion',
      'canonical',
      'fluid',
    ]);
    const role = kind === MESH_KIND ? (index === 0 ? 'main' : 'overlay') : 'collision-resync';
    if (entry.key !== keys[index] || entry.role !== role)
      throw new TypeError('Authority capture entries key/role/order 无效。');
    integer(entry.chunkRevision);
    integer(entry.generatorVersion);
    generatorVersion ??= entry.generatorVersion;
    if (entry.generatorVersion !== generatorVersion) throw new TypeError('Authority capture generatorVersion 不一致。');
    for (const [field, length] of [
      ['canonical', 65_536],
      ['fluid', 32_768],
    ] as const) {
      const buffer = entry[field];
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== length || buffers.has(buffer))
        throw new TypeError('Authority capture 必须携带独立完整 ArrayBuffer。');
      buffers.add(buffer);
    }
  }
}

export function authorityBaselineCaptureTransfer(result: AuthorityBaselineCaptureResult): readonly ArrayBuffer[] {
  return result.status === 'available' ? result.entries.flatMap((entry) => [entry.canonical, entry.fluid]) : [];
}

export function authorityCaptureDispatchOrderKey(kind: string): string | undefined {
  return kind === MESH_KIND || kind === AUTHORITY_BASELINE_KINDS[1] ? 'authority-baseline-capture' : undefined;
}

/** 超大 identity 导致结果超过固定保留时按预算拒绝，不截断，也不放宽控制 RPC 上限。 */
export function reserveAuthorityResponseBytes(kind: string, maxResponseBytes: number): number {
  const requested =
    kind === MESH_KIND
      ? MESH_RESPONSE_BYTES
      : kind === CANCEL_KIND
        ? CANCEL_RESPONSE_BYTES
        : kind === AUTHORITY_BASELINE_KINDS[1]
          ? COLLISION_RESPONSE_BYTES
          : maxResponseBytes;
  return Math.min(requested, maxResponseBytes);
}
