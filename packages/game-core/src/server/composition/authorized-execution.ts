import type {
  WorldAuthorizationDecision,
  WorldAuthorizationTarget,
  WorldOperation,
  WorldPrincipal,
  WorldResourceAuthorizer,
} from '../harness/world-authorization';
import type { CoreClone } from '../../runtime/platform-ports';
import type { ModuleInvocation, ModuleInvocationValue, WorldComposition } from './contracts';

const INPUT_BUDGET = 65_536;
const INPUT_MAX_DEPTH = 32;

const validateInvocationData = (
  value: ModuleInvocationValue | undefined,
  forbidden: ReadonlySet<object> | undefined,
  collected: Set<object> | undefined,
  freeze: boolean,
): void => {
  let budget = INPUT_BUDGET;
  const seen = new Set<object>();
  const visit = (entry: ModuleInvocationValue | undefined, depth: number, root: boolean): void => {
    if (--budget < 0 || depth > INPUT_MAX_DEPTH) throw new TypeError('Module invocation input exceeds its data limit.');
    if (entry === undefined) {
      if (root) return;
      throw new TypeError('Module invocation input must be JSON-compatible data.');
    }
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new TypeError('Module invocation input numbers must be finite.');
      return;
    }
    if (typeof entry === 'string') {
      budget -= entry.length;
      if (budget < 0) throw new TypeError('Module invocation input exceeds its data limit.');
      return;
    }
    if (typeof entry !== 'object') throw new TypeError('Module invocation input must be JSON-compatible data.');
    if (forbidden?.has(entry)) throw new TypeError('Core clone port returned input that shares caller-owned objects.');
    if (seen.has(entry))
      throw new TypeError('Module invocation input must not contain cycles or shared object aliases.');
    seen.add(entry);
    collected?.add(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(entry))
      throw new TypeError('Module invocation input objects must use the plain data prototype.');
    const keys = Object.keys(entry);
    if (Array.isArray(entry)) {
      if (keys.length !== entry.length || Reflect.ownKeys(entry).length !== keys.length + 1)
        throw new TypeError('Module invocation input arrays must be dense plain data.');
    } else if (Reflect.ownKeys(entry).length !== keys.length)
      throw new TypeError('Module invocation input must only contain enumerable string keys.');
    for (const key of keys) {
      budget -= key.length;
      if (budget < 0) throw new TypeError('Module invocation input exceeds its data limit.');
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || !('value' in descriptor))
        throw new TypeError('Module invocation input must not contain accessors.');
      visit(descriptor.value as ModuleInvocationValue | undefined, depth + 1, false);
    }
    if (freeze) Object.freeze(entry);
  };
  visit(value, 0, true);
};

const snapshotInvocationInput = (
  value: ModuleInvocationValue | undefined,
  clone: CoreClone,
): ModuleInvocationValue | undefined => {
  const callerObjects = new Set<object>();
  validateInvocationData(value, undefined, callerObjects, false);
  const snapshot = clone(value);
  validateInvocationData(snapshot, callerObjects, undefined, true);
  return snapshot;
};

export type ModuleExecutionContext = Readonly<{
  principal: WorldPrincipal;
  originalActorId: string;
  provenance: Readonly<{ packId: string; moduleId: string }>;
  target: WorldAuthorizationTarget;
}>;

export type ModuleResourceExecutor = Readonly<
  Partial<
    Record<WorldOperation, (context: ModuleExecutionContext, input: ModuleInvocationValue | undefined) => unknown>
  >
>;

export type ModuleInvocationResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{
      ok: false;
      code:
        | Exclude<WorldAuthorizationDecision, { allowed: true }>['code']
        | 'MODULE_PERMISSION_DENIED'
        | 'MODULE_RESOURCE_EXECUTOR_MISSING';
      message: string;
    }>;

export type AuthorizedModuleExecution = Readonly<{
  invoke(invocation: ModuleInvocation): ModuleInvocationResult;
}>;

export function createAuthorizedModuleExecution(
  input: Readonly<{
    composition: WorldComposition;
    moduleId: string;
    principalId: string;
    originalActorId: string;
    authorizer: WorldResourceAuthorizer;
    clone: CoreClone;
    executors: Readonly<Record<string, ModuleResourceExecutor>>;
  }>,
): AuthorizedModuleExecution {
  const { moduleId, principalId, originalActorId, authorizer, clone } = input;
  if (typeof clone !== 'function') throw new TypeError('Authorized module execution requires a core clone port.');
  const binding = input.composition.moduleBindings[moduleId];
  if (!binding) throw new TypeError(`Unknown assembled module: ${moduleId}`);
  const principal = authorizer.principal(principalId);
  if (principal?.boundEntityId && principal.boundEntityId !== originalActorId)
    throw new TypeError('Original actor does not match the host-bound principal.');
  const permissions = Object.freeze(
    binding.permissions.map((permission) =>
      Object.freeze({ resource: permission.resource, operations: Object.freeze([...permission.operations]) }),
    ),
  );
  const executors = new Map(
    Object.entries(input.executors).map(([resource, value]) => [resource, Object.freeze({ ...value })] as const),
  );
  const provenance = Object.freeze({ packId: binding.packId, moduleId });
  const freezeTarget = (target: WorldAuthorizationTarget): WorldAuthorizationTarget => {
    if (target.kind === 'chunk')
      return Object.freeze({ kind: 'chunk', chunk: Object.freeze([...target.chunk]) }) as WorldAuthorizationTarget;
    if (target.kind === 'voxel')
      return Object.freeze({
        kind: 'voxel',
        position: Object.freeze([...target.position]),
      }) as WorldAuthorizationTarget;
    return Object.freeze({ ...target });
  };
  return Object.freeze({
    invoke(invocation: ModuleInvocation): ModuleInvocationResult {
      const request = Object.freeze({
        resource: invocation.resource,
        operation: invocation.operation,
        target: freezeTarget(invocation.target),
      });
      const decision = authorizer.authorize(principalId, request);
      if (!decision.allowed) return Object.freeze({ ok: false, code: decision.code, message: decision.message });
      const permission = permissions.find((candidate) => candidate.resource === request.resource);
      if (!permission?.operations.includes(request.operation))
        return Object.freeze({
          ok: false,
          code: 'MODULE_PERMISSION_DENIED',
          message: 'The assembled module was not granted this world resource operation.',
        });
      const executor = executors.get(request.resource)?.[request.operation];
      if (!executor)
        return Object.freeze({
          ok: false,
          code: 'MODULE_RESOURCE_EXECUTOR_MISSING',
          message: 'No host executor is registered for this world resource operation.',
        });
      const context = Object.freeze({
        principal: decision.principal,
        originalActorId,
        provenance,
        target: request.target,
      });
      const snapshot = snapshotInvocationInput(invocation.input, clone);
      return Object.freeze({ ok: true, value: executor(context, snapshot) });
    },
  });
}
