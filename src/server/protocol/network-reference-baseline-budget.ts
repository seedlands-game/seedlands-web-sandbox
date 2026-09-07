import type {
  BaselineReferenceByteLease,
  BaselineReferenceInFlightLedger,
  BaselineReferenceSendQueue,
} from './network-reference-baseline-types';

class ReferenceByteLedger implements BaselineReferenceInFlightLedger {
  private reservedBytes = 0;

  constructor(readonly limitBytes: number) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 1)
      throw new RangeError('Baseline reference byte limit must be a positive safe integer.');
  }

  reserve(bytes: number): BaselineReferenceByteLease | null {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new RangeError('Baseline reference reservation must be a non-negative safe integer.');
    if (this.reservedBytes + bytes > this.limitBytes) return null;
    this.reservedBytes += bytes;
    let released = false;
    return Object.freeze({
      bytes,
      release: () => {
        if (released) return;
        released = true;
        this.reservedBytes -= bytes;
      },
    });
  }

  diagnostics() {
    return Object.freeze({ reservedBytes: this.reservedBytes, limitBytes: this.limitBytes });
  }
}

export function createBaselineReferenceInFlightLedger(limitBytes: number): BaselineReferenceInFlightLedger {
  return new ReferenceByteLedger(limitBytes);
}

export function createBaselineReferenceSendQueue(limitBytes: number): BaselineReferenceSendQueue {
  return new ReferenceByteLedger(limitBytes);
}
