import type { WorldComposition } from '../../composition/contracts';
import { createRegisteredOperationRuntime } from '../../composition/registered-operations';
import type {
  RegisteredOperationBinding,
  RegisteredOperationRequest,
  RegisteredStatePort,
} from '../../composition/operation-contracts';
import type { WorldResourceAuthorizer } from '../../harness/world-authorization';
import type { CoreClone } from '../../../runtime/platform-ports';
import type { EntityStore } from '../entity-store';
import { MODE_COMPONENT } from './mode-module';

/** The host owns lifetime validation and routes only admitted atomic participants. */
export class GameplayModuleRuntime {
  private readonly executions = new Set<ReturnType<typeof createRegisteredOperationRuntime>>();
  private disposed = false;
  private committing = false;
  private readonly transactionScope = {
    enter: () => {
      if (this.committing) return false;
      this.committing = true;
      return true;
    },
    leave: () => {
      this.committing = false;
    },
  };
  constructor(
    private readonly options: Readonly<{
      composition?: WorldComposition;
      entities: EntityStore;
      clone: CoreClone;
      inventory: RegisteredStatePort;
      mode: RegisteredStatePort;
    }>,
  ) {}

  bind(authorizer: WorldResourceAuthorizer, source: RegisteredOperationBinding) {
    if (this.disposed) throw new Error('Gameplay modules are disposed.');
    if (this.executions.size >= 256) throw new RangeError('Gameplay module binding budget exceeded.');
    const { composition, entities } = this.options;
    if (!composition) throw new Error('Registered operations require a composed world.');
    const reference = entities.createReference(source.originalActorId);
    if (!reference) throw new TypeError('Module actor is unknown.');
    const participant = (component: string) => {
      if (component === 'seedlands:inventory') return this.options.inventory;
      if (component === MODE_COMPONENT) return this.options.mode;
      throw new TypeError(`No state owner for ${component}.`);
    };
    const runtime = createRegisteredOperationRuntime({
      composition,
      authorizer,
      clone: this.options.clone,
      transactionScope: this.transactionScope,
      bindingValid: (binding) =>
        binding.originalActorId === reference.entityId && entities.resolveReference(reference) !== null,
      state: {
        read: (address) => participant(address.componentId).read(address),
        commit: (observed, writes) => {
          const owners = new Set([...observed, ...writes].map(({ address }) => participant(address.componentId)));
          if (owners.size !== 1) return { ok: false, reason: 'unsupported-atomic-participants' };
          return [...owners][0].commit(observed, writes);
        },
      },
    });
    const execution = runtime.bind(source);
    this.executions.add(runtime);
    return Object.freeze({
      ...execution,
      dispose: () => {
        runtime.dispose();
        this.executions.delete(runtime);
      },
    });
  }

  invoke(
    authorizer: WorldResourceAuthorizer,
    source: Omit<RegisteredOperationBinding, 'moduleId'>,
    request: RegisteredOperationRequest,
  ) {
    const owned = this.options.composition?.registrations.operations.find(
      (entry) => entry.definition.id === request.operationId,
    );
    if (!owned) return { ok: false as const, code: 'OPERATION_UNKNOWN', message: 'Operation is not registered.' };
    const execution = this.bind(authorizer, { ...source, moduleId: owned.moduleId });
    try {
      return execution.invoke(request);
    } finally {
      execution.dispose();
    }
  }

  flushQueued() {
    if (this.committing) throw new Error('Cannot drain module operations during a commit.');
    let remaining = 64;
    for (const runtime of [...this.executions]) {
      if (remaining === 0) break;
      remaining -= runtime.flushQueued(remaining).length;
    }
  }

  clearBindings() {
    this.executions.forEach((runtime) => runtime.dispose());
    this.executions.clear();
  }
  dispose() {
    this.clearBindings();
    this.disposed = true;
  }
}
