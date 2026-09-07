import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import type { AuthorityBaselineCaptureResult } from '../../../../src/server/authority/authority-baseline-capture-types';
import type { ReassembledBaselineReference } from '../../../../src/server/protocol/network-reference-baseline-types';
import { readNetworkBaselineCorpus } from './network-baseline-corpus-recorder';
import type { DerivedFrame } from './network-baseline-reference-corpus-types';

type RawCorpus = Awaited<ReturnType<typeof readNetworkBaselineCorpus>>;
export type NetworkBaselineRawFrame = RawCorpus['frames'][number];
export type NetworkBaselineRawEntryBytes = Readonly<{ canonical: Uint8Array; fluid: Uint8Array }>;

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

export function restoreSourceBoundCapture(
  frame: NetworkBaselineRawFrame,
  bytes: readonly NetworkBaselineRawEntryBytes[],
): Extract<AuthorityBaselineCaptureResult, { status: 'available' }> {
  const output = frame.producerOutput;
  if (!Number.isSafeInteger(output.captureGeneration) || output.captureGeneration < 0)
    throw new TypeError('Raw baseline captureGeneration is invalid.');
  return Object.freeze({
    status: 'available' as const,
    captureId: output.captureId,
    captureGeneration: output.captureGeneration,
    purpose: output.purpose,
    key: output.key,
    checkpoint: structuredClone(output.checkpoint),
    entries: Object.freeze(
      frame.entries.map((entry, index) =>
        Object.freeze({
          role: entry.role,
          key: entry.key,
          chunkRevision: entry.chunkRevision,
          generatorVersion: entry.generatorVersion,
          canonical: ownArrayBuffer(new Uint8Array(nativeCanonical(bytes[index]!.canonical).buffer)),
          fluid: ownArrayBuffer(bytes[index]!.fluid),
        }),
      ),
    ),
  });
}

export function assertReassembledMatchesSourceBoundRaw(
  result: ReassembledBaselineReference,
  frame: NetworkBaselineRawFrame,
  source: readonly NetworkBaselineRawEntryBytes[],
): void {
  if (result.entries.length !== frame.entries.length)
    throw new TypeError('Reference reassembly entry count is invalid.');
  result.entries.forEach((entry, index) => {
    const raw = frame.entries[index]!;
    const bytes = source[index]!;
    if (entry.entryId !== raw.entryId) throw new TypeError('Reference reassembly entry id is invalid.');
    deepStrictEqual(entry.canonicalLittleEndian, bytes.canonical);
    deepStrictEqual(entry.fluid, bytes.fluid);
    if (sha256(entry.canonicalLittleEndian) !== raw.binary[0].sha256 || sha256(entry.fluid) !== raw.binary[1].sha256)
      throw new TypeError('Reference reassembly block hash does not bind the raw sidecar.');
  });
}

/** 已写盘重核验时，把公开 descriptor/reassembled hash 逐项回绑到 r2 原始记录。 */
export function assertDerivedFrameBindsSourceBoundRaw(frame: DerivedFrame, raw: NetworkBaselineRawFrame): void {
  if (
    frame.frameId !== `reference-${raw.frameId}` ||
    frame.source.scenario !== raw.scenario ||
    frame.source.contentSha256 !== raw.contentSha256 ||
    frame.source.captureId !== raw.producerOutput.captureId ||
    frame.source.captureGeneration !== raw.producerOutput.captureGeneration ||
    frame.source.producerInputSha256 !== raw.producerInputSha256 ||
    frame.source.producerOutputSha256 !== raw.producerOutputSha256
  )
    throw new TypeError('Derived baseline source record binding is invalid.');
  const { descriptor } = frame;
  if (
    descriptor.purpose !== raw.request.purpose ||
    descriptor.key !== raw.request.key ||
    descriptor.minimumRevision !== raw.request.minimumRevision ||
    descriptor.authorityCheckpoint.physicsTick !== raw.checkpoint.physicsTick ||
    descriptor.authorityCheckpoint.commitSequence !== raw.checkpoint.commitSequence ||
    descriptor.authorityCheckpoint.worldRevision !== raw.checkpoint.worldRevision ||
    descriptor.entries.length !== raw.entries.length ||
    frame.reassembled.length !== raw.entries.length
  )
    throw new TypeError('Derived baseline descriptor does not bind its raw capture shape.');
  descriptor.entries.forEach((entry, index) => {
    const source = raw.entries[index]!;
    const reassembled = frame.reassembled[index]!;
    if (
      entry.entryId !== source.entryId ||
      entry.role !== source.role ||
      entry.key !== source.key ||
      entry.chunkRevision !== source.chunkRevision ||
      entry.generatorVersion !== source.generatorVersion ||
      entry.blocks[0].sha256 !== source.binary[0].sha256 ||
      entry.blocks[1].sha256 !== source.binary[1].sha256 ||
      reassembled.entryId !== source.entryId ||
      reassembled.canonicalSha256 !== source.binary[0].sha256 ||
      reassembled.fluidSha256 !== source.binary[1].sha256
    )
      throw new TypeError('Derived baseline entry or reassembled hash does not bind the raw sidecar.');
  });
}

function nativeCanonical(littleEndian: Uint8Array): Uint16Array {
  if (littleEndian.byteLength !== 32 ** 3 * Uint16Array.BYTES_PER_ELEMENT)
    throw new TypeError('Raw canonical block has an invalid byte length.');
  const values = new Uint16Array(littleEndian.byteLength / Uint16Array.BYTES_PER_ELEMENT);
  const view = new DataView(littleEndian.buffer, littleEndian.byteOffset, littleEndian.byteLength);
  for (let index = 0; index < values.length; index += 1) values[index] = view.getUint16(index * 2, true);
  return values;
}

function ownArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
