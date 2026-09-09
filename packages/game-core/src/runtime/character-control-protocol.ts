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
    | 'fallback';
  text?: string;
  target?: CharacterTargetRef;
  reason?: string;
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
}>;
export type CharacterControlRequest =
  | Readonly<{ kind: 'list' }>
  | Readonly<{
      kind: 'create';
      profile: CharacterProfile;
      position?: CharacterPosition;
      homePosition?: CharacterPosition;
    }>
  | Readonly<{ kind: 'inspect'; entityId: string }>
  | Readonly<{ kind: 'observe'; entityId: string; sinceCursor?: number }>
  | Readonly<{ kind: 'dialogue'; entityId: string; text: string }>
  | Readonly<{
      kind: 'intent';
      entityId: string;
      requestId: string;
      expectedRevision: number;
      goal: CharacterGoal;
      say?: string;
    }>
  | Readonly<{
      kind: 'memory';
      entityId: string;
      expectedMemoryRevision: number;
      throughCursor: number;
      summary: string;
    }>;
export type CharacterControlResult =
  | Readonly<{ kind: 'list'; characters: readonly CharacterState[] }>
  | Readonly<{ kind: 'created' | 'state' | 'memory'; character: CharacterState }>
  | Readonly<{ kind: 'observation'; observation: CharacterObservation }>
  | Readonly<{ kind: 'dialogue'; event: CharacterEvent }>
  | Readonly<{ kind: 'intent'; accepted: boolean; character: CharacterState }>;
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
