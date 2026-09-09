import {
  createAuthorizedModuleExecution,
  snapshotInvocationInput,
  type ModuleExecutionContext,
} from './authorized-execution';
import type { ModuleInvocationValue } from './contracts';
import type { WorldAuthorizationTarget, WorldOperation } from '../harness/world-authorization';
import type {
  CommittedOperationFact,
  ModCandidateState,
  ModStateAddress,
  ModStateWrite,
  ObservedModState,
  RegisteredOperationBinding,
  RegisteredOperationExecution,
  RegisteredOperationListener,
  RegisteredOperationRequest,
  RegisteredOperationResult,
  RegisteredOperationRuntimeOptions,
} from './operation-contracts';

const QUEUE_LIMIT = 64;
const STATE_LIMIT = 128;
class Rejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const reject = (code: string, message: string): never => {
  throw new Rejection(code, message);
};
const fail = (code: string, message: string): RegisteredOperationResult => Object.freeze({ ok: false, code, message });
const normalizeAddress = (address: ModStateAddress): ModStateAddress => {
  const target = address.target;
  const normalized: WorldAuthorizationTarget =
    target.kind === 'entity'
      ? Object.freeze({ kind: 'entity', entityId: target.entityId })
      : target.kind === 'voxel'
        ? Object.freeze({
            kind: 'voxel',
            position: Object.freeze([...target.position]) as readonly [number, number, number],
          })
        : target.kind === 'chunk'
          ? Object.freeze({
              kind: 'chunk',
              chunk: Object.freeze([...target.chunk]) as readonly [number, number, number],
            })
          : target.kind === 'world'
            ? Object.freeze({ kind: 'world' })
            : reject('STATE_TARGET_INVALID', 'Unknown state target.');
  return Object.freeze({
    componentId: address.componentId,
    target: normalized,
    ...(address.partition === undefined ? {} : { partition: address.partition }),
  });
};

