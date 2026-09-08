import type { FluidAuthoritySnapshot, FluidCandidate } from '../fluid/fluid-transaction';
import type { LogicDecisionOptions } from '../logic/logic-decision';
import type { LogicIntentBatch, LogicObservation } from '../logic/logic-protocol';
import type { GeneratedCanonicalChunk, InitialWorldBootstrap } from '../../compute/world-compute-task';
import type { CoreAbortSignal } from '../../runtime/platform-ports';

export type DedicatedComputeTaskIdentity = Readonly<{
  taskId: number;
  epoch: string;
  generation: number;
  estimatedBytes: number;
}>;

export type DedicatedComputeTask =
  | (DedicatedComputeTaskIdentity &
      Readonly<{
        kind: 'generate-canonical';
        seed: number;
        generatorVersion: number;
        key: string;
        cx: number;
        cy: number;
        cz: number;
      }>)
  | (DedicatedComputeTaskIdentity &
      Readonly<{
        kind: 'find-safe-spawn';
        seed: number;
        generatorVersion: number;
      }>)
  | (DedicatedComputeTaskIdentity &
      Readonly<{
        kind: 'fluid';
        snapshot: FluidAuthoritySnapshot;
      }>)
  | (DedicatedComputeTaskIdentity &
      Readonly<{
        kind: 'logic';
        observation: LogicObservation;
        physicsHz: LogicDecisionOptions['physicsHz'];
      }>);

export type DedicatedComputeResult =
  | GeneratedCanonicalChunk
  | InitialWorldBootstrap
  | Readonly<{ kind: 'fluid-candidate'; candidate: FluidCandidate }>
  | Readonly<{ kind: 'logic-intents'; batch: LogicIntentBatch }>;

export type DedicatedComputeDiagnostics = Readonly<{
  mode: 'inline' | 'worker-thread' | 'child-process';
  generation: number;
  queued: number;
  queuedBytes: number;
  running: number;
  runningBytes: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  staleResults: number;
  childPids: readonly number[];
  workerThreadIds: readonly number[];
  poolSize: number;
  liveSlots: number;
  terminatingSlots: number;
  health: 'healthy' | 'degraded';
  restartCountLastMinute: number;
  ipcBacklogBytes: number;
  slotCompletedTasks: readonly number[];
  taskIdHighWatermark: number;
}>;

export type DedicatedComputeExecutor = Readonly<{
  execute(
    task: DedicatedComputeTask,
    options?: Readonly<{ signal?: CoreAbortSignal; timeoutMs?: number }>,
  ): Promise<DedicatedComputeResult>;
  close(): Promise<void>;
  diagnostics(): DedicatedComputeDiagnostics;
}>;

export class DedicatedComputeCancelledError extends Error {
  constructor(message = 'Dedicated compute task was cancelled.') {
    super(message);
    this.name = 'DedicatedComputeCancelledError';
  }
}
