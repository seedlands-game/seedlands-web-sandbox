import type { AuthoritySnapshot } from '../server/authority/authority-session';
import type { GameplayEntity } from '../server/gameplay/entity-store';
import type { PlayerSnapshot } from '../server/gameplay/player-state';
import type { ActorState } from '../server/simulation/actor-state';
import type { CommandResult, CommandSource, ServerCommand } from '../server/commands/command-contract';
import type { FluidCandidate, FluidAuthoritySnapshot } from '../server/fluid/fluid-transaction';
import type { WorldCommitResult } from '../server/game-server-types';
import type { VoxelEdit } from '../server/world-mutation';
import type { InputCommand, SequenceDecision } from '../runtime/session-protocol';
import { PROTOCOL_VERSION, type SessionEpoch } from '../runtime/session-protocol';
import type { WorldOpenMode } from '../client/world-version-policy';
import type { LogicIntentBatch, LogicObservation } from '../server/logic/logic-protocol';

export type AuthorityGameplayMetrics = Readonly<{
  entityCount: number;
  worldItemCount: number;
  creatureCount: number;
  npcCount: number;
  nearbyVisitedBucketCount: number;
  nearbyCandidateCount: number;
  nearbyReturnedCount: number;
  inventoryOperationCount: number;
  gameplayEventCount: number;
  snapshotBytes: number;
  retainedActorCount: number;
  activeActorCount: number;
  behaviorEvaluationCount: number;
  navigationPlanCount: number;
  navigationExpandedNodeCount: number;
  pathRecomputeCount: number;
  actionCompletionCount: number;
  actionFailureCount: number;
  actionInterruptionCount: number;
  perceptionLineOfSightCheckCount: number;
  simulationTime: number;
}>;

export type AuthorityGameplayView = Readonly<{
  gameplayRevision: number;
  gameplayTime: number;
  player: PlayerSnapshot;
  entities: readonly GameplayEntity[];
  actors: readonly ActorState[];
  craftableRecipeIds: readonly string[];
  metrics: AuthorityGameplayMetrics;
}>;

export type AuthorityReady = Readonly<{
  playerId: string;
  playerBodyPosition: [number, number, number];
  isNew: boolean;
  seed: number;
  seedText: string;
  generatorVersion: number;
  worldTime: number;
  frequencies: Readonly<{ physicsHz: 30 | 60 | 120; gameplayHz: 10 | 20; fluidHz: 20 | 30 }>;
  snapshot: AuthoritySnapshot;
  gameplay: AuthorityGameplayView;
  campPosition?: [number, number, number];
}>;

export type AuthorityMeshPayload = Readonly<{
  key: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  generatorVersion: number;
  canonical?: ArrayBuffer;
  fluid?: ArrayBuffer;
  overlays: readonly Readonly<{
    cx: number;
    cy: number;
    cz: number;
    voxels: ArrayBuffer;
    fluid?: ArrayBuffer;
  }>[];
}>;

export type AuthorityBootstrapChunk = Readonly<{
  key: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  generatorVersion: number;
  canonical: ArrayBuffer;
}>;

export type AuthorityBootstrapGeneration = Readonly<{
  playerBodyPosition: [number, number, number];
  starterChunks: readonly AuthorityBootstrapChunk[];
}>;

export type AuthorityAction =
  | Readonly<{ type: 'select-hotbar'; slot: number }>
  | Readonly<{ type: 'craft'; recipeId: string }>
  | Readonly<{ type: 'attack'; targetId: string }>
  | Readonly<{ type: 'begin-break'; position: [number, number, number] }>
  | Readonly<{ type: 'cancel-break' }>
  | Readonly<{ type: 'place'; position: [number, number, number] }>
  | Readonly<{ type: 'respawn' }>
  | Readonly<{ type: 'move-inventory'; source: number; target: number }>
  | Readonly<{ type: 'use-inventory'; slot: number }>;

export type AuthorityActionResult = Readonly<{
  result: unknown;
  gameplay: AuthorityGameplayView;
  commits: readonly WorldCommitResult[];
}>;

export type AuthorityTransactionKey = Readonly<{
  issuer: string;
  stream: string;
  sequence: number;
  expectedCommitSequence?: number;
}>;

