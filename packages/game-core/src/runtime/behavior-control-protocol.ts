/** World-owned behavior definition. No model, transport, or platform concepts. */
export const BEHAVIOR_SCHEMA_VERSION = 1 as const;
export const BEHAVIOR_MAX_NODES = 64;
export const BEHAVIOR_MAX_DEPTH = 12;
export const BEHAVIOR_MAX_BYTES = 32 * 1024;

/** Public authoring guide shared by world tools and external policy editors. */
export const BEHAVIOR_TREE_AUTHORING_GUIDE = `A definition is {version:1,root:Node,monitors?:Monitor[]}.
Node is {id,type:"selector"|"sequence",children:Node[],guard?:Condition}, or {id,type:"condition",condition:Condition}, or {id,type:"action",skill:registryName,args?:object,guard?:Condition}.
Condition is {name:registryCondition,args?:object}, {all:Condition[]}, {any:Condition[]}, or {not:Condition}.
Monitor is {id,condition:Condition,reason:string}; monitors only send nonblocking rejudge notifications and do not stop the body.
A selector retains its RUNNING child. To preempt a running activity for a higher priority need, explicitly put a live guard on the lower priority activity/subtree. Do not assume selector priority is rechecked automatically.
Use unique stable node ids. Unchanged compatible running activities retain their Action identity. Goal is {description:string,milestones?:[{id,description,condition}]}.
Use only the supplied registry. Positions are [x,y,z]; patrol positions are flattened [x,y,z,x,y,z,...]. Never invent unseen coordinates.
Budget: at most 64 nodes, depth 12, and 32KiB for goal plus definition. Runtime validates every candidate before atomic installation.`;

export type BehaviorScalar = string | number | boolean;
export type BehaviorArguments = Readonly<Record<string, BehaviorScalar | readonly BehaviorScalar[]>>;

/** Names and arguments are validated against the world's capability registry. */
export type BehaviorCondition =
  | Readonly<{ name: string; args?: BehaviorArguments }>
  | Readonly<{ all: readonly BehaviorCondition[] }>
  | Readonly<{ any: readonly BehaviorCondition[] }>
  | Readonly<{ not: BehaviorCondition }>;

export type BehaviorNode =
  | Readonly<{
      id: string;
      type: 'selector' | 'sequence';
      children: readonly BehaviorNode[];
      /** Live subtree guard; an abort cleans up the currently running descendant. */
      guard?: BehaviorCondition;
    }>
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
