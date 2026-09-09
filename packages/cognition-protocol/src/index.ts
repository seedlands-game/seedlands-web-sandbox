import type {
  CharacterGoal,
  CharacterObservation,
  ControlBinding,
  ControllerReceipt,
} from '@seedlands/game-core/runtime/character-control-protocol';
export * from './resident-protocol';

export const CONTROLLER_FRAME_MAX_BYTES = 128 * 1024;

type ControllerEnvelope = Readonly<{ protocolVersion: 1; binding: ControlBinding; sequence: number }>;
export type ControllerClientMessage = ControllerEnvelope &
  (
    | Readonly<{ kind: 'hello'; pairingToken: string }>
    | Readonly<{ kind: 'observe'; observation: CharacterObservation }>
    | Readonly<{ kind: 'receipt'; receipt: ControllerReceipt }>
    | Readonly<{ kind: 'control'; command: 'pause' | 'resume' | 'unbind' }>
    | Readonly<{ kind: 'configure'; fallbackSeconds: number; contextLimit: 128000 | 256000 }>
  );
export type ControllerUsage = Readonly<{
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  compressionCalls: number;
  estimatedCostUsd: number;
}>;
export type ControllerHostMessage =
  | (ControllerEnvelope &
      (
        | Readonly<{
            kind: 'ready';
            fallbackSeconds: number;
            modelAvailability: 'available' | 'missing-key' | 'unavailable';
          }>
        | Readonly<{
            kind: 'intent';
            requestId: string;
            observedRevision: number;
            observedCursor: number;
            intent: Readonly<{ goal: CharacterGoal; say?: string }>;
          }>
        | Readonly<{
            kind: 'memory';
            requestId: string;
            summary: string;
            throughCursor: number;
            expectedMemoryRevision: number;
          }>
        | Readonly<{
            kind: 'status';
            state: 'ready' | 'thinking' | 'compressing' | 'awaiting-receipt' | 'fallback' | 'paused';
            reason?:
              'missing-key' | 'timeout' | 'rate-limited' | 'invalid-tool' | 'over-budget' | 'transport' | 'stale';
            usage?: ControllerUsage;
          }>
      ))
  | Readonly<{
      kind: 'error';
      protocolVersion: 1;
      sequence: number;
      code:
        | 'BAD_FRAME'
        | 'PAIRING_REJECTED'
        | 'ORIGIN_REJECTED'
        | 'BINDING_MISMATCH'
        | 'STALE_SEQUENCE'
        | 'FRAME_TOO_LARGE';
      message: string;
    }>;
