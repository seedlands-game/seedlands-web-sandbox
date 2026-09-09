export const CHARACTER_OBSERVATION_MAX_EVENTS = 32;
export const CHARACTER_OBSERVATION_MAX_VISIBLE_ENTITIES = 16;
export const CHARACTER_OBSERVATION_MAX_VISIBLE_POIS = 16;

/** 通用角色控制协议。世界只处理角色资源和意图，不感知模型或控制端实现。 */
export type CharacterPosition = readonly [number, number, number];
export type CharacterProfile = Readonly<{
  name: string;
  personality: string;
  background?: string;
  riskTolerance?: number;
}>;
export type CharacterTargetRef = Readonly<{ kind: 'entity' | 'poi'; ref: string; revision: number }>;
export type CharacterGoal =
  | Readonly<{ kind: 'idle' | 'forage' | 'return-home' }>
  | Readonly<{ kind: 'follow'; target: CharacterTargetRef }>
  | Readonly<{ kind: 'move-to'; position: CharacterPosition }>;
export type CharacterGoalState = Readonly<{
  revision: number;
  requestId: string;
  goal: CharacterGoal;
  status: 'active' | 'suspended' | 'succeeded' | 'failed';
  reason?: string;
}>;
export type CharacterMemory = Readonly<{ revision: number; throughCursor: number; summary: string }>;
export type CharacterEvent = Readonly<{
  cursor: number;
  at: number;
  type:
    | 'dialogue-heard'
    | 'speech'
    | 'goal-started'
    | 'goal-succeeded'
    | 'goal-failed'
    | 'goal-interrupted'
    | 'attacked'
    | 'target-lost'
    | 'item-picked-up'
    | 'item-consumed'
    | 'activity-started'
    | 'activity-succeeded'
    | 'activity-failed'
    | 'activity-interrupted'
    | 'rejudge-requested'
    | 'behavior-updated'
    | 'fallback';
  text?: string;
  target?: CharacterTargetRef;
  reason?: string;
  nodeId?: string;
  actionId?: string;
  episode?: number;
  position?: CharacterPosition;
  count?: number;
  hunger?: number;
}>;
export type CharacterState = Readonly<{
  lifecycle: 'active' | 'deceased';
  entityId: string;
  incarnation: string;
  revision: number;
  policyRevision: number;
  profile: CharacterProfile;
  currentGoal: CharacterGoalState;
  behavior: string;
  hunger: number;
  inventory: readonly (Readonly<{ itemId: string; count: number }> | null)[];
  memory: CharacterMemory;
  eventCursor: number;
  lastSpeech?: string;
  behaviorTree: CharacterBehaviorState;
}>;
export type CharacterObservation = Readonly<{
  character: CharacterState;
  self: Readonly<{ position: CharacterPosition; health?: number }>;
  visibleEntities: readonly Readonly<{
    target: CharacterTargetRef;
    type: string;
    distance: number;
    position: CharacterPosition;
    stack?: Readonly<{ itemId: string; count: number }>;
  }>[];
  visiblePois: readonly Readonly<{
    target: CharacterTargetRef;
    type: string;
    position: CharacterPosition;
    distance: number;
  }>[];
  events: readonly CharacterEvent[];
  cursor: number;
  gap?: boolean;
  worldTime: number;
  eventCoverage: Readonly<{
    requestedAfter: number;
    through: number;
    returnedThrough: number;
    hasMore: boolean;
    lostRange?: Readonly<{ from: number; to: number }>;
  }>;
}>;
export type CharacterBehaviorInput = Readonly<{ goal: BehaviorGoal; definition: BehaviorDefinition }>;
export type CharacterControlRequest =
  | Readonly<{ kind: 'list' }>
  | Readonly<{ kind: 'capabilities' }>
  | Readonly<{
      kind: 'create';
      profile: CharacterProfile;
      position?: CharacterPosition;
      homePosition?: CharacterPosition;
      behaviorTree?: CharacterBehaviorInput;
    }>
  | Readonly<{ kind: 'inspect'; entityId: string }>
  | Readonly<{ kind: 'observe'; entityId: string; sinceCursor?: number; throughCursor?: number }>
  | Readonly<{ kind: 'dialogue'; entityId: string; text: string }>
  | Readonly<{ kind: 'speak'; entityId: string; requestId: string; text: string }>
  | Readonly<{
      kind: 'intent';
      entityId: string;
      requestId: string;
      expectedRevision: number;
      expectedCursor?: number;
      goal: CharacterGoal;
      say?: string;
    }>
  | Readonly<{
      kind: 'memory';
      entityId: string;
      expectedMemoryRevision: number;
      throughCursor: number;
      summary: string;
    }>
  | BehaviorUpdateRequest;
