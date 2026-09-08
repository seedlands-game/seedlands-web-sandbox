import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import {
  C0CodecError,
  C0_HEADER_BYTES,
  decodeC0Envelope as decodeC0EnvelopeWithPort,
  encodeC0Envelope as encodeC0EnvelopeWithPort,
} from '../../packages/game-core/src/server/protocol/network-c0-codec';

const encodeC0Envelope = (input: Parameters<typeof encodeC0EnvelopeWithPort>[0]) =>
  encodeC0EnvelopeWithPort(input, testCorePlatform.utf8);
const decodeC0Envelope = (input: Uint8Array) => decodeC0EnvelopeWithPort(input, testCorePlatform.utf8);

describe('C0 JSON metadata and binary-block envelope', () => {
  const ref = { protocolVersion: 1 as const, sessionEpoch: 'session:2', worldId: 'world-a', playerId: 'player-a' };

  it('round-trips a projected chunk baseline without V8 serialization', () => {
    const encoded = encodeC0Envelope({
      messageClass: 'chunk-baseline',
      message: {
        kind: 'chunk-baseline',
        ref,
        key: '0,0,0',
        revision: 2,
        generatorVersion: 1,
        canonicalBlock: 'canonical',
        fluidBlock: 'fluid',
      },
      blocks: [
        { name: 'canonical', bytes: Uint8Array.of(1, 0, 2, 0) },
        { name: 'fluid', bytes: Uint8Array.of(8, 0) },
      ],
    });
    expect(decodeC0Envelope(encoded)).toEqual({
      draftVersion: 1,
      messageClass: 'chunk-baseline',
      message: {
        kind: 'chunk-baseline',
        ref,
        key: '0,0,0',
        revision: 2,
        generatorVersion: 1,
        canonicalBlock: 'canonical',
        fluidBlock: 'fluid',
      },
      blocks: [
        { name: 'canonical', bytes: Uint8Array.of(1, 0, 2, 0) },
        { name: 'fluid', bytes: Uint8Array.of(8, 0) },
      ],
    });
  });

  it('rejects invalid header versions and never trusts declared metadata size', () => {
    const encoded = encodeC0Envelope({
      messageClass: 'heartbeat',
      message: { kind: 'heartbeat', ref, nonce: 1 },
      blocks: [],
    });
    const wrongVersion = encoded.slice();
    new DataView(wrongVersion.buffer).setUint16(4, 99, true);
    expect(() => decodeC0Envelope(wrongVersion)).toThrow(C0CodecError);
    const oversizedMetadata = encoded.slice();
    new DataView(oversizedMetadata.buffer).setUint32(8, 0x7fffffff, true);
    expect(() => decodeC0Envelope(oversizedMetadata)).toThrow(/metadata/i);
  });

  it('rejects overlapping or non-contiguous binary block descriptors before exposing payload bytes', () => {
    const encoded = encodeC0Envelope({
      messageClass: 'chunk-baseline',
      message: {
        kind: 'chunk-baseline',
        ref,
        key: '0,0,0',
        revision: 2,
        generatorVersion: 1,
        canonicalBlock: 'canonical',
        fluidBlock: 'fluid',
      },
      blocks: [
        { name: 'canonical', bytes: Uint8Array.of(1, 2) },
        { name: 'fluid', bytes: Uint8Array.of(3, 4) },
      ],
    });
    const metadataLength = new DataView(encoded.buffer).getUint32(8, true);
    const metadata = JSON.parse(
      new TextDecoder().decode(encoded.slice(C0_HEADER_BYTES, C0_HEADER_BYTES + metadataLength)),
    );
    metadata.blocks[1].offset = 1;
    const replacement = new TextEncoder().encode(JSON.stringify(metadata));
    expect(replacement.byteLength).toBe(metadataLength);
    encoded.set(replacement, C0_HEADER_BYTES);
    expect(() => decodeC0Envelope(encoded)).toThrow(/overlap|contiguous/i);
  });
});
