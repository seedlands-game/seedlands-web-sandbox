import {
  authorityBaselineCaptureKeys,
  parseAuthorityChunkKey,
} from '@seedlands/game-core/server/authority/authority-baseline-capture';
import {
  NETWORK_REFERENCE_BASELINE_CELL_COUNT,
  type BaselineEntryDescriptorReference,
  type ReassembledBaselineReference,
} from '@seedlands/game-core/server/protocol/network-reference-baseline-types';
import type { InterestSessionRef } from '@seedlands/game-core/server/protocol/network-reference-interest-control';
import type {
  NetworkBaselineConsumerLimits,
  NetworkBaselineOwnerRef,
  NetworkBaselineWorkerResultIdentity,
} from './network-baseline-consumer-types';

const CANONICAL_BYTES = NETWORK_REFERENCE_BASELINE_CELL_COUNT * 2;
const FLUID_BYTES = NETWORK_REFERENCE_BASELINE_CELL_COUNT;

export type ValidatedBaselineEntry = Readonly<{
  descriptor: BaselineEntryDescriptorReference;
  canonicalLittleEndian: Uint8Array;
  fluid: Uint8Array;
}>;

type UnknownRecord = Record<string, unknown>;

function exactRecord(value: unknown, fields: readonly string[], label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key)))
    throw new TypeError(`${label} contains unknown or missing fields.`);
  return value as UnknownRecord;
}

function denseArray(value: unknown, length: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`${label} must contain ${length} items.`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)
      throw new TypeError(`${label} must be dense and contain no extension fields.`);
  }
  for (let index = 0; index < length; index += 1) if (!(index in value)) throw new TypeError(`${label} must be dense.`);
  return value;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new TypeError(`${label} must be a safe integer at least ${minimum}.`);
  return Object.is(value, -0) ? 0 : value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256)
    throw new TypeError(`${label} must be non-empty text of at most 256 code units.`);
  return value;
}

function copyRef(value: unknown): InterestSessionRef {
  const source = exactRecord(value, ['epoch', 'serverEpoch', 'sessionId', 'worldId'], 'owner ref');
  return Object.freeze({
    epoch: text(source.epoch, 'owner ref.epoch'),
    serverEpoch: text(source.serverEpoch, 'owner ref.serverEpoch'),
    sessionId: text(source.sessionId, 'owner ref.sessionId'),
    worldId: text(source.worldId, 'owner ref.worldId'),
  });
}

export function sameConsumerRef(left: InterestSessionRef, right: InterestSessionRef): boolean {
  return (
    left.epoch === right.epoch &&
    left.serverEpoch === right.serverEpoch &&
    left.sessionId === right.sessionId &&
    left.worldId === right.worldId
  );
}

export function copyNetworkBaselineLimits(value: NetworkBaselineConsumerLimits): NetworkBaselineConsumerLimits {
  const source = exactRecord(
    value,
    ['ownersMax', 'sharedCollisionBytesMax', 'sharedPreparationBytesMax', 'workerTransferBytesMax'],
    'network baseline consumer limits',
  );
  return Object.freeze({
    ownersMax: safeInteger(source.ownersMax, 'ownersMax', 1),
    sharedCollisionBytesMax: safeInteger(source.sharedCollisionBytesMax, 'sharedCollisionBytesMax', 1),
    sharedPreparationBytesMax: safeInteger(source.sharedPreparationBytesMax, 'sharedPreparationBytesMax', 1),
    workerTransferBytesMax: safeInteger(source.workerTransferBytesMax, 'workerTransferBytesMax', 1),
  });
}

