import {
  NETWORK_DRAFT_PROTOCOL_VERSION,
  NETWORK_MESSAGE_CLASSES,
  type NetworkMessageClass,
  isPublicInboundMessage,
  isPublicOutboundMessage,
} from './network-message-semantics';

export const C0_MAGIC = 0x534c4330;
export const C0_VERSION = 1 as const;
export const C0_HEADER_BYTES = 16;

export type C0CodecLimits = Readonly<{
  maxMetadataBytes: number;
  maxBlocks: number;
  maxBlockBytes: number;
  maxEnvelopeBytes: number;
}>;

export const DEFAULT_C0_CODEC_LIMITS: C0CodecLimits = Object.freeze({
  maxMetadataBytes: 64 * 1024,
  maxBlocks: 64,
  maxBlockBytes: 1024 * 1024,
  maxEnvelopeBytes: 1024 * 1024,
});

export type C0BinaryBlock = Readonly<{ name: string; bytes: Uint8Array }>;
export type C0Envelope = Readonly<{
  messageClass: NetworkMessageClass;
  message: Readonly<Record<string, unknown>>;
  blocks: readonly C0BinaryBlock[];
}>;
export type DecodedC0Envelope = Readonly<{
  draftVersion: typeof NETWORK_DRAFT_PROTOCOL_VERSION;
  messageClass: NetworkMessageClass;
  message: Readonly<Record<string, unknown>>;
  blocks: readonly C0BinaryBlock[];
}>;

type C0BlockDescriptor = Readonly<{ name: string; offset: number; length: number }>;
type C0Metadata = Readonly<{
  draftVersion: typeof NETWORK_DRAFT_PROTOCOL_VERSION;
  messageClass: NetworkMessageClass;
  message: Readonly<Record<string, unknown>>;
  blocks: readonly C0BlockDescriptor[];
}>;

export class C0CodecError extends Error {
  constructor(
    readonly code: 'header' | 'version' | 'metadata' | 'blocks' | 'limits',
    message: string,
  ) {
    super(message);
    this.name = 'C0CodecError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const blockName = /^[a-z][a-z0-9-]{0,63}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isSafeSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const mergedLimits = (input: Partial<C0CodecLimits> | undefined): C0CodecLimits => {
  const limits = { ...DEFAULT_C0_CODEC_LIMITS, ...input };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError('C0 codec limits must be positive safe integers.');
  if (limits.maxBlockBytes > limits.maxEnvelopeBytes)
    throw new RangeError('C0 block limit cannot exceed the envelope limit.');
  return limits;
};

function assertJsonValue(value: unknown, depth = 0): void {
  if (depth > 32) throw new C0CodecError('metadata', 'C0 metadata nesting exceeds the limit.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new C0CodecError('metadata', 'C0 metadata numbers must be finite.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new C0CodecError('metadata', 'C0 metadata array exceeds the limit.');
    value.forEach((entry) => assertJsonValue(entry, depth + 1));
    return;
  }
  if (!isRecord(value)) throw new C0CodecError('metadata', 'C0 metadata contains a non-JSON value.');
  const entries = Object.entries(value);
  if (entries.length > 128) throw new C0CodecError('metadata', 'C0 metadata object exceeds the limit.');
  for (const [key, entry] of entries) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype')
      throw new C0CodecError('metadata', 'C0 metadata key is forbidden.');
    assertJsonValue(entry, depth + 1);
  }
}

const validMessageClass = (value: unknown): value is NetworkMessageClass =>
  typeof value === 'string' && Object.hasOwn(NETWORK_MESSAGE_CLASSES, value);
const isPublicMessageForClass = (
  messageClass: NetworkMessageClass,
  message: unknown,
): message is Readonly<Record<string, unknown>> =>
  isRecord(message) &&
  message.kind === messageClass &&
  (NETWORK_MESSAGE_CLASSES[messageClass].direction === 'inbound'
    ? isPublicInboundMessage(message)
    : isPublicOutboundMessage(message));

function validateMetadata(value: unknown, blockCount: number, binaryBytes: number, limits: C0CodecLimits): C0Metadata {
  assertJsonValue(value);
  if (
    !isRecord(value) ||
    value.draftVersion !== NETWORK_DRAFT_PROTOCOL_VERSION ||
    !validMessageClass(value.messageClass)
  )
    throw new C0CodecError('metadata', 'C0 metadata protocol header is invalid.');
  if (!isPublicMessageForClass(value.messageClass, value.message))
    throw new C0CodecError('metadata', 'C0 metadata message discriminator is invalid.');
  if (!Array.isArray(value.blocks) || value.blocks.length !== blockCount || value.blocks.length > limits.maxBlocks)
    throw new C0CodecError('blocks', 'C0 block count is invalid.');
  const names = new Set<string>();
  let expectedOffset = 0;
  const blocks = value.blocks.map((entry): C0BlockDescriptor => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      !blockName.test(entry.name) ||
      !isSafeSize(entry.offset) ||
      !isSafeSize(entry.length)
    )
      throw new C0CodecError('blocks', 'C0 block descriptor is invalid.');
    if (names.has(entry.name)) throw new C0CodecError('blocks', 'C0 block names must be unique.');
    if (entry.length > limits.maxBlockBytes) throw new C0CodecError('limits', 'C0 block exceeds the byte limit.');
    if (entry.offset !== expectedOffset)
      throw new C0CodecError('blocks', 'C0 binary blocks overlap or are not contiguous.');
    const end = entry.offset + entry.length;
    if (!Number.isSafeInteger(end) || end > binaryBytes)
      throw new C0CodecError('blocks', 'C0 block exceeds the declared binary payload.');
    names.add(entry.name);
    expectedOffset = end;
    return { name: entry.name, offset: entry.offset, length: entry.length };
  });
  if (expectedOffset !== binaryBytes) throw new C0CodecError('blocks', 'C0 binary payload has unclaimed bytes.');
  return {
    draftVersion: NETWORK_DRAFT_PROTOCOL_VERSION,
    messageClass: value.messageClass,
    message: value.message,
    blocks,
  };
}

