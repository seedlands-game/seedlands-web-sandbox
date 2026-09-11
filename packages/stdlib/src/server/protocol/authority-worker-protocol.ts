import type { EntityLifetimeReference } from '../gameplay/entity-store';
import type { StationComponentV1 } from '../gameplay/ecs-station-state';
import type { StationRecipe } from '../gameplay/modules/station-candidates';
import type { ItemDefinition } from '../gameplay/item-registry';
import type { Recipe } from '../gameplay/recipe-registry';
import type { AuthoritySnapshot } from '../authority/authority-session';
import type { GameplayEntity } from '../gameplay/entity-store';
import type { PlayerSnapshot } from '../gameplay/player-state';
import type { ActorState } from '../simulation/actor-state';
import type { CommandResult, CommandSource, ServerCommand } from '../commands/command-contract';
import type { FluidCandidate, FluidAuthoritySnapshot } from '../fluid/fluid-transaction';
import type { WorldCommitResult } from '../game-server-types';
import type { VoxelEdit } from '../world-mutation';
import type { InputCommand, SequenceDecision } from '../../runtime/session-protocol';
import { PROTOCOL_VERSION, type SessionEpoch } from '../../runtime/session-protocol';
import type { WorldOpenMode } from '../../runtime/world-version-policy';
import type { LogicIntentBatch, LogicObservation } from '../logic/logic-protocol';
import type { ChunkPersistenceLoadDiagnostics } from '../persistence/chunk-persistence';
import type { CombatSnapshot } from '../gameplay/combat-runtime';
import type { WorldHarnessPort, WorldHarnessResult } from '../harness/world-harness-contract';
import type { InventorySlot } from '../gameplay/inventory';
import type { StarterEcologyConfiguration } from '../gameplay/actor-profile';
import type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';
import type {
  InventoryCursorV1,
  InventoryPointerCommand,
  InventoryPointerStationRef,
} from '../gameplay/modules/inventory-pointer-contract';
import type { CharacterControlRequest, ControlBinding } from '../../runtime/character-control-protocol';

type CharacterIntentRequest = Extract<CharacterControlRequest, { kind: 'intent' }>;
type CharacterCapabilitiesRequest = Extract<CharacterControlRequest, { kind: 'capabilities' }>;
export type BoundCharacterControlRequest =
  | Extract<CharacterControlRequest, { kind: 'observe' | 'memory' | 'behavior' | 'speak' }>
  | Readonly<Omit<CharacterCapabilitiesRequest, 'entityId'> & { entityId: string }>
  | Readonly<Omit<CharacterIntentRequest, 'expectedCursor'> & { expectedCursor: number }>;

export type GameplayEntityView = GameplayEntity & Readonly<{ combat?: CombatSnapshot }>;

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

export type AuthorityStationView = Readonly<{
  reference: EntityLifetimeReference;
  position: readonly [number, number, number];
  component: StationComponentV1;
  /** Recipes whose input grid matches, independent of bag or cursor capacity. */
  matchedRecipeIds: readonly string[];
  craftableRecipeIds: readonly string[];
  furnaceRecipeDuration?: number;
  /** null accepts any registered item; [] is read-only. */
  acceptedItemIdsBySlot?: readonly (readonly string[] | null)[];
}>;
export type AuthorityInventoryView = Readonly<{
  version: 1;
  actor: EntityLifetimeReference;
  revision: number;
  slots: readonly InventorySlot[];
  hotbarSize: number;
  cursor: InventoryCursorV1;
}>;
export type AuthorityInventoryPointerAction = Readonly<{
  type: 'inventory-pointer';
  actor: EntityLifetimeReference;
  expectedInventoryRevision: number;
  station?: InventoryPointerStationRef;
  command: InventoryPointerCommand;
}>;
export type AuthorityStationAction = Readonly<{
  type: 'station';
  reference: EntityLifetimeReference;
  expectedStationRevision: number;
}> &
  (
    | Readonly<{ kind: 'craft'; recipeId: string }>
    | Readonly<{ kind: 'transfer'; from: 'actor' | 'station'; actorSlot: number; stationSlot: number; count?: number }>
  );