export function copyNetworkBaselineOwner(value: NetworkBaselineOwnerRef): NetworkBaselineOwnerRef {
  const source = exactRecord(
    value,
    [
      'ref',
      'ownerId',
      'ownerGeneration',
      'requestId',
      'interestId',
      'purpose',
      'key',
      'generatorVersion',
      'expectedEntries',
    ],
    'network baseline owner',
  );
  const purpose = source.purpose;
  if (purpose !== 'mesh' && purpose !== 'collision-resync')
    throw new TypeError('Network baseline owner purpose is invalid.');
  const key = text(source.key, 'network baseline owner key');
  parseAuthorityChunkKey(key);
  const expectedLength = purpose === 'mesh' ? 27 : 1;
  const entries = denseArray(source.expectedEntries, expectedLength, 'network baseline expected entries').map(
    (entry, index) => {
      const item = exactRecord(entry, ['key', 'minimumRevision'], `expected entry[${index}]`);
      const entryKey = text(item.key, `expected entry[${index}].key`);
      parseAuthorityChunkKey(entryKey);
      return Object.freeze({
        key: entryKey,
        minimumRevision: safeInteger(item.minimumRevision, `expected entry[${index}].minimumRevision`),
      });
    },
  );
  const expectedKeys = authorityBaselineCaptureKeys({
    captureId: 0,
    purpose,
    key,
    minimumRevision: entries[0]!.minimumRevision,
  });
  const orderedKeys = purpose === 'mesh' ? [key, ...expectedKeys.filter((candidate) => candidate !== key)] : [key];
  if (entries.some((entry, index) => entry.key !== orderedKeys[index]))
    throw new TypeError('Network baseline expected entry order is invalid.');
  const interestId = source.interestId === null ? null : safeInteger(source.interestId, 'owner interestId');
  if (purpose === 'mesh' && interestId === null) throw new TypeError('Mesh owner requires an interestId.');
  return Object.freeze({
    ref: copyRef(source.ref),
    ownerId: safeInteger(source.ownerId, 'ownerId'),
    ownerGeneration: safeInteger(source.ownerGeneration, 'ownerGeneration'),
    requestId: safeInteger(source.requestId, 'owner requestId'),
    interestId,
    purpose,
    key,
    generatorVersion: safeInteger(source.generatorVersion, 'owner generatorVersion', 1),
    expectedEntries: Object.freeze(entries),
  });
}

function assertEntryDescriptor(value: BaselineEntryDescriptorReference, index: number): void {
  exactRecord(
    value,
    ['entryId', 'role', 'key', 'chunkRevision', 'generatorVersion', 'blocks'],
    `descriptor entry[${index}]`,
  );
  const blocks = denseArray(value.blocks, 2, `descriptor entry[${index}].blocks`);
  if (
    blocks[0] !== value.blocks[0] ||
    value.blocks[0].name !== 'canonical' ||
    value.blocks[0].byteLength !== CANONICAL_BYTES ||
    value.blocks[1].name !== 'fluid' ||
    value.blocks[1].byteLength !== FLUID_BYTES
  )
    throw new TypeError(`descriptor entry[${index}] block identity is invalid.`);
}

export function validateConsumerBundle(
  bundle: ReassembledBaselineReference,
  owner: NetworkBaselineOwnerRef,
): readonly ValidatedBaselineEntry[] | null {
  exactRecord(bundle, ['descriptor', 'entries'], 'reassembled baseline');
  const descriptor = bundle.descriptor;
  exactRecord(
    descriptor,
    [
      'kind',
      'projectionVersion',
      'wireStatus',
      'ref',
      'requestId',
      'interestId',
      'bundleId',
      'purpose',
      'key',
      'minimumRevision',
      'authorityCheckpoint',
      'entries',
    ],
    'baseline descriptor',
  );
  if (
    descriptor.kind !== 'baseline-bundle-descriptor-reference' ||
    descriptor.projectionVersion !== 1 ||
    descriptor.wireStatus !== 'not-adopted'
  )
    throw new TypeError('Baseline descriptor identity is invalid.');
  if (
    !sameConsumerRef(descriptor.ref, owner.ref) ||
    descriptor.requestId !== owner.requestId ||
    descriptor.interestId !== owner.interestId ||
    descriptor.purpose !== owner.purpose ||
    descriptor.key !== owner.key ||
    descriptor.minimumRevision !== owner.expectedEntries[0]!.minimumRevision
  )
    return null;
  const count = owner.purpose === 'mesh' ? 27 : 1;
  const descriptors = denseArray(descriptor.entries, count, 'baseline descriptor entries');
  const entries = denseArray(bundle.entries, count, 'reassembled baseline entries');
  const buffers = new Set<ArrayBuffer>();
  return entries.map((entry, index): ValidatedBaselineEntry => {
    const item = exactRecord(entry, ['entryId', 'canonicalLittleEndian', 'fluid'], `reassembled entry[${index}]`);
    const described = descriptors[index] as BaselineEntryDescriptorReference;
    assertEntryDescriptor(described, index);
    const expected = owner.expectedEntries[index]!;
    const role = owner.purpose === 'collision-resync' ? 'collision-resync' : index === 0 ? 'main' : 'overlay';
    if (
      item.entryId !== index ||
      described.entryId !== index ||
      described.role !== role ||
      described.key !== expected.key ||
      described.generatorVersion !== owner.generatorVersion ||
      !Number.isSafeInteger(described.chunkRevision) ||
      described.chunkRevision < expected.minimumRevision
    )
      throw new TypeError(`Baseline entry[${index}] does not match its owner.`);
    if (
      !(item.canonicalLittleEndian instanceof Uint8Array) ||
      item.canonicalLittleEndian.byteLength !== CANONICAL_BYTES
    )
      throw new TypeError(`Baseline entry[${index}] canonical bytes are invalid.`);
    if (!(item.fluid instanceof Uint8Array) || item.fluid.byteLength !== FLUID_BYTES)
      throw new TypeError(`Baseline entry[${index}] fluid bytes are invalid.`);
    for (const view of [item.canonicalLittleEndian, item.fluid] as const) {
      if (!(view.buffer instanceof ArrayBuffer) || buffers.has(view.buffer))
        throw new TypeError('Baseline entry buffers must be independent ArrayBuffers.');
      buffers.add(view.buffer);
    }
    return { descriptor: described, canonicalLittleEndian: item.canonicalLittleEndian, fluid: item.fluid };
  });
}

