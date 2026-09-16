import type { CoreClone } from '../../runtime/platform-ports';
import type { WorldAuthorizationTarget, WorldResourceAuthorizer } from '../harness/world-authorization';
import type {
  ModuleExecutionContext,
  ActorModuleExecutionContext,
  SystemModuleExecutionContext,
} from './authorized-execution';
import type { ModuleInvocationValue, WorldComposition } from './contracts';

export type ModStateAddress = Readonly<{ componentId: string; target: WorldAuthorizationTarget; partition?: number }>;
export type ModStateDefinition = Readonly<{
  partitions?: number;
  id: string;
  version: string;
  resource: string;
  validate(value: ModuleInvocationValue): boolean;
}>;
export type ModCandidateState = Readonly<{
  read(address: ModStateAddress): ModuleInvocationValue;
  readOriginal(address: ModStateAddress): ModuleInvocationValue;
  write(address: ModStateAddress, value: ModuleInvocationValue): void;
}>;
type OperationRun<Context extends ModuleExecutionContext> = (
  context: Context,
  input: ModuleInvocationValue | undefined,
  state: ModCandidateState,
) => ModuleInvocationValue;
export type ModOperationDefinition = Readonly<{ id: string; resource: string }> &
  (
    | Readonly<{ executionKind?: 'actor'; run: OperationRun<ActorModuleExecutionContext> }>
    | Readonly<{ executionKind: 'system'; run: OperationRun<SystemModuleExecutionContext> }>
  );
type ModRuleIdentity = Readonly<{
  id: string;
  operationId: string;
  before?: readonly string[];
  after?: readonly string[];
}>;
type RuleApply<Result> = (
  context: ModuleExecutionContext,
  input: ModuleInvocationValue | undefined,
  state: ModCandidateState,
  candidate?: ModuleInvocationValue,
) => Result;
export type ModRuleDefinition = ModRuleIdentity &
  (
    | Readonly<{
        stage: 'before';
        apply: RuleApply<void | Readonly<{ reject: string }> | Readonly<{ input: ModuleInvocationValue }>>;
      }>
    | Readonly<{ stage?: 'after'; apply: RuleApply<void | Readonly<{ reject: string }>> }>
  );
export type ModuleOwned<Definition> = Readonly<{ moduleId: string; definition: Definition }>;
export type OperationRegistrations = Readonly<{
  states: readonly ModuleOwned<ModStateDefinition>[];
  operations: readonly ModuleOwned<ModOperationDefinition>[];
  rules: readonly ModuleOwned<ModRuleDefinition>[];
}>;
export type ObservedModState = Readonly<{ address: ModStateAddress; revision: number }>;
export type ModStateWrite = Readonly<{ address: ModStateAddress; value: ModuleInvocationValue }>;
/** Host-only authority derived from the executed operation, never from candidate data. */
export type RegisteredCommitContext = Readonly<{
  operationId: string;
  resource: string;
  context: ModuleExecutionContext;
  authorizer: WorldResourceAuthorizer;
  candidateValue: ModuleInvocationValue;
  effectiveInput?: ModuleInvocationValue;
}>;
export type PreparedRegisteredCommit =
  | Readonly<{ ok: false; code: string; reason: string }>
  | Readonly<{
      ok: true;
      revision: number;
      value: ModuleInvocationValue;
      validate(): void;
      apply(): void;
    }>;
/** A host owner must check every observed revision and validate the entire batch before replacing any state. */
export type RegisteredStatePort = Readonly<{
  read(address: ModStateAddress): Readonly<{ revision: number; value: ModuleInvocationValue }>;
  prepareCommit?(
    observed: readonly ObservedModState[],
    writes: readonly ModStateWrite[],
    execution: RegisteredCommitContext,
  ): PreparedRegisteredCommit | undefined;
  commit(
    observed: readonly ObservedModState[],
    writes: readonly ModStateWrite[],
    execution?: RegisteredCommitContext,
  ): Readonly<{ ok: true; revision: number } | { ok: false; reason: string }>;
}>;
export type RegisteredOperationRequest = Readonly<{
  operationId: string;
  target: WorldAuthorizationTarget;
  input?: ModuleInvocationValue;
}>;
export type RegisteredOperationResult = Readonly<
  { ok: true; value: ModuleInvocationValue; revision: number } | { ok: false; code: string; message: string }
>;
export type CommittedOperationFact = Readonly<{
  operationId: string;
  context: ModuleExecutionContext;
  revision: number;
  value: ModuleInvocationValue;
  input?: ModuleInvocationValue;
  effectiveInput?: ModuleInvocationValue;
  observed: readonly ObservedModState[];
  writes: readonly ModStateWrite[];
}>;
export type RegisteredActorOperationBinding = Readonly<{
  moduleId: string;
  principalId: string;
  kind?: 'actor';
  originalActorId: string;
  systemId?: never;
}>;
export type RegisteredSystemOperationBinding = Readonly<{
  moduleId: string;
  principalId: string;
  kind: 'system';
  systemId: string;
  originalActorId?: never;
}>;
export type RegisteredOperationBinding = RegisteredActorOperationBinding | RegisteredSystemOperationBinding;
export type RegisteredOperationListener = (
  fact: CommittedOperationFact,
  enqueue: (request: RegisteredOperationRequest) => boolean,
) => void;
export type RegisteredOperationExecution = Readonly<{
  invoke(request: RegisteredOperationRequest): RegisteredOperationResult;
  subscribe(listener: RegisteredOperationListener): () => void;
}>;
export type RegisteredOperationRuntimeOptions = Readonly<{
  composition: WorldComposition;
  authorizer: WorldResourceAuthorizer;
  clone: CoreClone;
  state: RegisteredStatePort;
  transactionScope?: Readonly<{ enter(): boolean; leave(): void }>;
  bindingValid?: (binding: RegisteredOperationBinding) => boolean;
}>;
