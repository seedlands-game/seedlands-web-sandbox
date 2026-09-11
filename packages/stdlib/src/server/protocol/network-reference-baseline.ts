import { authorityBaselineCaptureKeys } from '../authority/authority-baseline-capture';
import type {
  AuthorityBaselineCaptureEntry,
  AuthorityBaselineCaptureResult,
} from '../authority/authority-baseline-capture-types';
import { canonicalReferenceInteger } from './network-reference-integer';
import {
  PreparedBaselineBundle,
  type BaselineOwnedEntry,
  type BaselineTrustedProjection,
} from './network-reference-baseline-owned';
import {
  assertBaselineLimits,
  assertDenseArray,
  assertExactRecord,
  copyBaselineSessionRef,
  referenceIdentifier,
  referenceText,
} from './network-reference-baseline-validation';
import {
  NETWORK_REFERENCE_BASELINE_CELL_COUNT,
  NETWORK_REFERENCE_BASELINE_PAGES_MAX,
  NETWORK_REFERENCE_BASELINE_VERSION,
  type BaselineExpectedCapture,
  type BaselineReferenceProjectionContext,
  type BaselineUnavailableReference,
  type PreparedBaselineBundleReference,
} from './network-reference-baseline-types';
import type { CoreAbortSignal } from '../../runtime/platform-ports';

export type * from './network-reference-baseline-types';
export { createBaselineReferencePublicationQueue } from './network-reference-baseline-publication';

const CANONICAL_BYTES = NETWORK_REFERENCE_BASELINE_CELL_COUNT * Uint16Array.BYTES_PER_ELEMENT;
const FLUID_BYTES = NETWORK_REFERENCE_BASELINE_CELL_COUNT;

const abortError = () =>
  Object.assign(new Error('Baseline reference projection was cancelled.'), { name: 'AbortError' });

function validateExpectedCapture(value: unknown): BaselineExpectedCapture {
  const source = assertExactRecord(
    value,
    ['captureId', 'captureGeneration', 'purpose', 'key', 'generatorVersion'],
    'expectedCapture',
  );
  if (source.purpose !== 'mesh' && source.purpose !== 'collision-resync')
    throw new TypeError('expectedCapture.purpose is invalid.');
  return Object.freeze({
    captureId: referenceIdentifier(source.captureId, 'expectedCapture.captureId'),
    captureGeneration: referenceIdentifier(source.captureGeneration, 'expectedCapture.captureGeneration'),
    purpose: source.purpose,
    key: referenceText(source.key, 'expectedCapture.key'),
    generatorVersion: referenceIdentifier(source.generatorVersion, 'expectedCapture.generatorVersion', 1),
  });
}

function validateContext(context: BaselineReferenceProjectionContext): BaselineTrustedProjection {
  const limits = assertBaselineLimits(context.limits);
  const pagesPerBundleMax = referenceIdentifier(context.pagesPerBundleMax, 'pagesPerBundleMax', 1);
  if (pagesPerBundleMax > NETWORK_REFERENCE_BASELINE_PAGES_MAX)
    throw new RangeError('pagesPerBundleMax exceeds the reference ceiling.');
  if (context.inFlight.limitBytes > limits.baselineInFlightBytesMax)
    throw new RangeError('Baseline in-flight ledger exceeds the trusted limit.');
  if (context.digest.algorithm !== 'sha-256' || typeof context.digest.digest !== 'function')
    throw new TypeError('Baseline digest port is invalid.');
  if (
    typeof context.sizer.measureMetadataBytes !== 'function' ||
    typeof context.sizer.measureReliableMessageBytes !== 'function'
  )
    throw new TypeError('Baseline sizer port is invalid.');
  const expectedCapture = validateExpectedCapture(context.expectedCapture);
  const minimumRevision = referenceIdentifier(context.minimumRevision, 'baseline minimumRevision');
  authorityBaselineCaptureKeys({
    captureId: expectedCapture.captureId,
    purpose: expectedCapture.purpose,
    key: expectedCapture.key,
    minimumRevision,
  });
  const interestId =
    context.interestId === null ? null : referenceIdentifier(context.interestId, 'baseline interestId');
  if (expectedCapture.purpose === 'mesh' && interestId === null)
    throw new TypeError('Mesh baseline projection requires an interestId.');
  return {
    ref: copyBaselineSessionRef(context.ref, 'baseline trusted ref'),
    requestId: referenceIdentifier(context.requestId, 'baseline requestId'),
    interestId,
    expectedCapture,
    minimumRevision,
    referencePagePayloadBytes: referenceIdentifier(context.referencePagePayloadBytes, 'referencePagePayloadBytes', 1),
    pagesPerBundleMax,
    limits,
    digest: context.digest,
    sizer: context.sizer,
    inFlight: context.inFlight,
  };
}