export function canonicalEqualsLittleEndian(canonical: Uint16Array, bytes: Uint8Array): boolean {
  if (canonical.length !== NETWORK_REFERENCE_BASELINE_CELL_COUNT || bytes.byteLength !== CANONICAL_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < canonical.length; index += 1)
    if (canonical[index] !== view.getUint16(index * 2, true)) return false;
  return true;
}

export function fluidEquals(fluid: Uint8Array, bytes: Uint8Array): boolean {
  if (fluid.length !== NETWORK_REFERENCE_BASELINE_CELL_COUNT || bytes.byteLength !== FLUID_BYTES) return false;
  for (let index = 0; index < fluid.length; index += 1) if (fluid[index] !== bytes[index]) return false;
  return true;
}

export function decodeCanonicalLittleEndian(bytes: Uint8Array): Uint16Array {
  const result = new Uint16Array(NETWORK_REFERENCE_BASELINE_CELL_COUNT);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < result.length; index += 1) result[index] = view.getUint16(index * 2, true);
  return result;
}

export function validateWorkerResult(value: NetworkBaselineWorkerResultIdentity): NetworkBaselineWorkerResultIdentity {
  const source = exactRecord(
    value,
    ['key', 'chunkRevision', 'generatorVersion', 'haloRevision', 'canonical'],
    'network baseline worker result',
  );
  if (!(source.canonical instanceof ArrayBuffer) || source.canonical.byteLength !== CANONICAL_BYTES)
    throw new TypeError('Network baseline worker result canonical is invalid.');
  return {
    key: text(source.key, 'worker result key'),
    chunkRevision: safeInteger(source.chunkRevision, 'worker result chunkRevision'),
    generatorVersion: safeInteger(source.generatorVersion, 'worker result generatorVersion', 1),
    haloRevision:
      typeof source.haloRevision === 'string' && source.haloRevision.length > 0 && source.haloRevision.length <= 16_384
        ? source.haloRevision
        : (() => {
            throw new TypeError('worker result haloRevision must be non-empty text of at most 16384 code units.');
          })(),
    canonical: source.canonical,
  };
}

export function nativeCanonicalEquals(left: Uint16Array, buffer: ArrayBuffer): boolean {
  const right = new Uint16Array(buffer);
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

export function validateRevisionVector(
  value: readonly Readonly<{ key: string; revision: number }>[],
): readonly Readonly<{ key: string; revision: number }>[] {
  const items = denseArray(value, value.length, 'chunk revisions');
  const keys = new Set<string>();
  return items.map((entry, index) => {
    const source = exactRecord(entry, ['key', 'revision'], `chunk revision[${index}]`);
    const key = text(source.key, `chunk revision[${index}].key`);
    parseAuthorityChunkKey(key);
    if (keys.has(key)) throw new TypeError('Chunk revision keys must be unique.');
    keys.add(key);
    return Object.freeze({ key, revision: safeInteger(source.revision, `chunk revision[${index}].revision`) });
  });
}