export type CharacterControlResult =
  | Readonly<{ kind: 'list'; characters: readonly CharacterState[] }>
  | Readonly<{ kind: 'capabilities'; capabilities: readonly BehaviorCapability[] }>
  | Readonly<{ kind: 'created' | 'state' | 'memory'; character: CharacterState }>
  | Readonly<{ kind: 'observation'; observation: CharacterObservation }>
  | Readonly<{ kind: 'dialogue'; event: CharacterEvent }>
  | Readonly<{ kind: 'speak'; event: CharacterEvent; character: CharacterState }>
  | Readonly<{ kind: 'intent'; accepted: boolean; character: CharacterState }>
  | Readonly<{ kind: 'behavior'; accepted: true; character: CharacterState }>;

export type LifeBehaviorOptions = Readonly<{
  homePosition: CharacterPosition;
  patrolPositions: readonly CharacterPosition[];
  hungerStart?: number;
  hungerSatisfied?: number;
  threatResponse?: 'flee' | 'attack' | 'ignore';
}>;

/** Canonical model-free life policy shared by Browser and Headless hosts. */
export function createLifeBehavior(options: LifeBehaviorOptions): CharacterBehaviorInput {
  const hungerStart = options.hungerStart ?? 40;
  const hungerSatisfied = options.hungerSatisfied ?? 20;
  const threatSkill = `${options.threatResponse ?? 'flee'}-threat`;
  return {
    goal: {
      description: '安全生活：饿了吃饭，夜里回家休息，白天巡逻。',
      milestones: [
        {
          id: 'fed',
          description: 'Hunger was satisfied.',
          condition: { name: 'hunger-at-most', args: { value: hungerSatisfied } },
        },
        {
          id: 'home',
          description: 'Reached home.',
          condition: { name: 'at-position', args: { position: options.homePosition, radius: 1.25 } },
        },
        { id: 'day', description: 'Daylight returned.', condition: { name: 'is-day' } },
      ],
    },
    definition: {
      version: 1,
      root: {
        id: 'life',
        type: 'selector',
        children: [
          {
            id: 'threat-response',
            type: 'sequence',
            guard: { name: 'threat-visible' },
            children: [
              { id: 'threat-check', type: 'condition', condition: { name: 'threat-visible' } },
              { id: 'threat-action', type: 'action', skill: threatSkill, guard: { name: 'threat-visible' } },
            ],
          },
          {
            id: 'hunger',
            type: 'sequence',
            guard: { not: { name: 'threat-visible' } },
            children: [
              {
                id: 'hunger-check',
                type: 'condition',
                condition: { name: 'hunger-at-least', args: { value: hungerStart } },
              },
              { id: 'hunger-action', type: 'action', skill: 'satisfy-hunger', args: { satisfiedAt: hungerSatisfied } },
            ],
          },
          {
            id: 'night-rest',
            type: 'sequence',
            guard: {
              all: [
                { not: { name: 'threat-visible' } },
                { not: { name: 'hunger-at-least', args: { value: hungerStart } } },
              ],
            },
            children: [
              { id: 'night-check', type: 'condition', condition: { name: 'is-night' } },
              { id: 'night-action', type: 'action', skill: 'rest-at-home', args: { position: options.homePosition } },
            ],
          },
          {
            id: 'day-patrol',
            type: 'action',
            skill: 'patrol',
            args: { positions: options.patrolPositions.flat() },
            guard: {
              all: [
                { not: { name: 'threat-visible' } },
                { not: { name: 'hunger-at-least', args: { value: hungerStart } } },
                { name: 'is-day' },
              ],
            },
          },
        ],
      },
      monitors: [
        { id: 'danger-monitor', condition: { name: 'threat-visible' }, reason: 'threat-changed' },
        {
          id: 'hunger-monitor',
          condition: { name: 'hunger-at-least', args: { value: hungerStart } },
          reason: 'hunger-threshold',
        },
        { id: 'night-monitor', condition: { name: 'is-night' }, reason: 'daylight-changed' },
        { id: 'dialogue-monitor', condition: { name: 'dialogue-received' }, reason: 'dialogue-received' },
      ],
    },
  };
}
export type ControlBinding = Readonly<{
  sessionId: string;
  worldId: string;
  epoch: string;
  entityId: string;
  incarnation: string;
  policyRevision: number;
}>;
export type ControllerReceipt = Readonly<{
  requestId: string;
  actionId?: string;
  status: 'accepted' | 'rejected' | 'succeeded' | 'failed' | 'interrupted';
  reason?: string;
  cursor: number;
  revision: number;
}>;
import type {
  BehaviorCapability,
  BehaviorDefinition,
  BehaviorGoal,
  BehaviorUpdateRequest,
  CharacterBehaviorState,
} from './behavior-control-protocol';
