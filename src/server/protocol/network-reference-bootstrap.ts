import type { AuthorityReady } from '../../worker/authority-worker-protocol';
import type { AuthorityCollisionBaselineResult } from '../game-server-types';
import { CHUNK_SIZE } from '../../world/voxel';
import {
  type ChunkBaselineReference,
  type ReferenceBinaryBlock,
  type ReferenceBootstrapContext,
  type ReferenceChunkBaselineContext,
  type ReferenceSessionLimits,
  type WelcomeReference,
} from './network-reference-bootstrap-types';
import { canonicalReferenceInteger } from './network-reference-integer';

export type * from './network-reference-bootstrap-types';

const MAX_TEXT_LENGTH = 256;
const SHA_256_HEX = /^[a-f0-9]{64}$/;
const CELL_COUNT = CHUNK_SIZE ** 3;

const assertText = (value: string, field: string) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_LENGTH)
    throw new TypeError(`${field} must be a non-empty string no longer than ${MAX_TEXT_LENGTH} characters.`);
  return value;
};
const assertSafeInteger = (value: number, field: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new TypeError(`${field} must be a safe integer at least ${minimum}.`);
  return canonicalReferenceInteger(value);
};
const assertFinite = (value: number, field: string) => {
  if (!Number.isFinite(value)) throw new TypeError(`${field} must be finite.`);
  return value;
};
const copyFrequencies = (value: AuthorityReady['frequencies']): WelcomeReference['frequencies'] => {
  if (![30, 60, 120].includes(value.physicsHz)) throw new TypeError('ready.frequencies.physicsHz is unsupported.');
  if (![10, 20].includes(value.gameplayHz)) throw new TypeError('ready.frequencies.gameplayHz is unsupported.');
  if (![20, 30].includes(value.fluidHz)) throw new TypeError('ready.frequencies.fluidHz is unsupported.');
  return { ...value };
};
const copyLimits = (limits: ReferenceSessionLimits): ReferenceSessionLimits => {
  const copy = {
    metadataBytesMax: assertSafeInteger(limits.metadataBytesMax, 'limits.metadataBytesMax', 1),
    reliableMessageBytesMax: assertSafeInteger(limits.reliableMessageBytesMax, 'limits.reliableMessageBytesMax', 1),
    baselineTransferBytesMax: assertSafeInteger(limits.baselineTransferBytesMax, 'limits.baselineTransferBytesMax', 1),
    baselineInFlightBytesMax: assertSafeInteger(limits.baselineInFlightBytesMax, 'limits.baselineInFlightBytesMax', 1),
    inboundMessagesPerSecond: assertSafeInteger(limits.inboundMessagesPerSecond, 'limits.inboundMessagesPerSecond', 1),
    inboundBurst: assertSafeInteger(limits.inboundBurst, 'limits.inboundBurst', 1),
    actionMessagesPerSecond: assertSafeInteger(limits.actionMessagesPerSecond, 'limits.actionMessagesPerSecond', 1),
    interestKeysMax: assertSafeInteger(limits.interestKeysMax, 'limits.interestKeysMax', 1),
    canonicalResidencyMax: assertSafeInteger(limits.canonicalResidencyMax, 'limits.canonicalResidencyMax', 1),
    sendQueueBytesMax: assertSafeInteger(limits.sendQueueBytesMax, 'limits.sendQueueBytesMax', 1),
  };
  if (copy.metadataBytesMax > copy.reliableMessageBytesMax)
    throw new RangeError('limits.metadataBytesMax cannot exceed limits.reliableMessageBytesMax.');
  if (copy.baselineTransferBytesMax > copy.reliableMessageBytesMax)
    throw new RangeError('limits.baselineTransferBytesMax cannot exceed limits.reliableMessageBytesMax.');
  if (copy.baselineInFlightBytesMax < copy.baselineTransferBytesMax)
    throw new RangeError('limits.baselineInFlightBytesMax cannot be less than one baseline transfer.');
  if (copy.inboundBurst < copy.inboundMessagesPerSecond)
    throw new RangeError('limits.inboundBurst cannot be lower than limits.inboundMessagesPerSecond.');
  if (copy.actionMessagesPerSecond > copy.inboundMessagesPerSecond)
    throw new RangeError('limits.actionMessagesPerSecond cannot exceed total inbound rate.');
  return copy;
};

