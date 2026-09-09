import type { CoreClone } from '../../runtime/platform-ports';
import type { WorldAuthorizationTarget, WorldResourceAuthorizer } from '../harness/world-authorization';
import type { ModuleExecutionContext } from './authorized-execution';
import type { ModuleInvocationValue, WorldComposition } from './contracts';

export type ModStateAddress = Readonly<{ componentId: string; target: WorldAuthorizationTarget }>;
export type ModStateDefinition = Readonly<{
  id: string;
  version: string;
  resource: string;
  validate(value: ModuleInvocationValue): boolean;
}>;
export type ModCandidateState = Readonly<{
  read(address: ModStateAddress): ModuleInvocationValue;
  write(address: ModStateAddress, value: ModuleInvocationValue): void;
}>;
export type ModOperationDefinition = Readonly<{
  id: string;
  resource: string;
  run(
    context: ModuleExecutionContext,
    input: ModuleInvocationValue | undefined,
    state: ModCandidateState,
  ): ModuleInvocationValue;
}>;
export type ModRuleDefinition = Readonly<{
  id: string;
  operationId: string;
  before?: readonly string[];
  after?: readonly string[];
  apply(
    context: ModuleExecutionContext,
    input: ModuleInvocationValue | undefined,
    state: ModCandidateState,
  ): void | Readonly<{ reject: string }>;
}>;
export type ModuleOwned<Definition> = Readonly<{ moduleId: string; definition: Definition }>;
export type OperationRegistrations = Readonly<{
  states: readonly ModuleOwned<ModStateDefinition>[];
  operations: readonly ModuleOwned<ModOperationDefinition>[];
  rules: readonly ModuleOwned<ModRuleDefinition>[];
}>;
export type ObservedModState = Readonly<{ address: ModStateAddress; revision: number }>;
export type ModStateWrite = Readonly<{ address: ModStateAddress; value: ModuleInvocationValue }>;
/** A host owner must check every observed revision and validate the entire batch before replacing any state. */
export type RegisteredStatePort = Readonly<{
  read(address: ModStateAddress): Readonly<{ revision: number; value: ModuleInvocationValue }>;
  commit(
    observed: readonly ObservedModState[],
    writes: readonly ModStateWrite[],
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
  observed: readonly ObservedModState[];
  writes: readonly ModStateWrite[];
}>;
export type RegisteredOperationBinding = Readonly<{ moduleId: string; principalId: string; originalActorId: string }>;
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
