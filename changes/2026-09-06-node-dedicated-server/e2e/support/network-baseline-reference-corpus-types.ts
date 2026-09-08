import type {
  BaselineBundleDescriptorReference,
  BaselinePageLocator,
  BaselineReferenceLimits,
} from '../../../../packages/game-core/src/server/protocol/network-reference-baseline-types';

export type DerivedPage = Readonly<{
  arrivalIndex: number;
  naturalIndex: number;
  locator: BaselinePageLocator;
  path: string;
  byteLength: number;
  sha256: string;
  metadataBytes: number;
  reliableBytes: number;
}>;

export type DerivedFrame = Readonly<{
  frameId: string;
  source: Readonly<{
    frameId: string;
    scenario: string;
    contentSha256: string;
    captureId: number;
    captureGeneration: number;
    producerInputSha256: string;
    producerOutputSha256: string;
  }>;
  descriptor: BaselineBundleDescriptorReference;
  pageConfig: Readonly<{ referencePagePayloadBytes: number; expectedPageCount: number }>;
  pages: readonly DerivedPage[];
  reassembled: readonly Readonly<{
    entryId: number;
    canonicalSha256: string;
    fluidSha256: string;
  }>[];
  contentSha256: string;
  provenance: Readonly<{
    kind: 'reference-projected-from-source-bound-capture';
    rawManifestSha256: string;
    rawFramesSha256: string;
  }>;
}>;

export type DerivedManifest = Readonly<{
  format: 'seedlands-network-baseline-reference-projected/v1';
  generatedBy: string;
  runtime: Readonly<{ node: string; platform: string; arch: string }>;
  gitSha: string;
  trackedSourceDiffSha256: string;
  sourceFiles: readonly Readonly<{ path: string; sha256: string }>[];
  referenceSourceFiles: readonly string[];
  producerSourceFiles: readonly string[];
  sourceCorpus: Readonly<{
    directory: string;
    manifestSha256: string;
    manifestPayloadSha256: string;
    framesSha256: string;
    corpusSha256: string;
    recordCount: number;
    sidecarCount: number;
  }>;
  config: Readonly<{
    referencePagePayloadBytes: number;
    expectedPages: readonly number[];
    limits: BaselineReferenceLimits;
    digest: 'node:crypto/sha-256';
    sizer: 'json-utf8-metadata-plus-raw-payload/v1';
    order: 'coprime-step-37/v1';
  }>;
  records: readonly Readonly<{ frameId: string; contentSha256: string }>[];
  notCollected: readonly string[];
  manifestPayloadSha256: string;
  corpusSha256: string;
}>;

export type NetworkBaselineReferenceCorpus = Readonly<{
  manifest: DerivedManifest;
  frames: readonly DerivedFrame[];
}>;