export function projectWelcomeReference(ready: AuthorityReady, context: ReferenceBootstrapContext): WelcomeReference {
  if (context.publicCapabilities.length !== 0)
    throw new TypeError('Reference bootstrap cannot claim public capabilities before adoption.');
  const snapshot = ready.snapshot;
  if (ready.playerId !== snapshot.player.id) throw new TypeError('ready.playerId must match ready.snapshot.player.id.');
  const commitSequence = assertSafeInteger(snapshot.commitSequence, 'ready.snapshot.commitSequence');
  const durableCommitSequence = assertSafeInteger(context.durableCommitSequence, 'context.durableCommitSequence', -1);
  if (durableCommitSequence > commitSequence)
    throw new RangeError('context.durableCommitSequence cannot be newer than the ready snapshot checkpoint.');
  return {
    kind: 'welcome-reference',
    projectionVersion: 1,
    wireStatus: 'not-adopted',
    epoch: assertText(snapshot.epoch, 'ready.snapshot.epoch'),
    serverEpoch: assertText(context.serverEpoch, 'context.serverEpoch'),
    sessionId: assertText(context.sessionId, 'context.sessionId'),
    worldId: assertText(context.worldId, 'context.worldId'),
    playerId: assertText(ready.playerId, 'ready.playerId'),
    seed: assertSafeInteger(ready.seed, 'ready.seed'),
    seedText: assertText(ready.seedText, 'ready.seedText'),
    generatorVersion: assertSafeInteger(ready.generatorVersion, 'ready.generatorVersion', 1),
    gameProtocolVersion: assertSafeInteger(snapshot.protocolVersion, 'ready.snapshot.protocolVersion', 1),
    contentVersion: assertText(context.contentVersion, 'context.contentVersion'),
    physicsSchema: {
      version: assertSafeInteger(context.physicsSchema.version, 'context.physicsSchema.version', 1),
      bodyRegistryVersion: assertSafeInteger(
        context.physicsSchema.bodyRegistryVersion,
        'context.physicsSchema.bodyRegistryVersion',
        1,
      ),
    },
    fluidSchema: {
      version: assertSafeInteger(context.fluidSchema.version, 'context.fluidSchema.version', 1),
      encoding: assertText(context.fluidSchema.encoding, 'context.fluidSchema.encoding'),
    },
    worldTime: assertFinite(ready.worldTime, 'ready.worldTime'),
    frequencies: copyFrequencies(ready.frequencies),
    publicCapabilities: [],
    limits: copyLimits(context.limits),
    initialCheckpoint: {
      commitSequence,
      worldRevision: assertSafeInteger(snapshot.worldRevision, 'ready.snapshot.worldRevision'),
      durableCommitSequence,
    },
  };
}

const copyBlock = async (
  value: ArrayBuffer,
  elementType: ReferenceBinaryBlock['elementType'],
  elementCount: number,
  digest: ReferenceChunkBaselineContext['digest'],
): Promise<ReferenceBinaryBlock> => {
  const bytes = new Uint8Array(value.slice(0));
  const hash = await digest.digest(bytes.slice());
  if (typeof hash !== 'string' || !SHA_256_HEX.test(hash))
    throw new TypeError('SHA-256 digest must be lowercase hexadecimal.');
  return { elementType, elementCount, byteLength: bytes.byteLength, sha256: hash, bytes: bytes.buffer };
};

export async function projectChunkBaselineReference(
  baseline: Extract<AuthorityCollisionBaselineResult, { status: 'available' }>,
  context: ReferenceChunkBaselineContext,
): Promise<ChunkBaselineReference> {
  assertText(context.epoch, 'baseline context epoch');
  assertText(context.worldId, 'baseline context worldId');
  const generatorVersion = assertSafeInteger(context.generatorVersion, 'baseline context generatorVersion', 1);
  if (context.digest.algorithm !== 'sha-256')
    throw new TypeError('Only sha-256 is supported for reference baseline hashes.');
  if (baseline.canonical.byteLength !== CELL_COUNT * Uint16Array.BYTES_PER_ELEMENT)
    throw new RangeError('Collision baseline canonical byte length is invalid.');
  if (baseline.fluid.byteLength !== CELL_COUNT)
    throw new RangeError('Collision baseline fluid byte length is invalid.');
  const [canonical, fluid] = await Promise.all([
    copyBlock(baseline.canonical, 'uint16-source-buffer', CELL_COUNT, context.digest),
    copyBlock(baseline.fluid, 'uint8-source-buffer', CELL_COUNT, context.digest),
  ]);
  return {
    kind: 'chunk-baseline-reference',
    projectionVersion: 1,
    wireStatus: 'not-adopted',
    epoch: context.epoch,
    worldId: context.worldId,
    key: assertText(baseline.key, 'baseline.key'),
    chunkRevision: assertSafeInteger(baseline.chunkRevision, 'baseline.chunkRevision'),
    generatorVersion,
    canonical,
    fluid,
  };
}
