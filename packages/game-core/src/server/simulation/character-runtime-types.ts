import type {
  CharacterEvent,
  CharacterGoalState,
  CharacterMemory,
  CharacterProfile,
} from '../../runtime/character-control-protocol';
import type { BehaviorDefinition, BehaviorGoal, BehaviorSkillStatus } from '../../runtime/behavior-control-protocol';
import type { EntityStore } from '../gameplay/entity-store';
import { Inventory, type InventorySlot } from '../gameplay/inventory';
import type { ActorAction, ActorActionInput } from './action-runtime';
import type { ActorState } from './actor-state';
import type { NavigationResult } from './ground-navigator';
import type { PerceptionSnapshot } from './perception-runtime';

export const CHARACTER_INVENTORY_CAPACITY = 12;
export const CHARACTER_MAX_EVENTS = 128;
export const CHARACTER_MAX_TARGETS = 128;
export const CHARACTER_MAX_PROFILE_TEXT = 2_000;
export const CHARACTER_MAX_DIALOGUE_TEXT = 500;
export const CHARACTER_MAX_SPEECH_TEXT = 280;
export const CHARACTER_MAX_MEMORY_TEXT = 16_000;

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
  count: number;
};

export type CharacterBehaviorRecord = {
  revision: number;
  goal: BehaviorGoal;
  definition: BehaviorDefinition;
  cycle: number;
  activationSequence: number;
  skills: CharacterSkillExecution[];
  monitors: { nodeId: string; matched: boolean; episode: number; version?: number }[];
};

export type CharacterRecord = {
  lifecycle: 'active' | 'deceased';
  entityId: string;
  incarnation: string;
  revision: number;
  policyRevision: number;
  profile: CharacterProfile;
  currentGoal: CharacterGoalState;
  memory: CharacterMemory;
  inventory: Inventory;
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
  hunger: number;
  dangerSecondsRemaining: number;
  lastThreatEntityId?: string;
  behaviorTree: CharacterBehaviorRecord;
};

export type CharacterSnapshotRecord = Readonly<{
  lifecycle: 'active' | 'deceased';
  entityId: string;
  incarnation: string;
  revision: number;
  policyRevision: number;
  profile: CharacterProfile;
  currentGoal: CharacterGoalState;
  memory: CharacterMemory;
  inventory: readonly InventorySlot[];
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
  hunger: number;
  dangerSecondsRemaining: number;
  lastThreatEntityId?: string;
  behaviorTree?: CharacterBehaviorRecord;
}>;

export type CharacterSnapshot = Readonly<{
  version: 1 | 2;
  sequence: number;
  characters: readonly CharacterSnapshotRecord[];
}>;

export type CharacterRuntimeOptions = Readonly<{
  entities: EntityStore;
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
  plan: (start: CharacterPositionTuple, target: CharacterPositionTuple) => NavigationResult;
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

export const createCharacterInventory = (snapshot?: readonly InventorySlot[]) =>
  new Inventory(CHARACTER_INVENTORY_CAPACITY, snapshot);
