/** World-owned behavior definition. No model, transport, or platform concepts. */
export const BEHAVIOR_SCHEMA_VERSION = 1 as const;
export const BEHAVIOR_MAX_NODES = 64;
export const BEHAVIOR_MAX_DEPTH = 12;
export const BEHAVIOR_MAX_BYTES = 32 * 1024;
export const BEHAVIOR_MAX_CAPABILITIES = 256;
export const BEHAVIOR_MAX_CAPABILITY_STATE_BYTES = 8 * 1024;
export const BEHAVIOR_MAX_REQUIRED_OPERATIONS = 16;
export const BEHAVIOR_MAX_DESCRIPTOR_TEXT_LENGTH = 160;
export const BEHAVIOR_MAX_OPERATION_ID_LENGTH = BEHAVIOR_MAX_DESCRIPTOR_TEXT_LENGTH;
export const BEHAVIOR_MAX_ARGUMENT_VALUES = 128;

/** Public authoring guide shared by world tools and external policy editors. */
export const BEHAVIOR_TREE_AUTHORING_GUIDE = `A definition is {version:1,root:Node,monitors?:Monitor[]}.
Node is {id,type:"selector"|"sequence",children:Node[],guard?:Condition}, or {id,type:"condition",condition:Condition}, or {id,type:"action",skill:registryName,args?:object,guard?:Condition}.
Condition is {name:registryCondition,args?:object}, {all:Condition[]}, {any:Condition[]}, or {not:Condition}.
Monitor is {id,condition:Condition,reason:string}; monitors only send nonblocking rejudge notifications and do not stop the body.
A selector retains its RUNNING child. To preempt a running activity for a higher priority need, explicitly put a live guard on the lower priority activity/subtree.
Use unique stable node ids. Unchanged compatible running activities retain their Action identity.
Use only the supplied per-world registry. Positions are [x,y,z]; patrol positions are flattened [x,y,z,x,y,z,...].
Budget: at most 64 nodes, depth 12, and 32KiB for goal plus definition. Runtime validates every candidate before atomic installation.`;

export type BehaviorScalar = string | number | boolean;
export type BehaviorArguments = Readonly<Record<string, BehaviorScalar | readonly BehaviorScalar[]>>;
export type BehaviorJson =
  null | boolean | number | string | readonly BehaviorJson[] | Readonly<{ [key: string]: BehaviorJson }>;

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
      guard?: BehaviorCondition;
    }>
  | Readonly<{ id: string; type: 'condition'; condition: BehaviorCondition }>
  | Readonly<{
      id: string;
      type: 'action';
      skill: string;
      args?: BehaviorArguments;
      guard?: BehaviorCondition;
    }>;

export type BehaviorMonitor = Readonly<{ id: string; condition: BehaviorCondition; reason: string }>;
export type BehaviorDefinition = Readonly<{
  version: typeof BEHAVIOR_SCHEMA_VERSION;
  root: BehaviorNode;
  monitors?: readonly BehaviorMonitor[];
}>;
export type BehaviorGoal = Readonly<{
  description: string;
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
  milestones: readonly Readonly<{ id: string; satisfied: boolean; failure?: string }>[];
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

export type BehaviorArgumentRule = Readonly<{
  type: 'number' | 'string' | 'boolean' | 'position' | 'entity-reference';
  required?: boolean;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  values?: readonly string[];
}>;
export type BehaviorCapabilityProvider = Readonly<{ moduleId: string; version: string }>;
export type BehaviorCapabilityReference = Readonly<{
  id: string;
  version: string;
  provider: BehaviorCapabilityProvider;
}>;
export type BehaviorOperationRequirement = Readonly<{
  operationId: string;
  /** `any` is only a catalog preflight; every concrete target is re-authorized during dispatch. */
  authorization: 'self' | 'any';
}>;
/** Serializable, bounded catalog entry. Provider callbacks never cross this boundary. */
export type BehaviorCapability = Readonly<{
  id: string;
  /** Legacy alias retained for existing tools. Equal to id. */
  name: string;
  version: string;
  provider: BehaviorCapabilityProvider;
  kind: 'condition' | 'skill';
  description: string;
  arguments: Readonly<Record<string, BehaviorArgumentRule>>;
  requiredOperations: readonly BehaviorOperationRequirement[];
  state?: Readonly<{ version: string; maximumBytes: number }>;
}>;

export type BehaviorSkillCheckpoint = Readonly<{
  capabilityId: string;
  provider: BehaviorCapabilityProvider;
  state: Readonly<{ version: string; value: BehaviorJson }>;
}>;