function unavailable(
  context: BaselineTrustedProjection,
  reason: BaselineUnavailableReference['reason'],
): BaselineUnavailableReference {
  return Object.freeze({
    kind: 'baseline-unavailable-reference',
    projectionVersion: NETWORK_REFERENCE_BASELINE_VERSION,
    wireStatus: 'not-adopted',
    ref: context.ref,
    requestId: context.requestId,
    interestId: context.interestId,
    purpose: context.expectedCapture.purpose,
    key: context.expectedCapture.key,
    minimumRevision: context.minimumRevision,
    reason,
  });
}

function validateCaptureIdentity(capture: AuthorityBaselineCaptureResult, context: BaselineTrustedProjection): void {
  if (capture.status !== 'available' && capture.status !== 'unavailable')
    throw new TypeError('Authority baseline capture status is invalid.');
  const fields =
    capture.status === 'available'
      ? ['status', 'captureId', 'captureGeneration', 'purpose', 'key', 'checkpoint', 'entries']
      : ['status', 'captureId', 'captureGeneration', 'purpose', 'key', 'reason'];
  assertExactRecord(capture, fields, 'Authority baseline capture');
  const expected = context.expectedCapture;
  if (
    capture.captureId !== expected.captureId ||
    capture.captureGeneration !== expected.captureGeneration ||
    capture.purpose !== expected.purpose ||
    capture.key !== expected.key
  )
    throw new TypeError('Authority baseline capture identity does not match its trusted expectation.');
  if (
    capture.status === 'unavailable' &&
    !['cancelled', 'not-available', 'residency-pressure', 'superseded', 'stopping'].includes(capture.reason)
  )
    throw new TypeError('Authority baseline capture unavailable reason is invalid.');
}

function validateAvailableCapture(
  capture: Extract<AuthorityBaselineCaptureResult, { status: 'available' }>,
  context: BaselineTrustedProjection,
): readonly AuthorityBaselineCaptureEntry[] {
  const checkpoint = assertExactRecord(
    capture.checkpoint,
    ['epoch', 'physicsTick', 'commitSequence', 'worldRevision'],
    'capture checkpoint',
  );
  if (checkpoint.epoch !== context.ref.epoch) throw new TypeError('Capture epoch does not match the trusted ref.');
  referenceIdentifier(checkpoint.physicsTick, 'capture checkpoint physicsTick');
  referenceIdentifier(checkpoint.commitSequence, 'capture checkpoint commitSequence');
  referenceIdentifier(checkpoint.worldRevision, 'capture checkpoint worldRevision');
  const source = assertDenseArray(capture.entries, 27, 'capture entries');
  const expectedCount = capture.purpose === 'mesh' ? 27 : 1;
  if (source.length !== expectedCount) throw new TypeError(`Capture must contain ${expectedCount} entries.`);
  const keys = authorityBaselineCaptureKeys({
    captureId: capture.captureId,
    purpose: capture.purpose,
    key: capture.key,
    minimumRevision: context.minimumRevision,
  });
  const orderedKeys = capture.purpose === 'mesh' ? [capture.key, ...keys.filter((key) => key !== capture.key)] : keys;
  const buffers = new Set<ArrayBuffer>();
  source.forEach((entry, index) => {
    const item = assertExactRecord(
      entry,
      ['role', 'key', 'chunkRevision', 'generatorVersion', 'canonical', 'fluid'],
      `capture entry[${index}]`,
    );
    const role = capture.purpose === 'collision-resync' ? 'collision-resync' : index === 0 ? 'main' : 'overlay';
    if (item.role !== role || item.key !== orderedKeys[index])
      throw new TypeError(`Capture entry[${index}] identity is invalid.`);
    const revision = referenceIdentifier(item.chunkRevision, `capture entry[${index}].chunkRevision`);
    if (index === 0 && revision < context.minimumRevision) throw new TypeError('Capture main revision is too old.');
    if (item.generatorVersion !== context.expectedCapture.generatorVersion)
      throw new TypeError('Capture generatorVersion does not match its trusted expectation.');
    if (!(item.canonical instanceof ArrayBuffer) || item.canonical.byteLength !== CANONICAL_BYTES)
      throw new TypeError('Capture canonical buffer is invalid.');
    if (!(item.fluid instanceof ArrayBuffer) || item.fluid.byteLength !== FLUID_BYTES)
      throw new TypeError('Capture fluid buffer is invalid.');
    if (buffers.has(item.canonical) || buffers.has(item.fluid))
      throw new TypeError('Capture buffers must have unique ownership.');
    buffers.add(item.canonical);
    buffers.add(item.fluid);
  });
  return source as readonly AuthorityBaselineCaptureEntry[];
}

