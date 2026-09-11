import type { LogicIntentBatch, LogicObservation } from '@seedlands/game-core/server/logic/logic-protocol';

export const DIRECT_LOGIC_PROTOCOL_VERSION = 1 as const;

export type DirectLogicMessage =
  | Readonly<{
      kind: 'direct-logic-observation';
      protocolVersion: typeof DIRECT_LOGIC_PROTOCOL_VERSION;
      observation: LogicObservation;
    }>
  | Readonly<{
      kind: 'direct-logic-intents';
      protocolVersion: typeof DIRECT_LOGIC_PROTOCOL_VERSION;
      batch: LogicIntentBatch;
    }>
  | Readonly<{
      kind: 'direct-logic-reset';
      protocolVersion: typeof DIRECT_LOGIC_PROTOCOL_VERSION;
      epoch: string;
      nextEpoch: string;
    }>;

export type DirectLogicAttachRequest = Readonly<{
  kind: 'attach-direct-logic';
  protocolVersion: typeof DIRECT_LOGIC_PROTOCOL_VERSION;
  epoch: string;
  port: MessagePort;
}>;

export type DirectLogicDiagnostics = Readonly<{
  kind: 'direct-logic-diagnostics';
  protocolVersion: typeof DIRECT_LOGIC_PROTOCOL_VERSION;
  epoch: string;
  observationInFlight: boolean;
  pendingObservationCount: 0 | 1;
  submittedObservationCount: number;
  receivedBatchCount: number;
  completedBatchCount: number;
  rejectedBatchCount: number;
  lastRoundTripMs: number | null;
}>;