export type AuthorityGameplayView = Readonly<{
  nearbyStations?: readonly AuthorityStationView[];
  stationRecipes?: readonly StationRecipe[];
  items?: readonly ItemDefinition[];
  recipes?: readonly Recipe[];
  inventory: AuthorityInventoryView;
  gameplayRevision: number;
  gameplayTime: number;
  player: PlayerSnapshot;
  entities: readonly GameplayEntityView[];
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
  worldgenProvider?: KernelWorldgenProviderIdentity;
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
  provider?: KernelWorldgenProviderIdentity;
  preparationDiagnostics?: Readonly<{
    authorityPrepareMs: number;
    persistenceWaitMs: number;
    snapshotCopyMs: number;
    persistence?: ChunkPersistenceLoadDiagnostics;
  }>;
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
  provider: KernelWorldgenProviderIdentity;
  canonical: ArrayBuffer;
}>;

export type AuthorityBootstrapGeneration = Readonly<{
  playerBodyPosition: [number, number, number];
  starterChunks: readonly AuthorityBootstrapChunk[];
}>;

export type AuthorityAction =
  | AuthorityStationAction
  | AuthorityInventoryPointerAction
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
  /** 当前 Authority 总会提供；可选仅兼容历史本地 fixture。网络投影必须验证存在。 */
  submittedAction?: AuthorityAction;
  result: unknown;
  gameplay: AuthorityGameplayView;
  commits: readonly WorldCommitResult[];
}>;

export type AuthorityPlayerPositionResult = Readonly<{ moved: true; snapshot: AuthoritySnapshot }>;
export type AuthoritySessionControlResult = Readonly<{ paused: boolean; snapshot: AuthoritySnapshot }>;
export type AuthorityCommitMessage = Readonly<{
  kind: 'authority-commits';
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: SessionEpoch;
  commits: readonly WorldCommitResult[];
}>;

export type AuthorityTransactionKey = Readonly<{
  issuer: string;
  stream: string;
  sequence: number;
  expectedCommitSequence?: number;
}>;

export type AuthorityRequest = (
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
      developerWorldHarness?: boolean;
    }>
  | (Omit<InputCommand, 'epoch'> & Readonly<{ epoch: SessionEpoch; runtimeEpoch: SessionEpoch }>)
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
      kind: 'request-collision-baseline';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      key: string;
      minimumRevision: number;
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
      provider?: KernelWorldgenProviderIdentity;
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
  | Readonly<{
      kind: 'world-harness-rpc';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      method: keyof WorldHarnessPort;
      args: readonly unknown[];
    }>
  | Readonly<{
      kind: 'character-control';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      request: CharacterControlRequest;
    }>
  | Readonly<{
      kind: 'bind-character';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      entityId: string;
    }>
  | Readonly<{
      kind: 'bound-character-control';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      binding: ControlBinding;
      sequence: number;
      request: BoundCharacterControlRequest;
    }>
  | Readonly<{
      kind: 'unbind-character';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      binding: ControlBinding;
    }>
  | Readonly<{ kind: 'dispose-authority'; protocolVersion: typeof PROTOCOL_VERSION; epoch: SessionEpoch }>
) &
  Readonly<{ runtimeEpoch?: SessionEpoch }>;

export type AuthorityResponse =
  | Readonly<{
      kind: 'authority-bootstrap-needed';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      seed: number;
      generatorVersion: number;
      provider: KernelWorldgenProviderIdentity;
      starterEcology: StarterEcologyConfiguration | null;
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
  | AuthorityCommitMessage
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
      kind: 'world-harness-response';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      result: WorldHarnessResult<unknown>;
      ready?: AuthorityReady;
      runtimeEpoch?: string;
    }>
  | Readonly<{
      kind: 'authority-fatal';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      error: string;
    }>;

export type AuthorityCommandResult = CommandResult;
