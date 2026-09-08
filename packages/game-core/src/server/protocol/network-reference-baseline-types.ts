import type {
  AuthorityBaselineCapturePurpose,
  AuthorityBaselineCaptureResult,
} from '../authority/authority-baseline-capture-types';
import type { ReferenceSessionLimits, ReferenceSha256DigestPort } from './network-reference-bootstrap-types';
import type { InterestSessionRef } from './network-reference-interest-control';

export const NETWORK_REFERENCE_BASELINE_VERSION = 1 as const;
export const NETWORK_REFERENCE_BASELINE_PAGES_MAX = 512 as const;
export const NETWORK_REFERENCE_BASELINE_COMPLETION_WINDOW = 256 as const;
export const NETWORK_REFERENCE_BASELINE_PUBLICATION_QUEUE_MAX = 256 as const;
export const NETWORK_REFERENCE_BASELINE_CELL_COUNT = 32 ** 3;
export const NETWORK_REFERENCE_BASELINE_METADATA_BYTES_MAX = 64 * 1024;
export const NETWORK_REFERENCE_BASELINE_TRANSFER_BYTES_MAX = 1024 * 1024;
export const NETWORK_REFERENCE_BASELINE_IN_FLIGHT_BYTES_MAX = 16 * 1024 * 1024;
export const NETWORK_REFERENCE_BASELINE_SEND_QUEUE_BYTES_MAX = 4 * 1024 * 1024;

export type BaselineReferenceSizer = Readonly<{
  measureMetadataBytes(value: unknown): number;
  measureReliableMessageBytes(metadata: unknown, payload: Uint8Array): number;
}>;

export type BaselineReferenceLimits = Pick<
  ReferenceSessionLimits,
  | 'metadataBytesMax'
  | 'reliableMessageBytesMax'
  | 'baselineTransferBytesMax'
  | 'baselineInFlightBytesMax'
  | 'sendQueueBytesMax'
>;

export type BaselineExpectedCapture = Readonly<{
  captureId: number;
  captureGeneration: number;
  purpose: AuthorityBaselineCapturePurpose;
  key: string;
  generatorVersion: number;
}>;

export type BaselineReferenceProjectionContext = Readonly<{
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  expectedCapture: BaselineExpectedCapture;
  minimumRevision: number;
  referencePagePayloadBytes: number;
  pagesPerBundleMax: number;
  limits: BaselineReferenceLimits;
  digest: ReferenceSha256DigestPort;
  sizer: BaselineReferenceSizer;
  inFlight: BaselineReferenceInFlightLedger;
}>;

export type BaselineBlockDescriptorReference = Readonly<{
  name: 'canonical' | 'fluid';
  transferId: number;
  elementType: 'uint16-le' | 'uint8';
  elementCount: typeof NETWORK_REFERENCE_BASELINE_CELL_COUNT;
  byteLength: number;
  referencePagePayloadBytes: number;
  pageCount: number;
  sha256: string;
}>;

export type BaselineEntryDescriptorReference = Readonly<{
  entryId: number;
  role: 'main' | 'overlay' | 'collision-resync';
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  blocks: readonly [BaselineBlockDescriptorReference, BaselineBlockDescriptorReference];
}>;

export type BaselineBundleDescriptorReference = Readonly<{
  kind: 'baseline-bundle-descriptor-reference';
  projectionVersion: typeof NETWORK_REFERENCE_BASELINE_VERSION;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  bundleId: number;
  purpose: AuthorityBaselineCapturePurpose;
  key: string;
  minimumRevision: number;
  authorityCheckpoint: Readonly<{ physicsTick: number; commitSequence: number; worldRevision: number }>;
  entries: readonly BaselineEntryDescriptorReference[];
}>;

export type BaselinePageReference = Readonly<{
  kind: 'baseline-page-reference';
  projectionVersion: typeof NETWORK_REFERENCE_BASELINE_VERSION;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  bundleId: number;
  purpose: AuthorityBaselineCapturePurpose;
  entryId: number;
  transferId: number;
  block: 'canonical' | 'fluid';
  pageIndex: number;
  pageCount: number;
  byteOffset: number;
  bytes: Uint8Array;
}>;

export type BaselineUnavailableReference = Readonly<{
  kind: 'baseline-unavailable-reference';
  projectionVersion: typeof NETWORK_REFERENCE_BASELINE_VERSION;
  wireStatus: 'not-adopted';
  ref: InterestSessionRef;
  requestId: number;
  interestId: number | null;
  purpose: AuthorityBaselineCapturePurpose;
  key: string;
  minimumRevision: number;
  reason: Extract<AuthorityBaselineCaptureResult, { status: 'unavailable' }>['reason'] | 'transfer-limit';
}>;

export type BaselinePageLocator = Readonly<{
  entryId: number;
  block: 'canonical' | 'fluid';
  pageIndex: number;
}>;

export type BaselineReferenceByteLease = Readonly<{ bytes: number; release(): void }>;
export type BaselineReferenceInFlightLedger = Readonly<{
  limitBytes: number;
  reserve(bytes: number): BaselineReferenceByteLease | null;
  diagnostics(): Readonly<{ reservedBytes: number; limitBytes: number }>;
}>;
export type BaselineReferenceSendQueue = BaselineReferenceInFlightLedger;

export type BaselinePageLease = Readonly<{ page: BaselinePageReference; settle(): void }>;
export type BaselineDescriptorLease = Readonly<{ descriptor: BaselineBundleDescriptorReference; settle(): void }>;

export type PreparedBaselineBundleReference = Readonly<{
  publish(queue: BaselineReferencePublicationQueue): PublishedBaselineBundleReference;
  cancel(): Promise<void>;
}>;

export type PublishedBaselineBundleReference = Readonly<{
  descriptor: BaselineBundleDescriptorReference;
  pageCount: number;
  materializePage(locator: BaselinePageLocator, queue: BaselineReferenceSendQueue): BaselinePageLease | null;
  close(): void;
}>;

export type BaselineReferencePublicationQueue = Readonly<{
  publish(prepared: PreparedBaselineBundleReference): PublishedBaselineBundleReference;
  takeDescriptor(queue: BaselineReferenceSendQueue): BaselineDescriptorLease | null;
  close(): void;
  diagnostics(): Readonly<{ queuedDescriptors: number; closed: boolean; bundleIdHighWatermark: number }>;
}>;

export type ReassembledBaselineReference = Readonly<{
  descriptor: BaselineBundleDescriptorReference;
  entries: readonly Readonly<{
    entryId: number;
    canonicalLittleEndian: Uint8Array;
    fluid: Uint8Array;
  }>[];
}>;

export type BaselineReferenceReassembler = Readonly<{
  acceptDescriptor(descriptor: unknown): void;
  acceptPage(page: unknown): Promise<ReassembledBaselineReference | null>;
  clearBundle(bundleId: number, reason: 'cancelled' | 'timeout' | 'schema-error' | 'hash-error'): Promise<void>;
  cancel(bundleId: number): Promise<'cancelled' | 'already-settled' | 'unknown'>;
  close(): Promise<void>;
  whenIdle(): Promise<void>;
  diagnostics(): Readonly<{
    activeBundles: number;
    digestingTransfers: number;
    reservedBlockBytes: number;
    bundleIdHighWatermark: number;
  }>;
}>;

export type BaselineReferenceReassemblerOptions = Readonly<{
  ref: InterestSessionRef;
  limits: BaselineReferenceLimits;
  pagesPerBundleMax: number;
  digest: ReferenceSha256DigestPort;
  sizer: BaselineReferenceSizer;
  inFlight: BaselineReferenceInFlightLedger;
}>;
