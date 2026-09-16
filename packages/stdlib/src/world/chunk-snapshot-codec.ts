import type { CoreUtf8Port } from '../runtime/platform-ports';

export type ChunkRecordCodec = 'procedural-diff-v1' | 'palette-bitpack-v1' | 'raw-u16-v1';

export type StoredChunkIdentity = {
  worldId: string;
  seedText: string;
  cx: number;
  cy: number;
  cz: number;
  revision: number;
  formatVersion: number;
  voxelSchemaVersion: number;
  generatorVersion: number;
};

export type StoredChunkRecord = StoredChunkIdentity & {
  codec: ChunkRecordCodec;
  payload: Uint8Array;
  payloadBytes: number;
  payloadChecksum: number;
  proceduralBaseSignature?: number;
  fluidVersion?: 1;
  fluid?: Uint8Array;
  fluidChecksum?: number;
};

export type CreateStoredChunkRecordInput = StoredChunkIdentity & {
  voxels: Uint16Array;
  proceduralVoxels: Uint16Array;
  fluid?: Uint8Array;
};

export type DecodeStoredChunkRecordInput = StoredChunkIdentity & {
  proceduralVoxels?: Uint16Array;
};

const RAW_VOXEL_COUNT = 32 ** 3;

const assertVoxelBuffers = (voxels: Uint16Array, proceduralVoxels: Uint16Array) => {
  if (voxels.length !== RAW_VOXEL_COUNT || proceduralVoxels.length !== RAW_VOXEL_COUNT)
    throw new Error(`Chunk snapshot length must be ${RAW_VOXEL_COUNT} voxels.`);
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export const crc32Bytes = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1)
    value = crcTable[(value ^ bytes[index]!) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const crc32Voxels = (voxels: Uint16Array) => {
  let value = 0xffffffff;
  for (let index = 0; index < voxels.length; index += 1) {
    const voxel = voxels[index]!;
    value = crcTable[(value ^ (voxel & 0xff)) & 0xff] ^ (value >>> 8);
    value = crcTable[(value ^ (voxel >>> 8)) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const voxelBytes = (voxels: Uint16Array) => {
  const bytes = new Uint8Array(voxels.length * Uint16Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < voxels.length; index += 1) {
    bytes[index * 2] = voxels[index] & 0xff;
    bytes[index * 2 + 1] = voxels[index] >>> 8;
  }
  return bytes;
};

const varUintBytes = (input: number) => {
  let value = input >>> 0;
  let count = 1;
  while (value >= 0x80) {
    value >>>= 7;
    count += 1;
  }
  return count;
};

const writeVarUint = (target: Uint8Array, offset: number, input: number) => {
  let value = input >>> 0;
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    target[offset++] = value ? byte | 0x80 : byte;
  } while (value);
  return offset;
};

const readVarUint = (source: Uint8Array, offset: { value: number }) => {
  let value = 0;
  let shift = 0;
  for (let count = 0; count < 5; count += 1) {
    if (offset.value >= source.length) throw new Error('Chunk snapshot payload is truncated.');
    const byte = source[offset.value++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
  }
  throw new Error('Chunk snapshot varint is corrupt.');
};

const encodeProceduralDiff = (voxels: Uint16Array, procedural: Uint16Array) => {
  let count = 0;
  let previousIndex = 0;
  let byteLength = 4;
  for (let index = 0; index < voxels.length; index += 1) {
    if (voxels[index] === procedural[index]) continue;
    byteLength += varUintBytes(index - previousIndex) + 2;
    previousIndex = index;
    count += 1;
  }
  const payload = new Uint8Array(byteLength);
  new DataView(payload.buffer).setUint32(0, count, true);
  previousIndex = 0;
  let offset = 4;
  for (let index = 0; index < voxels.length; index += 1) {
    if (voxels[index] === procedural[index]) continue;
    offset = writeVarUint(payload, offset, index - previousIndex);
    const voxel = voxels[index]!;
    payload[offset++] = voxel & 0xff;
    payload[offset++] = voxel >>> 8;
    previousIndex = index;
  }
  return payload;
};

const encodePalette = (voxels: Uint16Array) => {
  const paletteIndexes = new Int32Array(1 << 16).fill(-1);
  const palette = new Uint16Array(voxels.length);
  let paletteLength = 0;
  for (let index = 0; index < voxels.length; index += 1) {
    const voxel = voxels[index]!;
    if (paletteIndexes[voxel] < 0) {
      paletteIndexes[voxel] = paletteLength;
      palette[paletteLength++] = voxel;
    }
  }
  let bits = 0;
  for (let width = 1; width < paletteLength; width <<= 1) bits += 1;
  const packedBytes = Math.ceil((voxels.length * bits) / 8);
  const payload = new Uint8Array(5 + paletteLength * 2 + packedBytes);
  const view = new DataView(payload.buffer);
  view.setUint32(0, paletteLength, true);
  payload[4] = bits;
  for (let index = 0; index < paletteLength; index += 1) view.setUint16(5 + index * 2, palette[index]!, true);
  let byteOffset = 5 + paletteLength * 2;
  let accumulator = 0;
  let accumulatorBits = 0;
  for (let index = 0; index < voxels.length; index += 1) {
    const paletteIndex = paletteIndexes[voxels[index]!]!;
    accumulator |= paletteIndex << accumulatorBits;
    accumulatorBits += bits;
    while (accumulatorBits >= 8) {
      payload[byteOffset++] = accumulator & 0xff;
      accumulator >>>= 8;
      accumulatorBits -= 8;
    }
  }
  if (accumulatorBits) payload[byteOffset] = accumulator & 0xff;
  return payload;
};

const selectCodec = (
  candidates: readonly { codec: ChunkRecordCodec; payload: Uint8Array; proceduralBaseSignature?: number }[],
) =>
  candidates.reduce((smallest, candidate) =>
    candidate.payload.length < smallest.payload.length ? candidate : smallest,
  );

export function createStoredChunkRecord(input: CreateStoredChunkRecordInput): StoredChunkRecord {
  assertVoxelBuffers(input.voxels, input.proceduralVoxels);
  const raw = voxelBytes(input.voxels);
  const selected = selectCodec([
    {
      codec: 'procedural-diff-v1',
      payload: encodeProceduralDiff(input.voxels, input.proceduralVoxels),
      proceduralBaseSignature: crc32Voxels(input.proceduralVoxels),
    },
    { codec: 'palette-bitpack-v1', payload: encodePalette(input.voxels) },
    { codec: 'raw-u16-v1', payload: raw },
  ]);
  const identity: StoredChunkIdentity = {
    worldId: input.worldId,
    seedText: input.seedText,
    cx: input.cx,
    cy: input.cy,
    cz: input.cz,
    revision: input.revision,
    formatVersion: input.formatVersion,
    voxelSchemaVersion: input.voxelSchemaVersion,
    generatorVersion: input.generatorVersion,
  };
  return {
    ...identity,
    codec: selected.codec,
    payload: selected.payload,
    payloadBytes: selected.payload.byteLength,
    payloadChecksum: crc32Bytes(selected.payload),
    ...(selected.proceduralBaseSignature === undefined
      ? {}
      : { proceduralBaseSignature: selected.proceduralBaseSignature }),
    ...(input.fluid
      ? { fluidVersion: 1 as const, fluid: input.fluid.slice(), fluidChecksum: crc32Bytes(input.fluid) }
      : {}),
  };
}

export const validateStoredFluid = (record: StoredChunkRecord): Uint8Array | undefined => {
  if (record.fluid === undefined && record.fluidVersion === undefined && record.fluidChecksum === undefined)
    return undefined;
  if (record.fluidVersion !== 1 || !(record.fluid instanceof Uint8Array) || record.fluid.length !== RAW_VOXEL_COUNT)
    throw new Error('Stored fluid sidecar is corrupt.');
  if (record.fluidChecksum !== crc32Bytes(record.fluid)) throw new Error('Stored fluid sidecar checksum mismatch.');
  return record.fluid.slice();
};

const assertIdentity = (record: StoredChunkRecord, expected: DecodeStoredChunkRecordInput) => {
  const fields = [
    'worldId',
    'seedText',
    'cx',
    'cy',
    'cz',
    'revision',
    'formatVersion',
    'voxelSchemaVersion',
    'generatorVersion',
  ] as const;
  for (const field of fields)
    if (record[field] !== expected[field]) throw new Error(`Chunk snapshot identity mismatch for ${field}.`);
};

const decodeProceduralDiff = (payload: Uint8Array, procedural: Uint16Array) => {
  if (payload.length < 4) throw new Error('Chunk snapshot payload is truncated.');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const count = view.getUint32(0, true);
  if (count > RAW_VOXEL_COUNT) throw new Error('Chunk snapshot diff count is corrupt.');
  const result = procedural.slice();
  const offset = { value: 4 };
  let voxelIndex = 0;
  for (let index = 0; index < count; index += 1) {
    voxelIndex += readVarUint(payload, offset);
    if (voxelIndex >= RAW_VOXEL_COUNT || offset.value + 2 > payload.length)
      throw new Error('Chunk snapshot diff payload is corrupt or truncated.');
    result[voxelIndex] = payload[offset.value] | (payload[offset.value + 1] << 8);
    offset.value += 2;
  }
  if (offset.value !== payload.length) throw new Error('Chunk snapshot diff payload has trailing corrupt data.');
  return result;
};

const decodePalette = (payload: Uint8Array) => {
  if (payload.length < 5) throw new Error('Chunk snapshot palette payload is truncated.');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const paletteLength = view.getUint32(0, true);
  const bits = payload[4];
  if (
    !paletteLength ||
    paletteLength > RAW_VOXEL_COUNT ||
    bits !== (paletteLength <= 1 ? 0 : Math.ceil(Math.log2(paletteLength)))
  )
    throw new Error('Chunk snapshot palette header is corrupt.');
  const valuesOffset = 5 + paletteLength * 2;
  const packedBytes = Math.ceil((RAW_VOXEL_COUNT * bits) / 8);
  if (payload.length !== valuesOffset + packedBytes)
    throw new Error('Chunk snapshot palette payload length is corrupt.');
  const palette = new Uint16Array(paletteLength);
  for (let index = 0; index < palette.length; index += 1) palette[index] = view.getUint16(5 + index * 2, true);
  const result = new Uint16Array(RAW_VOXEL_COUNT);
  const mask = bits ? 2 ** bits - 1 : 0;
  if (bits === 0) {
    result.fill(palette[0]);
    return result;
  }
  for (let index = 0; index < result.length; index += 1) {
    const bitOffset = index * bits;
    const byteOffset = valuesOffset + (bitOffset >>> 3);
    const shift = bitOffset & 7;
    const packed = payload[byteOffset] | ((payload[byteOffset + 1] ?? 0) << 8);
    const paletteIndex = (packed >>> shift) & mask;
    if (paletteIndex >= palette.length) throw new Error('Chunk snapshot palette index is corrupt.');
    result[index] = palette[paletteIndex];
  }
  return result;
};

const decodeRaw = (payload: Uint8Array) => {
  if (payload.length !== RAW_VOXEL_COUNT * 2) throw new Error('Chunk snapshot raw payload length is corrupt.');
  const copied = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] === 1) return new Uint16Array(copied);
  const result = new Uint16Array(RAW_VOXEL_COUNT);
  const view = new DataView(copied);
  for (let index = 0; index < result.length; index += 1) result[index] = view.getUint16(index * 2, true);
  return result;
};

export function decodeStoredChunkRecord(
  record: StoredChunkRecord,
  expected: DecodeStoredChunkRecordInput,
): Uint16Array {
  assertIdentity(record, expected);
  if (record.payloadBytes !== record.payload.byteLength) throw new Error('Chunk snapshot payload length is corrupt.');
  if (crc32Bytes(record.payload) !== record.payloadChecksum)
    throw new Error('Chunk snapshot checksum indicates corruption.');
  if (record.codec === 'procedural-diff-v1') {
    const proceduralVoxels = expected.proceduralVoxels;
    if (!proceduralVoxels || proceduralVoxels.length !== RAW_VOXEL_COUNT)
      throw new Error('Chunk snapshot procedural base is unavailable.');
    const signature = crc32Voxels(proceduralVoxels);
    if (signature !== record.proceduralBaseSignature)
      throw new Error('Chunk snapshot procedural base signature does not match the generator output.');
    return decodeProceduralDiff(record.payload, proceduralVoxels);
  }
  if (record.codec === 'palette-bitpack-v1') return decodePalette(record.payload);
  if (record.codec === 'raw-u16-v1') return decodeRaw(record.payload);
  throw new Error('Chunk snapshot codec is not supported.');
}

export function storedChunkRecordBytes(record: StoredChunkRecord, utf8: CoreUtf8Port): number {
  const metadata = {
    ...record,
    payload: undefined,
  };
  return utf8.encode(JSON.stringify(metadata)).byteLength + record.payload.byteLength;
}
