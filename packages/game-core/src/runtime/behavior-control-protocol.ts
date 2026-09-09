/** World-owned behavior definition. No model, transport, or platform concepts. */
export const BEHAVIOR_SCHEMA_VERSION = 1 as const;
export const BEHAVIOR_MAX_NODES = 64;
export const BEHAVIOR_MAX_DEPTH = 12;
export const BEHAVIOR_MAX_BYTES = 32 * 1024;

export type BehaviorScalar = string | number | boolean;
export type BehaviorArguments = Readonly<Record<string, BehaviorScalar | readonly BehaviorScalar[]>>;

/** Names and arguments are validated against the world's capability registry. */
export type BehaviorCondition =
  | Readonly<{ name: string; args?: BehaviorArguments }>
  | Readonly<{ all: readonly BehaviorCondition[] }>
  | Readonly<{ any: readonly BehaviorCondition[] }>
  | Readonly<{ not: BehaviorCondition }>;

export type BehaviorNode =
  | Readonly<{ id: string; type: 'selector' | 'sequence'; children: readonly BehaviorNode[] }>
  | Readonly<{ id: string; type: 'condition'; condition: BehaviorCondition }>
  | Readonly<{
      id: string;
      type: 'action';
      skill: string;
      args?: BehaviorArguments;
      /** A live world condition; false aborts and cleans up this activity. */
      guard?: BehaviorCondition;
    }>;

/** These branches can signal reconsideration, never acquire a body action. */
export type BehaviorMonitor = Readonly<{
  id: string;
  condition: BehaviorCondition;
  reason: string;
}>;

export type BehaviorDefinition = Readonly<{
  version: typeof BEHAVIOR_SCHEMA_VERSION;
  root: BehaviorNode;
  monitors?: readonly BehaviorMonitor[];
}>;

export type BehaviorGoal = Readonly<{
  description: string;
  /** Optional observable milestones. A description alone never proves completion. */
  milestones?: readonly Readonly<{ id: string; description: string; condition: BehaviorCondition }>[];
}>;

export type BehaviorSkillStatus = 'running' | 'succeeded' | 'failed' | 'interrupted';

export type BehaviorRuntimeView = Readonly<{
  cycle: number;
  activeNodeIds: readonly string[];
  skills: readonly Readonly<{
    nodeId: string;
    skill: string;
    activation: number;
    status: BehaviorSkillStatus;
    actionId?: string;
    phase: string;
    elapsedSeconds: number;
    replanCount: number;
    reason?: string;
  }>[];
  monitors: readonly Readonly<{ nodeId: string; matched: boolean; episode: number }>[];
  milestones: readonly Readonly<{ id: string; satisfied: boolean }>[];
}>;

export type CharacterBehaviorState = Readonly<{
  revision: number;
  goal: BehaviorGoal;
  definition: BehaviorDefinition;
  runtime: BehaviorRuntimeView;
}>;

export type BehaviorUpdateRequest = Readonly<{
  kind: 'behavior';
  entityId: string;
  requestId: string;
  expectedBehaviorRevision: number;
  goal: BehaviorGoal;
  definition: BehaviorDefinition;
}>;

export type BehaviorCapability = Readonly<{
  name: string;
  kind: 'condition' | 'skill';
  description: string;
  arguments: Readonly<
    Record<
      string,
      Readonly<{
        type: 'number' | 'string' | 'boolean' | 'position';
        required?: boolean;
        minimum?: number;
        maximum?: number;
        values?: readonly string[];
      }>
    >
  >;
}>;
