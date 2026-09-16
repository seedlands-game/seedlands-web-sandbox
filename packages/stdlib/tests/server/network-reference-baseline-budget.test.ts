import { describe, expect, it } from 'vitest';
import {
  createBaselineReferenceInFlightLedger,
  createBaselineReferenceSendQueue,
} from '../../src/server/protocol/network-reference-baseline-budget';

describe('baseline reference byte ledgers', () => {
  it('预留不足拒绝，且每份 lease 只结算一次', () => {
    const ledger = createBaselineReferenceInFlightLedger(10);
    const first = ledger.reserve(6);
    expect(first).not.toBeNull();
    expect(ledger.reserve(5)).toBeNull();
    expect(ledger.diagnostics()).toEqual({ reservedBytes: 6, limitBytes: 10 });

    first!.release();
    first!.release();
    expect(ledger.diagnostics()).toEqual({ reservedBytes: 0, limitBytes: 10 });
    const full = ledger.reserve(10);
    expect(full?.bytes).toBe(10);
    full?.release();
  });

  it('发送队列和 in-flight ledger 各自持有独立预算', () => {
    const inFlight = createBaselineReferenceInFlightLedger(10);
    const send = createBaselineReferenceSendQueue(10);
    const source = inFlight.reserve(10);
    expect(source).not.toBeNull();
    expect(send.diagnostics().reservedBytes).toBe(0);
    const delivery = send.reserve(10);
    expect(delivery).not.toBeNull();
    expect(inFlight.diagnostics().reservedBytes).toBe(10);
    delivery!.release();
    source!.release();
  });
});