export function encodeC0Envelope(input: C0Envelope, limitOverride?: Partial<C0CodecLimits>): Uint8Array {
  const limits = mergedLimits(limitOverride);
  if (!validMessageClass(input.messageClass) || !isPublicMessageForClass(input.messageClass, input.message))
    throw new C0CodecError('metadata', 'C0 message class and discriminator must match.');
  if (!Array.isArray(input.blocks) || input.blocks.length > limits.maxBlocks)
    throw new C0CodecError('blocks', 'C0 block count exceeds the limit.');
  let offset = 0;
  const names = new Set<string>();
  const descriptors = input.blocks.map((block): C0BlockDescriptor => {
    if (!blockName.test(block.name) || names.has(block.name) || !(block.bytes instanceof Uint8Array))
      throw new C0CodecError('blocks', 'C0 block is invalid.');
    if (block.bytes.byteLength > limits.maxBlockBytes)
      throw new C0CodecError('limits', 'C0 block exceeds the byte limit.');
    const descriptor = { name: block.name, offset, length: block.bytes.byteLength };
    names.add(block.name);
    offset += block.bytes.byteLength;
    return descriptor;
  });
  assertJsonValue(input.message);
  const metadata: C0Metadata = {
    draftVersion: NETWORK_DRAFT_PROTOCOL_VERSION,
    messageClass: input.messageClass,
    message: input.message,
    blocks: descriptors,
  };
  const metadataBytes = encoder.encode(JSON.stringify(metadata));
  const totalBytes = C0_HEADER_BYTES + metadataBytes.byteLength + offset;
  if (metadataBytes.byteLength > limits.maxMetadataBytes)
    throw new C0CodecError('limits', 'C0 metadata exceeds the byte limit.');
  if (totalBytes > limits.maxEnvelopeBytes) throw new C0CodecError('limits', 'C0 envelope exceeds the byte limit.');
  const encoded = new Uint8Array(totalBytes);
  const header = new DataView(encoded.buffer);
  header.setUint32(0, C0_MAGIC, true);
  header.setUint16(4, C0_VERSION, true);
  header.setUint16(6, input.blocks.length, true);
  header.setUint32(8, metadataBytes.byteLength, true);
  header.setUint32(12, offset, true);
  encoded.set(metadataBytes, C0_HEADER_BYTES);
  let writeOffset = C0_HEADER_BYTES + metadataBytes.byteLength;
  for (const block of input.blocks) {
    encoded.set(block.bytes, writeOffset);
    writeOffset += block.bytes.byteLength;
  }
  return encoded;
}

export function decodeC0Envelope(input: Uint8Array, limitOverride?: Partial<C0CodecLimits>): DecodedC0Envelope {
  const limits = mergedLimits(limitOverride);
  if (!(input instanceof Uint8Array) || input.byteLength < C0_HEADER_BYTES)
    throw new C0CodecError('header', 'C0 envelope is truncated.');
  if (input.byteLength > limits.maxEnvelopeBytes)
    throw new C0CodecError('limits', 'C0 envelope exceeds the byte limit.');
  const header = new DataView(input.buffer, input.byteOffset, C0_HEADER_BYTES);
  if (header.getUint32(0, true) !== C0_MAGIC) throw new C0CodecError('header', 'C0 envelope magic is invalid.');
  if (header.getUint16(4, true) !== C0_VERSION)
    throw new C0CodecError('version', 'C0 envelope version is unsupported.');
  const blockCount = header.getUint16(6, true);
  const metadataBytes = header.getUint32(8, true);
  const binaryBytes = header.getUint32(12, true);
  if (metadataBytes > limits.maxMetadataBytes)
    throw new C0CodecError('metadata', 'C0 metadata exceeds the byte limit.');
  if (blockCount > limits.maxBlocks) throw new C0CodecError('blocks', 'C0 block count exceeds the limit.');
  const expectedLength = C0_HEADER_BYTES + metadataBytes + binaryBytes;
  if (!Number.isSafeInteger(expectedLength) || expectedLength !== input.byteLength)
    throw new C0CodecError('header', 'C0 envelope lengths are invalid.');
  let rawMetadata: unknown;
  try {
    rawMetadata = JSON.parse(decoder.decode(input.subarray(C0_HEADER_BYTES, C0_HEADER_BYTES + metadataBytes)));
  } catch {
    throw new C0CodecError('metadata', 'C0 metadata JSON is invalid.');
  }
  const metadata = validateMetadata(rawMetadata, blockCount, binaryBytes, limits);
  const binary = input.subarray(C0_HEADER_BYTES + metadataBytes);
  return {
    draftVersion: metadata.draftVersion,
    messageClass: metadata.messageClass,
    message: metadata.message,
    blocks: metadata.blocks.map(({ name, offset, length }) => ({
      name,
      bytes: binary.subarray(offset, offset + length),
    })),
  };
}
