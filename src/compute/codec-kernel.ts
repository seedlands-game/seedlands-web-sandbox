import type { ChunkRecordCodec, CreateStoredChunkRecordInput, StoredChunkRecord } from '../world/chunk-snapshot-codec';
import { KernelMemory } from './kernel-memory';

export const CODEC_VOXEL_COUNT = 32 ** 3;
export const CODEC_INPUT_OFFSET = 64;
export const CODEC_PROCEDURAL_OFFSET = CODEC_INPUT_OFFSET + CODEC_VOXEL_COUNT * Uint16Array.BYTES_PER_ELEMENT;
export const CODEC_FLUID_OFFSET = CODEC_PROCEDURAL_OFFSET + CODEC_VOXEL_COUNT * Uint16Array.BYTES_PER_ELEMENT;
export const CODEC_OUTPUT_OFFSET = CODEC_FLUID_OFFSET + CODEC_VOXEL_COUNT;
export const CODEC_OUTPUT_CAPACITY = 140_000;

type Candidate = {
  codec: ChunkRecordCodec;
  payload: Uint8Array;
  payloadChecksum: number;
  proceduralBaseSignature?: number;
};

export class CodecKernel {
  constructor(readonly memory: KernelMemory) {}

  get failed(): boolean {
    return this.memory.failed;
  }

  encodeDiff(): number {
    return this.invoke(
      'encode_diff',
      CODEC_INPUT_OFFSET,
      CODEC_PROCEDURAL_OFFSET,
      CODEC_OUTPUT_OFFSET,
      CODEC_OUTPUT_CAPACITY,
    );
  }

  encodePalette(): number {
    return this.invoke('encode_palette', CODEC_INPUT_OFFSET, CODEC_OUTPUT_OFFSET, CODEC_OUTPUT_CAPACITY);
  }

  encodeRaw(): number {
    return this.invoke('encode_raw', CODEC_INPUT_OFFSET, CODEC_OUTPUT_OFFSET, CODEC_OUTPUT_CAPACITY);
  }

  crc32Bytes(offset: number, length: number): number {
    return this.invoke('crc32_bytes', offset, length) >>> 0;
  }

  crc32U16(offset: number, count: number): number {
    return this.invoke('crc32_u16_le', offset, count) >>> 0;
  }

  private invoke(name: string, ...parameters: number[]): number {
    try {
      return this.memory.invoke(name, ...parameters);
    } catch (error) {
      this.memory.failed = true;
      throw error;
    }
  }
}

export function createCodecKernel(memory: KernelMemory): CodecKernel {
  return new CodecKernel(memory);
}

/** Independent W15 measurement entrypoint; it does not run any codec candidate. */
export function runCrc32Bytes(kernel: CodecKernel, bytes: Uint8Array): number {
  kernel.memory.bytes(CODEC_INPUT_OFFSET, bytes.length).set(bytes);
  return kernel.crc32Bytes(CODEC_INPUT_OFFSET, bytes.length);
}

/** Independent W15 measurement entrypoint for the persisted little-endian u16 stream. */
export function runCrc32U16(kernel: CodecKernel, values: Uint16Array): number {
  kernel.memory.u16(CODEC_INPUT_OFFSET, values.length).set(values);
  return kernel.crc32U16(CODEC_INPUT_OFFSET, values.length);
}

/** Independent W15 A/B entrypoint; dispatches by the persisted input width. */
export function runCRC(kernel: CodecKernel, values: Uint8Array | Uint16Array): number {
  return values instanceof Uint16Array ? runCrc32U16(kernel, values) : runCrc32Bytes(kernel, values);
}

const assertInput = (input: CreateStoredChunkRecordInput): void => {
  if (input.voxels.length !== CODEC_VOXEL_COUNT || input.proceduralVoxels.length !== CODEC_VOXEL_COUNT)
    throw new Error(`Chunk snapshot length must be ${CODEC_VOXEL_COUNT} voxels.`);
  if (input.fluid !== undefined && input.fluid.length !== CODEC_VOXEL_COUNT)
    throw new Error(`Stored fluid sidecar length must be ${CODEC_VOXEL_COUNT} bytes.`);
};

const candidate = (kernel: CodecKernel, codec: ChunkRecordCodec, encode: () => number): Candidate => {
  try {
    const length = encode();
    if (!Number.isInteger(length) || length < 0 || length > CODEC_OUTPUT_CAPACITY)
      throw new Error(`Wasm ${codec} encoder returned invalid length ${length}.`);
    return {
      codec,
      payload: kernel.memory.bytes(CODEC_OUTPUT_OFFSET, length).slice(),
      payloadChecksum: kernel.crc32Bytes(CODEC_OUTPUT_OFFSET, length),
    };
  } catch (error) {
    kernel.memory.failed = true;
    throw error;
  }
};

const selectCandidate = (candidates: readonly Candidate[]): Candidate =>
  candidates.reduce((smallest, next) => (next.payload.length < smallest.payload.length ? next : smallest));

/**
 * Encode the existing W14 record candidates through the Wasm kernel. Decoding remains
 * in the TypeScript codec so the persisted schema and recovery checks stay in
 * their existing owner; this adapter only produces candidate bytes and CRCs.
 */
export function encodeStoredChunkRecord(kernel: CodecKernel, input: CreateStoredChunkRecordInput): StoredChunkRecord {
  assertInput(input);
  kernel.memory.u16(CODEC_INPUT_OFFSET, CODEC_VOXEL_COUNT).set(input.voxels);
  kernel.memory.u16(CODEC_PROCEDURAL_OFFSET, CODEC_VOXEL_COUNT).set(input.proceduralVoxels);
  if (input.fluid !== undefined) kernel.memory.bytes(CODEC_FLUID_OFFSET, input.fluid.length).set(input.fluid);

  const baseSignature = kernel.crc32U16(CODEC_PROCEDURAL_OFFSET, CODEC_VOXEL_COUNT);
  const candidates = [
    candidate(kernel, 'procedural-diff-v1', () => kernel.encodeDiff()),
    candidate(kernel, 'palette-bitpack-v1', () => kernel.encodePalette()),
    candidate(kernel, 'raw-u16-v1', () => kernel.encodeRaw()),
  ];
  const selected = selectCandidate(candidates);
  const identity = {
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
    payloadChecksum: selected.payloadChecksum,
    ...(selected.codec === 'procedural-diff-v1' ? { proceduralBaseSignature: baseSignature } : {}),
    ...(input.fluid === undefined
      ? {}
      : {
          fluidVersion: 1 as const,
          fluid: input.fluid.slice(),
          fluidChecksum: kernel.crc32Bytes(CODEC_FLUID_OFFSET, input.fluid.length),
        }),
  };
}