export function createRegisteredOperationRuntime(options: RegisteredOperationRuntimeOptions) {
  const states = new Map(options.composition.registrations.states.map((entry) => [entry.definition.id, entry]));
  const operations = new Map(options.composition.registrations.operations.map((entry) => [entry.definition.id, entry]));
  const listeners = new Set<Readonly<{ binding: RegisteredOperationBinding; callback: RegisteredOperationListener }>>();
  const queued: Array<Readonly<{ execution: RegisteredOperationExecution; request: RegisteredOperationRequest }>> = [];
  let busy = false;
  let disposed = false;
  let listenerFailures = 0;
  const copy = (value: ModuleInvocationValue): ModuleInvocationValue => {
    if (value === undefined) throw new TypeError('State and results must contain JSON-compatible data.');
    return snapshotInvocationInput(value, options.clone)!;
  };

  function permit(
    binding: RegisteredOperationBinding,
    resource: string,
    operation: WorldOperation,
    target: WorldAuthorizationTarget,
  ): ModuleExecutionContext {
    let context: ModuleExecutionContext | undefined;
    const gate = createAuthorizedModuleExecution({
      ...binding,
      composition: options.composition,
      authorizer: options.authorizer,
      clone: options.clone,
      executors: {
        [resource]: {
          [operation]: (authorized: ModuleExecutionContext) => {
            context = authorized;
            return null;
          },
        },
      },
    });
    const result = gate.invoke({ resource, operation, target });
    if (!result.ok) return reject(result.code, result.message);
    if (!context) return reject('EXECUTION_CONTEXT_MISSING', 'The host did not bind an execution context.');
    return context;
  }

  function bind(source: RegisteredOperationBinding): RegisteredOperationExecution {
    const binding: RegisteredOperationBinding =
      source.kind === 'system'
        ? Object.freeze({
            kind: 'system',
            moduleId: source.moduleId,
            principalId: source.principalId,
            systemId: source.systemId,
          })
        : Object.freeze({
            kind: 'actor',
            moduleId: source.moduleId,
            principalId: source.principalId,
            originalActorId: source.originalActorId,
          });
    if (!options.composition.moduleBindings[binding.moduleId]) throw new TypeError('Unknown module binding.');
    const principal = options.authorizer.principal(binding.principalId);
    let systemOperations: readonly string[] = [];
    if (binding.kind === 'system') {
      if (principal?.kind !== 'system' || principal.boundEntityId !== undefined)
        throw new TypeError('System binding requires an explicit unbound system principal.');
      const system = options.composition.registrations.systems.find(
        (entry) => entry.moduleId === binding.moduleId && entry.definition.id === binding.systemId,
      );
      const lifecycle =
        binding.systemId === `${binding.moduleId}/lifecycle`
          ? options.composition.registrations.lifecycles.find((entry) => entry.moduleId === binding.moduleId)
          : undefined;
      if (!system && !lifecycle) throw new TypeError('Unknown system execution binding.');
      systemOperations = system
        ? [system.definition.operationId]
        : [lifecycle!.definition.startOperationId, lifecycle!.definition.stopOperationId].filter(
            (id): id is string => id !== undefined,
          );
    } else {
      if (principal?.kind === 'system') throw new TypeError('System principal cannot execute as an actor.');
      if (typeof binding.originalActorId !== 'string' || !binding.originalActorId.trim())
        throw new TypeError('Original actor identity is missing.');
      if (principal?.boundEntityId && principal.boundEntityId !== binding.originalActorId)
        throw new TypeError('Original actor does not match the host-bound principal.');
    }
    const execution: RegisteredOperationExecution = Object.freeze({
      invoke(request: RegisteredOperationRequest): RegisteredOperationResult {
        if (options.bindingValid?.(binding) === false)
          return fail(
            binding.kind === 'system' ? 'SYSTEM_REFERENCE_STALE' : 'ACTOR_REFERENCE_STALE',
            'The bound execution lifetime has ended.',
          );
        if (disposed) return fail('RUNTIME_DISPOSED', 'The module runtime has been disposed.');
        if (busy) return fail('TRANSACTION_REENTRANT', 'Synchronous transaction reentry is forbidden.');
        const owned = operations.get(request.operationId);
        if (!owned) return fail('OPERATION_UNKNOWN', 'The operation is not registered.');
        if (owned.moduleId !== binding.moduleId)
          return fail('OPERATION_NOT_OWNED', 'The operation belongs to another module.');
        if ((owned.definition.executionKind ?? 'actor') !== (binding.kind ?? 'actor'))
          return fail('EXECUTION_KIND_MISMATCH', 'Actor and system execution kinds are disjoint.');
        if (
          binding.kind === 'system' &&
          (request.target.kind !== 'world' || !systemOperations.includes(request.operationId))
        )
          return fail('SYSTEM_OPERATION_NOT_BOUND', 'The world operation does not match the registered system.');
        if (options.transactionScope && !options.transactionScope.enter())
          return fail('TRANSACTION_REENTRANT', 'The world already has an active transaction.');
        busy = true;
        let candidateOpen = true;
        try {
          const context = permit(binding, owned.definition.resource, 'execute', request.target);
          const input = snapshotInvocationInput(request.input, options.clone);
          const observed = new Map<string, ObservedModState & Readonly<{ value: ModuleInvocationValue }>>();
          const writes = new Map<string, ModStateWrite>();
          const candidateFor = (activeBinding: RegisteredOperationBinding): ModCandidateState => {
            const access = (sourceAddress: ModStateAddress, operation: 'read' | 'write') => {
              if (!candidateOpen) return reject('CANDIDATE_CLOSED', 'The candidate state access is closed.');
              const address = normalizeAddress(sourceAddress);
              const definition = states.get(address.componentId)?.definition;
              if (!definition) return reject('STATE_UNKNOWN', 'The component codec is not registered.');
              if (
                definition.partitions === undefined
                  ? address.partition !== undefined
                  : address.target.kind !== 'world' ||
                    !Number.isSafeInteger(address.partition) ||
                    address.partition! < 0 ||
                    address.partition! >= definition.partitions
              )
                return reject('STATE_PARTITION_INVALID', 'State partition address is invalid.');
              permit(activeBinding, definition.resource, operation, address.target);
              const key = JSON.stringify(address);
              let current = observed.get(key);
              if (!current) {
                if (observed.size >= STATE_LIMIT)
                  return reject('STATE_BUDGET_EXCEEDED', 'Transaction state budget exceeded.');
                // Blind writes still require a permitted read to establish their candidate revision.
                if (operation === 'write') permit(activeBinding, definition.resource, 'read', address.target);
                const snapshot = options.state.read(address);
                if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0)
                  return reject('STATE_REVISION_INVALID', 'The state owner returned an invalid revision.');
                const value = copy(snapshot.value);
                if (definition.validate(value) !== true)
                  return reject('STATE_SCHEMA_INVALID', 'The state owner returned incompatible component data.');
                current = Object.freeze({ address, revision: snapshot.revision, value });
                observed.set(key, current);
              }
              return { key, current, definition };
            };
            return Object.freeze({
              read(address: ModStateAddress) {
                const { key, current } = access(address, 'read');
                const staged = writes.get(key);
                return copy(staged ? staged.value : current.value);
              },
              readOriginal(address: ModStateAddress) {
                return copy(access(address, 'read').current.value);
              },
              write(address: ModStateAddress, value: ModuleInvocationValue) {
                const { key, current } = access(address, 'write');
                writes.set(key, Object.freeze({ address: current.address, value: copy(value) }));
              },
            });
          };
          const applyRules = (stage: 'before' | 'after', startingInput: ModuleInvocationValue | undefined) => {
            let effectiveInput = startingInput;
            for (const rule of options.composition.registrations.rules) {
              if (rule.definition.operationId !== request.operationId || (rule.definition.stage ?? 'after') !== stage)
                continue;
              const ruleBinding = Object.freeze({ ...binding, moduleId: rule.moduleId });
              const ruleContext = permit(ruleBinding, owned.definition.resource, 'execute', context.target);
              const result = rule.definition.apply(ruleContext, effectiveInput, candidateFor(ruleBinding));
              if (result === undefined) continue;
              const decision = copy(result);
              if (
                !decision ||
                typeof decision !== 'object' ||
                Array.isArray(decision) ||
                Object.keys(decision).length !== 1
              )
                throw new TypeError('Rules must synchronously accept, reject, or transform before input.');
              if ('reject' in decision && typeof decision.reject === 'string' && decision.reject.trim())
                return reject('RULE_REJECTED', decision.reject);
              if (stage !== 'before' || !('input' in decision))
                throw new TypeError('Only before rules can replace operation input.');
              effectiveInput = copy(decision.input);
            }
            return effectiveInput;
          };
          const effectiveInput = applyRules('before', input);
          let result: ModuleInvocationValue;
          if (owned.definition.executionKind === 'system') {
            if (context.kind !== 'system') return reject('EXECUTION_KIND_MISMATCH', 'Expected a system context.');
            result = owned.definition.run(context, effectiveInput, candidateFor(binding));
          } else {
            if (context.kind !== 'actor') return reject('EXECUTION_KIND_MISMATCH', 'Expected an actor context.');
            result = owned.definition.run(context, effectiveInput, candidateFor(binding));
          }
          const value = copy(result);
          applyRules('after', effectiveInput);
          for (const write of writes.values()) {
            if (states.get(write.address.componentId)!.definition.validate(write.value) !== true)
              return reject('STATE_SCHEMA_INVALID', 'A candidate violates its registered component invariant.');
          }
          const observations = Object.freeze(
            [...observed.values()].map(({ address, revision }) => Object.freeze({ address, revision })),
          );
          const changes = Object.freeze([...writes.values()]);
          candidateOpen = false;
          const committed = options.state.commit(observations, changes);
          if (!committed.ok) return fail('STATE_CONFLICT', committed.reason);
          const fact: CommittedOperationFact = Object.freeze({
            operationId: request.operationId,
            context,
            revision: committed.revision,
            value,
            ...(input === undefined ? {} : { input }),
            ...(effectiveInput === undefined ? {} : { effectiveInput }),
            observed: observations,
            writes: changes,
          });
          publish(fact, owned.definition.resource);
          return Object.freeze({ ok: true, value, revision: committed.revision });
        } catch (error) {
          return fail(
            error instanceof Rejection ? error.code : 'OPERATION_FAILED',
            error instanceof Error ? error.message : 'Operation failed.',
          );
        } finally {
          candidateOpen = false;
          busy = false;
          options.transactionScope?.leave();
        }
      },
      subscribe(callback: RegisteredOperationListener) {
        if (disposed || options.bindingValid?.(binding) === false) throw new Error('The module binding has ended.');
        const listener = Object.freeze({ binding, callback });
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    });
    return execution;
  }

  function publish(fact: CommittedOperationFact, resource: string) {
    for (const listener of [...listeners]) {
      if (disposed) break;
      if (!listeners.has(listener)) continue;
      try {
        permit(listener.binding, resource, 'read', fact.context.target);
        for (const observed of fact.observed)
          permit(
            listener.binding,
            states.get(observed.address.componentId)!.definition.resource,
            'read',
            observed.address.target,
          );
      } catch {
        continue;
      }
      try {
        listener.callback(fact, (request) => {
          if (disposed || queued.length >= QUEUE_LIMIT) return false;
          try {
            const snapshot = copy({
              operationId: request.operationId,
              target: request.target,
              ...(request.input === undefined ? {} : { input: request.input }),
            }) as RegisteredOperationRequest;
            queued.push(Object.freeze({ execution: bind(listener.binding), request: snapshot }));
            return true;
          } catch {
            return false;
          }
        });
      } catch {
        listenerFailures++;
      }
    }
  }

  return Object.freeze({
    bind,
    flushQueued(limit = QUEUE_LIMIT): readonly RegisteredOperationResult[] {
      if (busy) throw new Error('Cannot drain operations during an active transaction.');
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > QUEUE_LIMIT)
        throw new RangeError('Invalid queued operation budget.');
      const count = Math.min(limit, queued.length);
      const results: RegisteredOperationResult[] = [];
      for (let index = 0; index < count; index++) {
        const entry = queued.shift();
        if (!entry || disposed) break;
        results.push(entry.execution.invoke(entry.request));
      }
      return Object.freeze(results);
    },
    diagnostics: () => Object.freeze({ queued: queued.length, listeners: listeners.size, listenerFailures, disposed }),
    dispose() {
      disposed = true;
      listeners.clear();
      queued.length = 0;
    },
  });
}
