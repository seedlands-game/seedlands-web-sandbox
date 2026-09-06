/** Codec- and transport-neutral bootstrap references. They are not wire v1. */
export type ReferenceSessionLimits = Readonly<{
  metadataBytesMax: number;
  reliableMessageBytesMax: number;
  baselineTransferBytesMax: number;
  baselineInFlightBytesMax: number;
  inboundMessagesPerSecond: number;
  inboundBurst: number;
  actionMessagesPerSecond: number;
  interestKeysMax: number;
  canonicalResidencyMax: number;
  sendQueueBytesMax: number;
}>;

/** This context is supplied by the future authenticated Node session adapter. */
export type ReferenceBootstrapContext = Readonly<{
  worldId: string;
  serverEpoch: string;
  sessionId: string;
  contentVersion: string;
  physicsSchema: Readonly<{ version: number; bodyRegistryVersion: number }>;
  fluidSchema: Readonly<{ version: number; encoding: string }>;
  /** No public network capability is adopted while wire/transport selection is open. */
  publicCapabilities: readonly [];
  limits: ReferenceSessionLimits;
  /** `-1` means this running Host has not produced a durable checkpoint. */
  durableCommitSequence: number;
}>;

export type WelcomeReference = Readonly<{
  kind: 'welcome-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  epoch: string;
  serverEpoch: string;
  sessionId: string;
  worldId: string;
  playerId: string;
  seed: number;
  seedText: string;
  generatorVersion: number;
  gameProtocolVersion: number;
  contentVersion: string;
  physicsSchema: Readonly<{ version: number; bodyRegistryVersion: number }>;
  fluidSchema: Readonly<{ version: number; encoding: string }>;
  worldTime: number;
  frequencies: Readonly<{ physicsHz: 30 | 60 | 120; gameplayHz: 10 | 20; fluidHz: 20 | 30 }>;
  publicCapabilities: readonly [];
  limits: ReferenceSessionLimits;
  initialCheckpoint: Readonly<{ commitSequence: number; worldRevision: number; durableCommitSequence: number }>;
}>;

/** The caller selects a platform implementation, e.g. Node crypto or WebCrypto. */
export type ReferenceSha256DigestPort = Readonly<{
  algorithm: 'sha-256';
  digest: (bytes: Uint8Array) => Promise<string>;
}>;

export type ReferenceChunkBaselineContext = Readonly<{
  epoch: string;
  worldId: string;
  generatorVersion: number;
  digest: ReferenceSha256DigestPort;
}>;

export type ReferenceBinaryBlock = Readonly<{
  /** Source TypedArray bytes only; their byte order is not a finalized network encoding. */
  elementType: 'uint16-source-buffer' | 'uint8-source-buffer';
  elementCount: number;
  byteLength: number;
  sha256: string;
  bytes: ArrayBuffer;
}>;

export type ChunkBaselineReference = Readonly<{
  kind: 'chunk-baseline-reference';
  projectionVersion: 1;
  wireStatus: 'not-adopted';
  epoch: string;
  worldId: string;
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  canonical: ReferenceBinaryBlock;
  fluid: ReferenceBinaryBlock;
}>;
