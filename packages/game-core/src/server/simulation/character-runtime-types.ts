import type {
  CharacterEvent,
  CharacterGoalState,
  CharacterMemory,
  CharacterProfile,
} from '../../runtime/character-control-protocol';
import type { BehaviorDefinition, BehaviorGoal, BehaviorSkillStatus } from '../../runtime/behavior-control-protocol';
import type { BehaviorCapabilityRegistry } from '../composition/behavior-capability-registry';
import type { RegisteredOperationRequest, RegisteredOperationResult } from '../composition/operation-contracts';
import type { EntityStore } from '../gameplay/entity-store';
import type { ActorControlSource } from '../gameplay/ecs-actor-components';
import type { InventorySlot } from '../gameplay/inventory';
import type { EntityLifetimeReference } from '../gameplay/ecs-entity-owner';
import type { ActorAction, ActorActionInput } from './action-runtime';
import type { ActorState } from './actor-state';
import type { NavigationResult } from './ground-navigator';
import type { PerceptionSnapshot } from './perception-runtime';

export const LEGACY_CHARACTER_INVENTORY_CAPACITY = 12;
export const CHARACTER_MAX_EVENTS = 128;
export const CHARACTER_MAX_TARGETS = 128;
export const CHARACTER_MAX_PROFILE_TEXT = 2_000;
export const CHARACTER_MAX_DIALOGUE_TEXT = 500;
export const CHARACTER_MAX_SPEECH_TEXT = 280;
export const CHARACTER_MAX_MEMORY_TEXT = 16_000;
export const CHARACTER_THREAT_MEMORY_SECONDS = 30;

export type CharacterPositionTuple = [number, number, number];
export type CharacterTargetBinding = {
  kind: 'entity' | 'poi';
  ref: string;
  targetId: string;
  revision: number;
};

export type CharacterSkillExecution = {
  nodeId: string;
  skill: string;
  signature: string;
  activation: number;
  status: BehaviorSkillStatus;
  actionId?: string;
  phase: string;
  elapsedSeconds: number;
  replanCount: number;
  reason?: string;
  targetEntityId?: string;
  targetPosition?: CharacterPositionTuple;
  searchOrigin?: CharacterPositionTuple;
  count: number;
  providerId?: string;
  providerModuleId?: string;
  providerVersion?: string;
  stateVersion?: string;
  providerState?: import('../../runtime/behavior-control-protocol').BehaviorJson;
};

export type CharacterBehaviorRecord = {
  revision: number;
  goal: BehaviorGoal;
  definition: BehaviorDefinition;
  cycle: number;
  activationSequence: number;
  skills: CharacterSkillExecution[];
  monitors: { nodeId: string; matched: boolean; episode: number; version?: number }[];
  recentThreat?: { position: CharacterPositionTuple; secondsRemaining: number };
};

export type CharacterRecord = {
  version: 1;
  creation?: Readonly<{ id: string; fingerprint: string }>;
  lifecycle: 'active' | 'deceased';
  entityId: string;
  incarnation: string;
  revision: number;
  policyRevision: number;
  profile: CharacterProfile;
  currentGoal: CharacterGoalState;
  memory: CharacterMemory;
  events: CharacterEvent[];
  eventCursor: number;
  lastSpeech?: string;
  homePosition: CharacterPositionTuple;
  targets: CharacterTargetBinding[];
  targetSequence: number;
  requestIds: string[];
  executionTargetId?: string;
  actionId?: string;
  lastPosition: CharacterPositionTuple;
  stalledSeconds: number;
  refreshSeconds: number;
  suspendedGoal?: CharacterGoalState;
  lastBehavior: string;
  dangerSecondsRemaining: number;
  lastThreatEntityId?: string;
  behaviorTree: CharacterBehaviorRecord;
};