function canonicalLittleEndian(source: ArrayBuffer): Uint8Array {
  const values = new Uint16Array(source);
  const output = new Uint8Array(CANONICAL_BYTES);
  const view = new DataView(output.buffer);
  for (let index = 0; index < values.length; index += 1) view.setUint16(index * 2, values[index]!, true);
  return output;
}

export async function prepareAuthorityBaselineReference(
  capture: AuthorityBaselineCaptureResult,
  input: BaselineReferenceProjectionContext,
  options: Readonly<{ signal?: CoreAbortSignal }> = {},
): Promise<BaselineUnavailableReference | PreparedBaselineBundleReference> {
  const context = validateContext(input);
  validateCaptureIdentity(capture, context);
  if (capture.status === 'unavailable') return unavailable(context, capture.reason);
  const entries = validateAvailableCapture(capture, context);
  const checkpoint = Object.freeze({
    physicsTick: canonicalReferenceInteger(capture.checkpoint.physicsTick),
    commitSequence: canonicalReferenceInteger(capture.checkpoint.commitSequence),
    worldRevision: canonicalReferenceInteger(capture.checkpoint.worldRevision),
  });
  const canonicalPages = Math.ceil(CANONICAL_BYTES / context.referencePagePayloadBytes);
  const fluidPages = Math.ceil(FLUID_BYTES / context.referencePagePayloadBytes);
  const totalPages = entries.length * (canonicalPages + fluidPages);
  if (totalPages > context.pagesPerBundleMax || totalPages > NETWORK_REFERENCE_BASELINE_PAGES_MAX)
    return unavailable(context, 'transfer-limit');
  if (CANONICAL_BYTES > context.limits.baselineTransferBytesMax) return unavailable(context, 'transfer-limit');
  const totalBytes = entries.length * (CANONICAL_BYTES + FLUID_BYTES);
  if (totalBytes > context.limits.baselineInFlightBytesMax || options.signal?.aborted)
    return options.signal?.aborted ? Promise.reject(abortError()) : unavailable(context, 'transfer-limit');
  const reservation = context.inFlight.reserve(totalBytes);
  if (!reservation) return unavailable(context, 'transfer-limit');
  try {
    const owned: BaselineOwnedEntry[] = entries.map((entry) => ({
      role: entry.role,
      key: entry.key,
      chunkRevision: canonicalReferenceInteger(entry.chunkRevision),
      generatorVersion: canonicalReferenceInteger(entry.generatorVersion),
      blocks: [
        {
          name: 'canonical',
          elementType: 'uint16-le',
          bytes: canonicalLittleEndian(entry.canonical),
          sha256: '',
          pageCount: canonicalPages,
        },
        {
          name: 'fluid',
          elementType: 'uint8',
          bytes: new Uint8Array(entry.fluid.slice(0)),
          sha256: '',
          pageCount: fluidPages,
        },
      ],
    }));
    const blocks = owned.flatMap((entry) => entry.blocks);
    const hashes = await Promise.allSettled(
      blocks.map((block) => Promise.resolve().then(() => context.digest.digest(block.bytes))),
    );
    const rejected = hashes.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    if (options.signal?.aborted) throw abortError();
    hashes.forEach((result, index) => {
      const hash = (result as PromiseFulfilledResult<string>).value;
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('Baseline digest result is invalid.');
      blocks[index]!.sha256 = hash;
    });
    return new PreparedBaselineBundle(owned, context, checkpoint, reservation, totalPages);
  } catch (error) {
    reservation.release();
    throw error;
  }
}
