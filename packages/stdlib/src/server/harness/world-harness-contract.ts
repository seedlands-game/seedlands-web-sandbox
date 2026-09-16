import type { AuthorityAdvanceResult } from '../authority/authority-runtime-types';
import type { AuthorityGameplayView } from '../protocol/authority-worker-protocol';
import type { AuthoritySnapshot } from '../authority/authority-session';
import type { CommandResult, ServerCommand } from '../commands/command-contract';
import type { GameplayEntity } from '../gameplay/entity-store';
import type { LogicIntentBatch, LogicObservation } from '../logic/logic-protocol';
import type { FrozenGameSaveSnapshot } from '../persistence/game-save-snapshot';
import type { ActorState } from '../simulation/actor-state';
import type { ActorAction } from '../simulation/action-runtime';
import type { WorldAuthorizationPolicy } from './world-authorization';
import type { CharacterControlRequest, CharacterControlResult } from '../../runtime/character-control-protocol';

export const WORLD_HARNESS_PROTOCOL_VERSION = 1 as const;
export const WORLD_HARNESS_TRACE_CAPACITY = 256;
export const WORLD_HARNESS_MAX_ADVANCE_MS = 60_000;
export const WORLD_HARNESS_MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;

export type WorldFrontier = Readonly<{
  worldId: string;
  epoch: string;
  worldRevision: number;
  commitSequence: number;
  physicsTick: number;
  fluidWorkSequence: number;
  logicObservationSequence: number;
}>;

export type WorldHarnessError = Readonly<{
  code: string;
  message: string;
  kind: 'validation' | 'permission' | 'conflict' | 'unavailable' | 'execution';
}>;

export type WorldHarnessResult<Data> = Readonly<
  { ok: true; data: Data; frontier: WorldFrontier } | { ok: false; error: WorldHarnessError; frontier?: WorldFrontier }
>;

export type WorldIdentity = Readonly<{
  protocolVersion: typeof WORLD_HARNESS_PROTOCOL_VERSION;
  worldId: string;
  epoch: string;
  seed: number;
  seedText: string;
  generatorVersion: number;
  playerId: string;
  runtime: 'authority';
  supported: Readonly<{
    player: true;
    scriptedLogic: true;
    existingNpcSimulation: true;
  }>;
}>;

export type WorldInspectRequest =
  | Readonly<{ kind: 'voxel'; position: readonly [number, number, number] }>
  | Readonly<{ kind: 'chunk'; chunk: readonly [number, number, number] }>
  | Readonly<{ kind: 'entity'; entityId: string }>
  | Readonly<{ kind: 'actor'; entityId: string }>;

export type WorldInspectResult =
  | Readonly<{ kind: 'voxel'; position: readonly [number, number, number]; voxel: number; chunkRevision: number }>
  | Readonly<{
      kind: 'chunk';
      chunk: readonly [number, number, number];
      key: string;
      revision: number;
      materialized: boolean;
    }>
  | Readonly<{ kind: 'entity'; entity: GameplayEntity }>
  | Readonly<{ kind: 'actor'; actor: ActorState }>;

export type WorldPrepareRequest =
  | Readonly<{ kind: 'chunk'; chunk: readonly [number, number, number] }>
  | Readonly<{ kind: 'chunks'; chunks: readonly (readonly [number, number, number])[] }>;

export type WorldClockRequest =
  | Readonly<{ kind: 'status' }>
  | Readonly<{ kind: 'pause' }>
  | Readonly<{ kind: 'run' }>
  | Readonly<{ kind: 'advance'; elapsedMs: number }>;

export type WorldClockResult = Readonly<{
  paused: boolean;
  snapshot: AuthoritySnapshot;
  lanes?: AuthorityAdvanceResult['lanes'];
  gameplay?: AuthorityGameplayView;
}>;

export type WorldLogicRequest =
  | Readonly<{ kind: 'mode'; mode: 'automatic' | 'scripted' }>
  | Readonly<{ kind: 'observe' }>
  | Readonly<{ kind: 'submit'; batch: LogicIntentBatch }>;

export type WorldLogicResult =
  | Readonly<{ mode: 'automatic' | 'scripted' }>
  | Readonly<{ observation: LogicObservation; mode: 'automatic' | 'scripted' }>
  | Readonly<{ accepted: boolean; mode: 'automatic' | 'scripted' }>;

export type WorldActionQuery = Readonly<{ entityId?: string; actionId?: string }>;
export type WorldActionQueryResult = Readonly<{ actions: readonly ActorAction[] }>;

export type WorldBarrierRequest = Readonly<{
  kind: 'committed' | 'settled' | 'checkpoint';
  frontier: WorldFrontier;
  timeoutMs: number;
}>;

export type WorldTraceEvent = Readonly<{
  sequence: number;
  atMs: number;
  principalId: string;
  operation: string;
  ok: boolean;
  frontier: WorldFrontier;
  errorCode?: string;
}>;

export type WorldTraceRequest = Readonly<{ kind: 'read'; limit?: number }> | Readonly<{ kind: 'export' }>;

export type WorldTraceResult = Readonly<{
  events: readonly WorldTraceEvent[];
  dropped: number;
  jsonl?: string;
}>;

export type WorldCheckpointRequest = Readonly<{ kind: 'export' }> | Readonly<{ kind: 'restore'; snapshot: unknown }>;

export type WorldCheckpointResult = Readonly<{
  snapshot?: FrozenGameSaveSnapshot;
  restored?: true;
  byteLength: number;
}>;

export type WorldCommandOptions = Readonly<{ sequence?: number; expectedCommitSequence?: number }>;

export interface WorldHarnessPort {
  identity(): Promise<WorldHarnessResult<WorldIdentity>>;
  inspect(request: WorldInspectRequest): Promise<WorldHarnessResult<WorldInspectResult>>;
  prepare(request: WorldPrepareRequest): Promise<WorldHarnessResult<{ prepared: readonly string[] }>>;
  command(command: ServerCommand, options?: WorldCommandOptions): Promise<WorldHarnessResult<CommandResult>>;
  clock(request: WorldClockRequest): Promise<WorldHarnessResult<WorldClockResult>>;
  logic(request: WorldLogicRequest): Promise<WorldHarnessResult<WorldLogicResult>>;
  actions(query?: WorldActionQuery): Promise<WorldHarnessResult<WorldActionQueryResult>>;
  character(request: CharacterControlRequest): Promise<WorldHarnessResult<CharacterControlResult>>;
  barrier(
    request: WorldBarrierRequest,
  ): Promise<WorldHarnessResult<{ reached: true; kind: WorldBarrierRequest['kind'] }>>;
  trace(request: WorldTraceRequest): Promise<WorldHarnessResult<WorldTraceResult>>;
  checkpoint(request: WorldCheckpointRequest): Promise<WorldHarnessResult<WorldCheckpointResult>>;
}

export type WorldHarnessConfiguration = Readonly<{
  principalId: string;
  authorization: WorldAuthorizationPolicy;
}>;

export type WorldHarnessRpcRequest = Readonly<{
  protocolVersion: typeof WORLD_HARNESS_PROTOCOL_VERSION;
  requestId: number;
  method: keyof WorldHarnessPort;
  args: readonly unknown[];
}>;

export type WorldHarnessRpcResponse = Readonly<{
  protocolVersion: typeof WORLD_HARNESS_PROTOCOL_VERSION;
  requestId: number;
  result: WorldHarnessResult<unknown>;
}>;
