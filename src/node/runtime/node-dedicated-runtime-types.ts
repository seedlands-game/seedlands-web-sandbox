import type { NodeComputeExecutorEntryPoints, NodeComputeExecutorMode } from '../compute/node-compute-executor';
import type { FileStoreLimits } from '../persistence/file-game-persistence';
import type { DedicatedHostOptions } from '../../server/dedicated/dedicated-host-types';
import type { DedicatedComputeDiagnostics } from '../../server/compute/dedicated-compute-contract';

export type NodeDedicatedRuntimeState = 'running' | 'stopping' | 'stopped' | 'failed';

export type NodeDedicatedComputeLimits = Readonly<{
  maxTasks: number;
  maxBytes: number;
  maxResultBytes: number;
  poolSize: number;
}>;

export type NodeDedicatedRuntimeOptions = Readonly<{
  seedText: string;
  dataDirectory: string;
  generatorVersion?: number;
  worldId?: string;
  computeMode?: NodeComputeExecutorMode;
  computeEntries?: NodeComputeExecutorEntryPoints;
  computeLimits?: Partial<NodeDedicatedComputeLimits>;
  persistenceLimits?: Partial<FileStoreLimits>;
  hostLimits?: DedicatedHostOptions['limits'];
  now?: () => number;
  wakeIntervalMs?: number;
  stopDeadlineMs?: number;
}>;

export type NodeDedicatedStopResult = Readonly<{
  status: 'stopped';
  durableCommitSequence: number;
}>;

export type NodeDedicatedRuntimeDiagnostics = Readonly<{
  state: NodeDedicatedRuntimeState;
  epoch: string;
  wakeCount: number;
  stopDeadlineExceeded: boolean;
  failure: string | null;
  host: ReturnType<import('../../server/dedicated/dedicated-server-host').DedicatedServerHost['diagnostics']>;
  compute: Readonly<{
    general: DedicatedComputeDiagnostics;
    fluid: DedicatedComputeDiagnostics;
    logic: DedicatedComputeDiagnostics;
  }>;
}>;

export class NodeDedicatedStopTimeoutError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`Node dedicated runtime did not stop within ${deadlineMs} ms.`);
    this.name = 'NodeDedicatedStopTimeoutError';
  }
}
