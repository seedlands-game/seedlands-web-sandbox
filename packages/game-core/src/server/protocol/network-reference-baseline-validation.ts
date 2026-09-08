import { authorityBaselineCaptureKeys } from '../authority/authority-baseline-capture';
import { canonicalReferenceInteger } from './network-reference-integer';
import type { InterestSessionRef } from './network-reference-interest-control';
import {
  NETWORK_REFERENCE_BASELINE_CELL_COUNT,
  NETWORK_REFERENCE_BASELINE_IN_FLIGHT_BYTES_MAX,
  NETWORK_REFERENCE_BASELINE_METADATA_BYTES_MAX,
  NETWORK_REFERENCE_BASELINE_PAGES_MAX,
  NETWORK_REFERENCE_BASELINE_SEND_QUEUE_BYTES_MAX,
  NETWORK_REFERENCE_BASELINE_TRANSFER_BYTES_MAX,
  NETWORK_REFERENCE_BASELINE_VERSION,
  type BaselineBlockDescriptorReference,
  type BaselineBundleDescriptorReference,
  type BaselineEntryDescriptorReference,
  type BaselineReferenceLimits,
  type BaselineReferenceSizer,
} from './network-reference-baseline-types';

type UnknownRecord = Record<string, unknown>;

export function assertExactRecord(value: unknown, fields: readonly string[], label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key)))
    throw new TypeError(`${label} contains unknown or missing fields.`);
  return value as UnknownRecord;
}

export function assertDenseArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > maximum) throw new RangeError(`${label} exceeds its item limit.`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      throw new TypeError(`${label} must be dense and contain no extension fields.`);
  }
  for (let index = 0; index < value.length; index += 1)
    if (!(index in value)) throw new TypeError(`${label} must be dense.`);
  return value;
}

export function referenceIdentifier(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new TypeError(`${label} must be a safe integer at least ${minimum}.`);
  return canonicalReferenceInteger(value);
}

export function referenceText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256)
    throw new TypeError(`${label} must be non-empty text of at most 256 code units.`);
  return value;
}

export function copyBaselineSessionRef(value: unknown, label = 'baseline ref'): InterestSessionRef {
  const source = assertExactRecord(value, ['epoch', 'serverEpoch', 'sessionId', 'worldId'], label);
  return Object.freeze({
    epoch: referenceText(source.epoch, `${label}.epoch`),
    serverEpoch: referenceText(source.serverEpoch, `${label}.serverEpoch`),
    sessionId: referenceText(source.sessionId, `${label}.sessionId`),
    worldId: referenceText(source.worldId, `${label}.worldId`),
  });
}

export function sameBaselineSessionRef(left: InterestSessionRef, right: InterestSessionRef): boolean {
  return (
    left.epoch === right.epoch &&
    left.serverEpoch === right.serverEpoch &&
    left.sessionId === right.sessionId &&
    left.worldId === right.worldId
  );
}

export function assertBaselineLimits(limits: BaselineReferenceLimits): BaselineReferenceLimits {
  const source = assertExactRecord(
    limits,
    [
      'metadataBytesMax',
      'reliableMessageBytesMax',
      'baselineTransferBytesMax',
      'baselineInFlightBytesMax',
      'sendQueueBytesMax',
    ],
    'baseline limits',
  );
  const copy = {
    metadataBytesMax: referenceIdentifier(source.metadataBytesMax, 'metadataBytesMax', 1),
    reliableMessageBytesMax: referenceIdentifier(source.reliableMessageBytesMax, 'reliableMessageBytesMax', 1),
    baselineTransferBytesMax: referenceIdentifier(source.baselineTransferBytesMax, 'baselineTransferBytesMax', 1),
    baselineInFlightBytesMax: referenceIdentifier(source.baselineInFlightBytesMax, 'baselineInFlightBytesMax', 1),
    sendQueueBytesMax: referenceIdentifier(source.sendQueueBytesMax, 'sendQueueBytesMax', 1),
  };
  if (copy.baselineTransferBytesMax > copy.reliableMessageBytesMax)
    throw new RangeError('Baseline transfer limit exceeds reliable message limit.');
  if (copy.baselineInFlightBytesMax < copy.baselineTransferBytesMax)
    throw new RangeError('Baseline in-flight limit is smaller than one transfer.');
  if (
    copy.metadataBytesMax > NETWORK_REFERENCE_BASELINE_METADATA_BYTES_MAX ||
    copy.reliableMessageBytesMax > NETWORK_REFERENCE_BASELINE_TRANSFER_BYTES_MAX ||
    copy.baselineTransferBytesMax > NETWORK_REFERENCE_BASELINE_TRANSFER_BYTES_MAX ||
    copy.baselineInFlightBytesMax > NETWORK_REFERENCE_BASELINE_IN_FLIGHT_BYTES_MAX ||
    copy.sendQueueBytesMax > NETWORK_REFERENCE_BASELINE_SEND_QUEUE_BYTES_MAX
  )
    throw new RangeError('Baseline reference limits exceed the approved ceilings.');
  return Object.freeze(copy);
}