export type AuthorityRequest =
  | Readonly<{
      kind: 'start-authority';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      seedText: string;
      openMode: WorldOpenMode;
      legacySnapshots: readonly unknown[];
      initialWorldTime: number;
      sessionTimeOriginMs: number;
      frequencies: Readonly<{ physicsHz: 30 | 60 | 120; gameplayHz: 10 | 20; fluidHz: 20 | 30 }>;
    }>
  | InputCommand
  | Readonly<{
      kind: 'pause-authority' | 'resume-authority';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      transaction: AuthorityTransactionKey;
    }>
  | Readonly<{
      kind: 'prepare-mesh';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      cx: number;
      cy: number;
      cz: number;
    }>
  | Readonly<{
      kind: 'release-mesh';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      cx: number;
      cy: number;
      cz: number;
    }>
  | Readonly<{
      kind: 'accept-generated-chunk';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      key: string;
      cx: number;
      cy: number;
      cz: number;
      chunkRevision: number;
      generatorVersion: number;
      canonical: ArrayBuffer;
    }>
  | Readonly<{
      kind: 'authority-bootstrap-result';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      playerBodyPosition: [number, number, number];
      starterChunks: readonly AuthorityBootstrapChunk[];
    }>
  | Readonly<{
      kind: 'set-fluid-active-chunks';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      keys: readonly string[];
    }>
  | Readonly<{
      kind: 'world-edit';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      transaction: AuthorityTransactionKey;
      actorId: string;
      edits: readonly VoxelEdit[];
    }>
  | Readonly<{
      kind: 'set-player-position';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      transaction: AuthorityTransactionKey;
      position: [number, number, number];
    }>
  | Readonly<{
      kind: 'gameplay-action';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      transaction: AuthorityTransactionKey;
      action: AuthorityAction;
    }>
  | Readonly<{
      kind: 'server-command';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      transaction: AuthorityTransactionKey;
      source: CommandSource;
      command: ServerCommand;
    }>
  | Readonly<{
      kind: 'set-world-time';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      transaction: AuthorityTransactionKey;
      hours: number;
    }>
  | Readonly<{
      kind: 'set-world-clock-rate';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      transaction: AuthorityTransactionKey;
      rate: number;
    }>
  | Readonly<{
      kind: 'save-authority';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
    }>
  | Readonly<{
      kind: 'fluid-candidate';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      candidate: FluidCandidate;
    }>
  | Readonly<{
      kind: 'fluid-failure';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      workId: string;
      reason: string;
    }>
  | Readonly<{
      kind: 'logic-intents';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      batch: LogicIntentBatch;
    }>
  | Readonly<{
      kind: 'request-logic-observation';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
    }>
  | Readonly<{ kind: 'dispose-authority'; protocolVersion: typeof PROTOCOL_VERSION; epoch: SessionEpoch }>;

export type AuthorityResponse =
  | Readonly<{
      kind: 'authority-bootstrap-needed';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      seed: number;
      generatorVersion: number;
    }>
  | Readonly<{
      kind: 'authority-ready';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      ready: AuthorityReady;
    }>
  | Readonly<{
      kind: 'authority-chunk-needed';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      key: string;
    }>
  | Readonly<{
      kind: 'authority-snapshot';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      snapshot: AuthoritySnapshot;
      gameplay?: AuthorityGameplayView;
      commits?: readonly WorldCommitResult[];
    }>
  | Readonly<{
      kind: 'input-decision';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      sequence: number;
      decision: SequenceDecision;
      requiresResync: boolean;
    }>
  | Readonly<{
      kind: 'authority-response';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      ok: true;
      result: unknown;
      commitSequence?: number;
      gameplay?: AuthorityGameplayView;
      commits?: readonly WorldCommitResult[];
    }>
  | Readonly<{
      kind: 'authority-response';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      ok: false;
      error: string;
    }>
  | Readonly<{
      kind: 'mesh-prepared';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      payload: AuthorityMeshPayload;
    }>
  | Readonly<{
      kind: 'fluid-work';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      snapshot: FluidAuthoritySnapshot;
    }>
  | Readonly<{
      kind: 'logic-observation';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      observation: LogicObservation;
    }>
  | Readonly<{
      kind: 'authority-fatal';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      error: string;
    }>;

export type AuthorityCommandResult = CommandResult;
