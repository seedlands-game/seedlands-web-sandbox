import { authorityBaselineCaptureKeys } from '../../../packages/game-core/src/server/authority/authority-baseline-capture';
import {
  NETWORK_REFERENCE_BASELINE_CELL_COUNT,
  type BaselineBlockDescriptorReference,
  type ReassembledBaselineReference,
} from '../../../packages/game-core/src/server/protocol/network-reference-baseline-types';
import type { InterestSessionRef } from '../../../packages/game-core/src/server/protocol/network-reference-interest-control';
import type { NetworkBaselineOwnerRef } from '../../../apps/web/src/client/authority/network-baseline-consumer-types';

export const BASELINE_BYTES_PER_CHUNK = NETWORK_REFERENCE_BASELINE_CELL_COUNT * 3;
export const TEST_BASELINE_REF: InterestSessionRef = Object.freeze({
  epoch: 'epoch-1',
  serverEpoch: 'server-1',
  sessionId: 'session-1',
  worldId: 'world-1',
});

export function makeBaselineOwner(
  options: Partial<NetworkBaselineOwnerRef> &
    Readonly<{
      purpose?: 'mesh' | 'collision-resync';
      ownerId?: number;
      ownerGeneration?: number;
      minimumRevision?: number;
    }> = {},
): NetworkBaselineOwnerRef {
  const purpose = options.purpose ?? 'mesh';
  const key = options.key ?? '0,0,0';
  const minimumRevision = options.minimumRevision ?? options.expectedEntries?.[0]?.minimumRevision ?? 2;
  const keys = authorityBaselineCaptureKeys({ captureId: 0, purpose, key, minimumRevision });
  const orderedKeys = purpose === 'mesh' ? [key, ...keys.filter((candidate) => candidate !== key)] : [key];
  return {
    ref: options.ref ?? TEST_BASELINE_REF,
    ownerId: options.ownerId ?? 1,
    ownerGeneration: options.ownerGeneration ?? 1,
    requestId: options.requestId ?? 11,
    interestId: options.interestId === undefined ? (purpose === 'mesh' ? 7 : null) : options.interestId,
    purpose,
    key,
    generatorVersion: options.generatorVersion ?? 3,
    expectedEntries: options.expectedEntries ?? orderedKeys.map((entryKey) => ({ key: entryKey, minimumRevision })),
  };
}

function blockDescriptor(name: 'canonical' | 'fluid', transferId: number): BaselineBlockDescriptorReference {
  const byteLength = NETWORK_REFERENCE_BASELINE_CELL_COUNT * (name === 'canonical' ? 2 : 1);
  return {
    name,
    transferId,
    elementType: name === 'canonical' ? 'uint16-le' : 'uint8',
    elementCount: NETWORK_REFERENCE_BASELINE_CELL_COUNT,
    byteLength,
    referencePagePayloadBytes: byteLength,
    pageCount: 1,
    sha256: 'a'.repeat(64),
  };
}

function littleEndianCanonical(value: number): Uint8Array {
  const bytes = new Uint8Array(NETWORK_REFERENCE_BASELINE_CELL_COUNT * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  view.setUint16(2, 0xabcd, true);
  return bytes;
}

export function makeReassembledBaseline(
  owner: NetworkBaselineOwnerRef,
  options: Readonly<{
    revision?: number;
    canonicalValue?: number;
    fluidValue?: number;
    requestId?: number;
    ref?: InterestSessionRef;
  }> = {},
): ReassembledBaselineReference {
  const revision = options.revision ?? owner.expectedEntries[0]!.minimumRevision;
  let transferId = 100;
  const entries = owner.expectedEntries.map((expected, index) => {
    const canonical = littleEndianCanonical((options.canonicalValue ?? 0x1234) + index);
    const fluid = new Uint8Array(NETWORK_REFERENCE_BASELINE_CELL_COUNT);
    fluid[0] = options.fluidValue ?? index;
    return {
      descriptor: {
        entryId: index,
        role:
          owner.purpose === 'collision-resync'
            ? ('collision-resync' as const)
            : index === 0
              ? ('main' as const)
              : ('overlay' as const),
        key: expected.key,
        chunkRevision: revision,
        generatorVersion: owner.generatorVersion,
        blocks: [blockDescriptor('canonical', transferId++), blockDescriptor('fluid', transferId++)] as const,
      },
      entryId: index,
      canonicalLittleEndian: canonical,
      fluid,
    };
  });
  return {
    descriptor: {
      kind: 'baseline-bundle-descriptor-reference',
      projectionVersion: 1,
      wireStatus: 'not-adopted',
      ref: options.ref ?? owner.ref,
      requestId: options.requestId ?? owner.requestId,
      interestId: owner.interestId,
      bundleId: owner.ownerGeneration,
      purpose: owner.purpose,
      key: owner.key,
      minimumRevision: owner.expectedEntries[0]!.minimumRevision,
      authorityCheckpoint: { physicsTick: 4, commitSequence: 5, worldRevision: 6 },
      entries: entries.map(({ descriptor }) => descriptor),
    },
    entries: entries.map(({ descriptor: _descriptor, ...entry }) => entry),
  };
}

export function nativeCanonical(value = 0x1234): ArrayBuffer {
  const canonical = new Uint16Array(NETWORK_REFERENCE_BASELINE_CELL_COUNT);
  canonical[0] = value;
  canonical[1] = 0xabcd;
  return canonical.buffer;
}
