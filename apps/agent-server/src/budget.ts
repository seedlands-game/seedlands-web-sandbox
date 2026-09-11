import type { ControllerUsage } from '@seedlands/cognition-protocol';
import type { ModelUsage } from './model-types.js';

export type BudgetLimits = Readonly<{
  maxCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxOutputTokensPerCall: number;
}>;

/** Session-lifetime budget. A fresh runtime session creates a fresh ledger. */
export const DEFAULT_SESSION_BUDGET: BudgetLimits = {
  maxCalls: 120,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 64_000,
  maxOutputTokensPerCall: 4096,
};

export type BudgetReservation = Readonly<{
  id: number;
  inputTokens: number;
  outputTokens: number;
  compression: boolean;
}>;

export class CognitionBudget {
  private nextId = 1;
  private calls = 0;
  private inputTokens = 0;
  private cachedTokens = 0;
  private outputTokens = 0;
  private compressionCalls = 0;
  private estimatedCostUsd = 0;
  private readonly reservations = new Map<number, BudgetReservation>();

  constructor(private readonly limits: BudgetLimits = DEFAULT_SESSION_BUDGET) {}

  reserve(inputTokens: number, outputTokens: number, compression = false): BudgetReservation | null {
    const safeInput = Math.max(0, Math.ceil(inputTokens));
    const safeOutput = Math.min(this.limits.maxOutputTokensPerCall, Math.max(0, Math.ceil(outputTokens)));
    let reservedInput = 0;
    let reservedOutput = 0;
    for (const entry of this.reservations.values()) {
      reservedInput += entry.inputTokens;
      reservedOutput += entry.outputTokens;
    }
    if (
      this.calls + this.reservations.size + 1 > this.limits.maxCalls ||
      this.inputTokens + reservedInput + safeInput > this.limits.maxInputTokens ||
      this.outputTokens + reservedOutput + safeOutput > this.limits.maxOutputTokens
    )
      return null;
    const reservation = { id: this.nextId++, inputTokens: safeInput, outputTokens: safeOutput, compression };
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  settle(reservation: BudgetReservation, usage: ModelUsage | null): void {
    if (!this.reservations.delete(reservation.id)) return;
    this.calls += 1;
    this.inputTokens += usage?.inputTokens ?? reservation.inputTokens;
    this.cachedTokens += usage?.cacheHitTokens ?? 0;
    this.outputTokens += usage?.outputTokens ?? reservation.outputTokens;
    if (reservation.compression) this.compressionCalls += 1;
    const billedInput = usage?.inputTokens ?? reservation.inputTokens;
    const cached = Math.min(billedInput, usage?.cacheHitTokens ?? 0);
    const uncached = Math.max(0, billedInput - cached);
    const billedOutput = usage?.outputTokens ?? reservation.outputTokens;
    // Conservative public list-price estimate as of 2026-09-09; this is not an actual provider invoice.
    const rates = reservation.compression
      ? { cached: 0.044, uncached: 1.32, output: 3.96 }
      : { cached: 0.014, uncached: 0.44, output: 1.32 };
    this.estimatedCostUsd +=
      (cached * rates.cached + uncached * rates.uncached + billedOutput * rates.output) / 1_000_000;
  }

  release(reservation: BudgetReservation): void {
    this.reservations.delete(reservation.id);
  }

  snapshot(): ControllerUsage {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      cachedTokens: this.cachedTokens,
      outputTokens: this.outputTokens,
      compressionCalls: this.compressionCalls,
      estimatedCostUsd: this.estimatedCostUsd,
    };
  }
}