export function measuredBytes(value: unknown, label: string): number {
  return referenceIdentifier(value, label);
}

function freezeBlock(value: BaselineBlockDescriptorReference): BaselineBlockDescriptorReference {
  return Object.freeze({ ...value });
}

function freezeEntry(value: BaselineEntryDescriptorReference): BaselineEntryDescriptorReference {
  const blocks: readonly [BaselineBlockDescriptorReference, BaselineBlockDescriptorReference] = Object.freeze([
    freezeBlock(value.blocks[0]),
    freezeBlock(value.blocks[1]),
  ]);
  return Object.freeze({
    ...value,
    blocks,
  });
}

export function freezeBaselineDescriptor(value: BaselineBundleDescriptorReference): BaselineBundleDescriptorReference {
  return Object.freeze({
    ...value,
    ref: Object.freeze({ ...value.ref }),
    authorityCheckpoint: Object.freeze({ ...value.authorityCheckpoint }),
    entries: Object.freeze(value.entries.map(freezeEntry)),
  });
}

function validateBlock(
  value: unknown,
  name: 'canonical' | 'fluid',
  transferIds: Set<number>,
): BaselineBlockDescriptorReference {
  const source = assertExactRecord(
    value,
    [
      'name',
      'transferId',
      'elementType',
      'elementCount',
      'byteLength',
      'referencePagePayloadBytes',
      'pageCount',
      'sha256',
    ],
    `${name} descriptor`,
  );
  if (source.name !== name) throw new TypeError(`Expected ${name} descriptor.`);
  const transferId = referenceIdentifier(source.transferId, `${name}.transferId`);
  if (transferIds.has(transferId)) throw new TypeError('Baseline transferId must be unique.');
  transferIds.add(transferId);
  const elementType = name === 'canonical' ? 'uint16-le' : 'uint8';
  if (source.elementType !== elementType) throw new TypeError(`${name}.elementType is invalid.`);
  if (source.elementCount !== NETWORK_REFERENCE_BASELINE_CELL_COUNT)
    throw new TypeError(`${name}.elementCount is invalid.`);
  const byteLength = referenceIdentifier(source.byteLength, `${name}.byteLength`, 1);
  const expectedLength = NETWORK_REFERENCE_BASELINE_CELL_COUNT * (name === 'canonical' ? 2 : 1);
  if (byteLength !== expectedLength) throw new TypeError(`${name}.byteLength is invalid.`);
  const referencePagePayloadBytes = referenceIdentifier(
    source.referencePagePayloadBytes,
    `${name}.referencePagePayloadBytes`,
    1,
  );
  const pageCount = referenceIdentifier(source.pageCount, `${name}.pageCount`, 1);
  if (pageCount !== Math.ceil(byteLength / referencePagePayloadBytes))
    throw new TypeError(`${name}.pageCount is invalid.`);
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256))
    throw new TypeError(`${name}.sha256 is invalid.`);
  return {
    name,
    transferId,
    elementType,
    elementCount: NETWORK_REFERENCE_BASELINE_CELL_COUNT,
    byteLength,
    referencePagePayloadBytes,
    pageCount,
    sha256: source.sha256,
  };
}