export type CharacterSnapshotRecord = Readonly<{
  creation?: Readonly<{ id: string; fingerprint: string }>;
  lifecycle: 'active' | 'deceased';
  entityId: string;
  incarnation: string;
  revision: number;
  policyRevision: number;
  profile: CharacterProfile;
  currentGoal: CharacterGoalState;
  memory: CharacterMemory;
  /** Legacy V1/V2 Character body field. New snapshots store inventory only in the ECS actor component. */
  inventory?: readonly InventorySlot[];
  events: readonly CharacterEvent[];
  eventCursor: number;
  lastSpeech?: string;
  homePosition: CharacterPositionTuple;
  targets: readonly CharacterTargetBinding[];
  targetSequence: number;
  requestIds: readonly string[];
  executionTargetId?: string;
  actionId?: string;
  lastPosition: CharacterPositionTuple;
  stalledSeconds: number;
  refreshSeconds: number;
  suspendedGoal?: CharacterGoalState;
  lastBehavior: string;
  /** Legacy deficit value. New snapshots store needs only in the ECS actor component. */
  hunger?: number;
  dangerSecondsRemaining: number;
  lastThreatEntityId?: string;
  behaviorTree?: CharacterBehaviorRecord;
}>;

export type CharacterSnapshot = Readonly<{
  version: 1 | 2;
  sequence: number;
  characters: readonly CharacterSnapshotRecord[];
}>;

export type CharacterComponentStateV1 = Readonly<
  Omit<CharacterSnapshotRecord, 'inventory' | 'hunger' | 'behaviorTree'> & {
    version: 1;
    behaviorTree: CharacterBehaviorRecord;
  }
>;

export type CharacterActorDomainView = Readonly<{
  reference: EntityLifetimeReference;
  lifecycle: 'alive' | 'dead';
  controlSource: ActorControlSource;
  controlRevision: number;
  health: number;
  maxHealth: number;
  needs: Readonly<{ hunger: number; maxHunger: number; hungerMeaning: 'satiety' | 'deficit' }>;
  inventory: Readonly<{ slots: readonly InventorySlot[]; selectedSlot: number; revision: number }>;
}>;

/** Restricted body/operation facade. Invocation is always rebound to the supplied actor by the host. */
export type CharacterActorDomainPort = Readonly<{
  read(actorId: string): CharacterActorDomainView | null;
  invoke(
    actorId: string,
    origin: Readonly<{ moduleId: string; providerId: string; providerVersion: string }>,
    request: RegisteredOperationRequest,
  ): RegisteredOperationResult;
}>;

export type CharacterRuntimeOptions = Readonly<{
  entities: EntityStore;
  capabilities: BehaviorCapabilityRegistry;
  domain: CharacterActorDomainPort;
  now: () => number;
  actor: (entityId: string) => ActorState | null;
  observe: (entityId: string) => PerceptionSnapshot;
  poi: (id: string) => Readonly<{ id: string; kind: string; position: CharacterPositionTuple }> | null;
  action: (id: string) => ActorAction | null;
  canStartAction: () => boolean;
  startAction: (actorId: string, input: Omit<ActorActionInput, 'actorId'>) => ActorAction;
  markActionRunning: (actionId: string, path: readonly CharacterPositionTuple[]) => ActorAction;
  setActionPathIndex: (actionId: string, pathIndex: number) => void;
  updateActionPath: (
    actionId: string,
    path: readonly CharacterPositionTuple[],
    repathCount: number,
    targetPosition?: CharacterPositionTuple,
  ) => ActorAction;
  plan: (actorId: string, start: CharacterPositionTuple, target: CharacterPositionTuple) => NavigationResult;
  interruptAction: (actorId: string, reason: string) => boolean;
  failAction: (actionId: string, reason: string) => void;
  succeedAction: (actionId: string, result?: unknown) => void;
  clearDanger: (entityId: string) => void;
  worldTime: () => number;
  requestCombat: (
    actorId: string,
    targetId: string,
    existingActionId?: string,
  ) => Readonly<{ success: boolean; actionId?: string; reason?: string }>;
  changed: () => void;
}>;
