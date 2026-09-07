import type { AuthorityBaselineCaptureEntry } from '../authority/authority-baseline-capture-types';
import type {
  BaselineExpectedCapture,
  BaselineReferenceByteLease,
  BaselineReferenceProjectionContext,
  BaselineReferencePublicationQueue,
  PreparedBaselineBundleReference,
  PublishedBaselineBundleReference,
} from './network-reference-baseline-types';
import type { assertBaselineLimits, copyBaselineSessionRef } from './network-reference-baseline-validation';

export type BaselineOwnedBlock = {
  name: 'canonical' | 'fluid';
  elementType: 'uint16-le' | 'uint8';
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
};

export type BaselineOwnedEntry = {
  role: AuthorityBaselineCaptureEntry['role'];
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  blocks: readonly [BaselineOwnedBlock, BaselineOwnedBlock];
};

export type BaselineTrustedProjection = {
  ref: ReturnType<typeof copyBaselineSessionRef>;
  requestId: number;
  interestId: number | null;
  expectedCapture: BaselineExpectedCapture;
  minimumRevision: number;
  referencePagePayloadBytes: number;
  pagesPerBundleMax: number;
  limits: ReturnType<typeof assertBaselineLimits>;
  digest: BaselineReferenceProjectionContext['digest'];
  sizer: BaselineReferenceProjectionContext['sizer'];
  inFlight: BaselineReferenceProjectionContext['inFlight'];
};

/** @internal Shared only by the projector and publication queue. */
export class PreparedBaselineBundle implements PreparedBaselineBundleReference {
  private published = false;
  private entries: BaselineOwnedEntry[] | null;

  constructor(
    entries: BaselineOwnedEntry[],
    readonly trusted: BaselineTrustedProjection,
    readonly checkpoint: Readonly<{ physicsTick: number; commitSequence: number; worldRevision: number }>,
    private readonly reservation: BaselineReferenceByteLease,
    readonly totalPages: number,
  ) {
    this.entries = entries;
  }

  publish(queue: BaselineReferencePublicationQueue): PublishedBaselineBundleReference {
    return queue.publish(this);
  }

  takeForPublication(): BaselineOwnedEntry[] {
    if (this.published || !this.entries) throw new Error('Baseline reference draft is no longer publishable.');
    this.published = true;
    return this.entries;
  }

  releaseFromPublication(): void {
    this.entries = null;
    this.reservation.release();
  }

  discardIfUnpublished(): void {
    if (this.published) return;
    this.entries = null;
    this.reservation.release();
  }

  async cancel(): Promise<void> {
    if (this.published) throw new Error('Published baseline draft must be closed through its published handle.');
    this.entries = null;
    this.reservation.release();
  }
}