export function validateBaselineDescriptor(
  value: unknown,
  options: Readonly<{
    ref: InterestSessionRef;
    limits: BaselineReferenceLimits;
    pagesPerBundleMax: number;
    sizer: BaselineReferenceSizer;
  }>,
): BaselineBundleDescriptorReference {
  const source = assertExactRecord(
    value,
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
    source.kind !== 'baseline-bundle-descriptor-reference' ||
    source.projectionVersion !== NETWORK_REFERENCE_BASELINE_VERSION ||
    source.wireStatus !== 'not-adopted'
  )
    throw new TypeError('Baseline descriptor identity is invalid.');
  const ref = copyBaselineSessionRef(source.ref);
  if (!sameBaselineSessionRef(ref, options.ref)) throw new TypeError('Baseline descriptor ref is not trusted.');
  const purpose = source.purpose;
  if (purpose !== 'mesh' && purpose !== 'collision-resync') throw new TypeError('Baseline purpose is invalid.');
  const interestId = source.interestId === null ? null : referenceIdentifier(source.interestId, 'interestId');
  if (purpose === 'mesh' && interestId === null) throw new TypeError('Mesh baseline requires an interestId.');
  const key = referenceText(source.key, 'baseline key');
  const minimumRevision = referenceIdentifier(source.minimumRevision, 'minimumRevision');
  const checkpoint = assertExactRecord(
    source.authorityCheckpoint,
    ['physicsTick', 'commitSequence', 'worldRevision'],
    'authorityCheckpoint',
  );
  const entriesSource = assertDenseArray(source.entries, 27, 'baseline entries');
  const expectedCount = purpose === 'mesh' ? 27 : 1;
  if (entriesSource.length !== expectedCount) throw new TypeError(`Baseline must contain ${expectedCount} entries.`);
  const expectedKeys = authorityBaselineCaptureKeys({ captureId: 0, purpose, key, minimumRevision });
  const orderedKeys = purpose === 'mesh' ? [key, ...expectedKeys.filter((candidate) => candidate !== key)] : [key];
  const transferIds = new Set<number>();
  let generatorVersion: number | null = null;
  let pageCount = 0;
  const entries = entriesSource.map((entry, index): BaselineEntryDescriptorReference => {
    const item = assertExactRecord(
      entry,
      ['entryId', 'role', 'key', 'chunkRevision', 'generatorVersion', 'blocks'],
      `entry[${index}]`,
    );
    const role = purpose === 'collision-resync' ? 'collision-resync' : index === 0 ? 'main' : 'overlay';
    if (item.entryId !== index || item.role !== role || item.key !== orderedKeys[index])
      throw new TypeError(`entry[${index}] identity is invalid.`);
    const chunkRevision = referenceIdentifier(item.chunkRevision, `entry[${index}].chunkRevision`);
    if (index === 0 && chunkRevision < minimumRevision) throw new TypeError('Main entry revision is too old.');
    const currentGenerator = referenceIdentifier(item.generatorVersion, `entry[${index}].generatorVersion`, 1);
    generatorVersion ??= currentGenerator;
    if (currentGenerator !== generatorVersion) throw new TypeError('Baseline generatorVersion must be uniform.');
    const blocksSource = assertDenseArray(item.blocks, 2, `entry[${index}].blocks`);
    if (blocksSource.length !== 2) throw new TypeError('Each baseline entry must contain two blocks.');
    const blocks = [
      validateBlock(blocksSource[0], 'canonical', transferIds),
      validateBlock(blocksSource[1], 'fluid', transferIds),
    ] as const;
    pageCount += blocks[0].pageCount + blocks[1].pageCount;
    return {
      entryId: index,
      role,
      key: orderedKeys[index]!,
      chunkRevision,
      generatorVersion: currentGenerator,
      blocks,
    };
  });
  const pageLimit = referenceIdentifier(options.pagesPerBundleMax, 'pagesPerBundleMax', 1);
  if (pageLimit > NETWORK_REFERENCE_BASELINE_PAGES_MAX || pageCount > pageLimit)
    throw new RangeError('Baseline descriptor exceeds its page count limit.');
  const limits = assertBaselineLimits(options.limits);
  for (const entry of entries)
    for (const block of entry.blocks)
      if (block.byteLength > limits.baselineTransferBytesMax)
        throw new RangeError('Baseline transfer exceeds its byte limit.');
  const descriptor = freezeBaselineDescriptor({
    kind: 'baseline-bundle-descriptor-reference',
    projectionVersion: NETWORK_REFERENCE_BASELINE_VERSION,
    wireStatus: 'not-adopted',
    ref,
    requestId: referenceIdentifier(source.requestId, 'requestId'),
    interestId,
    bundleId: referenceIdentifier(source.bundleId, 'bundleId'),
    purpose,
    key,
    minimumRevision,
    authorityCheckpoint: Object.freeze({
      physicsTick: referenceIdentifier(checkpoint.physicsTick, 'authorityCheckpoint.physicsTick'),
      commitSequence: referenceIdentifier(checkpoint.commitSequence, 'authorityCheckpoint.commitSequence'),
      worldRevision: referenceIdentifier(checkpoint.worldRevision, 'authorityCheckpoint.worldRevision'),
    }),
    entries,
  });
  const metadataBytes = measuredBytes(options.sizer.measureMetadataBytes(descriptor), 'descriptor metadata bytes');
  if (metadataBytes > limits.metadataBytesMax) throw new RangeError('Baseline descriptor metadata exceeds its limit.');
  return descriptor;
}
