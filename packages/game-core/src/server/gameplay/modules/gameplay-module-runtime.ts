import { FEEDING_ACTOR_COMPONENT, FEEDING_ITEM_COMPONENT } from './feeding-model';
import { BLOCK_ACTOR_COMPONENT, BLOCK_VOXEL_COMPONENT, BLOCK_WORLD_COMPONENT } from './block-action-model';
import type { WorldComposition } from '../../composition/contracts';
import type { ModuleActorAuthority } from '../../composition/gameplay-actor-authority';
import { createRegisteredOperationRuntime } from '../../composition/registered-operations';
import type {
  RegisteredActorOperationBinding,
  RegisteredSystemOperationBinding,
  RegisteredOperationBinding,
  RegisteredOperationRequest,
  RegisteredStatePort,
} from '../../composition/operation-contracts';
import type { WorldResourceAuthorizer } from '../../harness/world-authorization';
import type { CoreClone } from '../../../runtime/platform-ports';
import type { EntityStore } from '../entity-store';
import { COMBAT_ACTOR_COMPONENT, COMBAT_WORLD_COMPONENT } from './combat-model';
import { INVENTORY_ACTOR_COMPONENT, INVENTORY_ITEM_COMPONENT } from './inventory-action-model';
import { NEEDS_COMPONENT } from './needs-model';
import { MODE_COMPONENT } from './mode-module';
import { RULESET_COMPONENT } from './ruleset-module';

/** The host owns lifetime validation and routes only admitted atomic participants. */
export class GameplayModuleRuntime {
  private readonly executions = new Set<ReturnType<typeof createRegisteredOperationRuntime>>();
  private disposed = false;
  private lifecycleToken = {};
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
      inventoryActions?: RegisteredStatePort;
      mode: RegisteredStatePort;
      ruleset: RegisteredStatePort;
      needs: RegisteredStatePort;
      combat?: RegisteredStatePort;
      blocks?: RegisteredStatePort;
      feeding?: RegisteredStatePort;
    }>,
  ) {}

  bind(authorizer: WorldResourceAuthorizer, source: RegisteredActorOperationBinding) {
    const reference = this.options.entities.createReference(source.originalActorId);
    if (!reference) throw new TypeError('Module actor is unknown.');
    return this.bindExecution(authorizer, source, () => this.options.entities.resolveReference(reference) !== null);
  }

  bindSystem(authorizer: WorldResourceAuthorizer, source: RegisteredSystemOperationBinding) {
    const token = this.lifecycleToken;
    return this.bindExecution(authorizer, source, () => this.lifecycleToken === token && !this.disposed);
  }

  private bindExecution(
    authorizer: WorldResourceAuthorizer,
    source: RegisteredOperationBinding,
    bindingValid: () => boolean,
  ) {
    if (this.disposed) throw new Error('Gameplay modules are disposed.');
    if (this.executions.size >= 256) throw new RangeError('Gameplay module binding budget exceeded.');
    const { composition } = this.options;
    if (!composition) throw new Error('Registered operations require a composed world.');
    const participant = (component: string) => {
      if (component === 'seedlands:inventory') return this.options.inventory;
      if (
        (component === INVENTORY_ACTOR_COMPONENT || component === INVENTORY_ITEM_COMPONENT) &&
        this.options.inventoryActions
      )
        return this.options.inventoryActions;
      if ((component === COMBAT_ACTOR_COMPONENT || component === COMBAT_WORLD_COMPONENT) && this.options.combat)
        return this.options.combat;
      if (
        [BLOCK_ACTOR_COMPONENT, BLOCK_VOXEL_COMPONENT, BLOCK_WORLD_COMPONENT].includes(component) &&
        this.options.blocks
      )
        return this.options.blocks;
      if ([FEEDING_ACTOR_COMPONENT, FEEDING_ITEM_COMPONENT].includes(component) && this.options.feeding)
        return this.options.feeding;
      if (component === NEEDS_COMPONENT) return this.options.needs;
      if (component === MODE_COMPONENT) return this.options.mode;
      if (component === RULESET_COMPONENT) return this.options.ruleset;
      throw new TypeError(`No state owner for ${component}.`);
    };
    const runtime = createRegisteredOperationRuntime({
      composition,
      authorizer,
      clone: this.options.clone,
      transactionScope: this.transactionScope,
      bindingValid,
      state: {
        read: (address) => participant(address.componentId).read(address),
        prepareCommit: (observed, writes, execution) => {
          const mutableObserved = observed.filter(({ address }) => address.componentId !== RULESET_COMPONENT);
          const owners = new Set(
            [...mutableObserved, ...writes].map(({ address }) => participant(address.componentId)),
          );
          if (owners.size !== 1) return undefined;
          const owner = [...owners][0];
          if (!owner.prepareCommit) return undefined;
          const immutable = this.options.ruleset.commit(
            observed.filter(({ address }) => address.componentId === RULESET_COMPONENT),
            writes.filter(({ address }) => address.componentId === RULESET_COMPONENT),
            execution,
          );
          if (!immutable.ok) return { ok: false, code: 'STATE_CONFLICT', reason: immutable.reason };
          return owner.prepareCommit(mutableObserved, writes, execution);
        },
        commit: (observed, writes, execution) => {
          const rulesetObserved = observed.filter(({ address }) => address.componentId === RULESET_COMPONENT);
          const rulesetWrites = writes.filter(({ address }) => address.componentId === RULESET_COMPONENT);
          const immutable = this.options.ruleset.commit(rulesetObserved, rulesetWrites, execution);
          if (!immutable.ok) return immutable;
          const mutableObserved = observed.filter(({ address }) => address.componentId !== RULESET_COMPONENT);
          const owners = new Set(
            [...mutableObserved, ...writes].map(({ address }) => participant(address.componentId)),
          );
          if (owners.size === 0) return immutable;
          if (owners.size !== 1) return { ok: false, reason: 'unsupported-atomic-participants' };
          return [...owners][0].commit(mutableObserved, writes, execution);
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
    source: Omit<RegisteredActorOperationBinding, 'moduleId'>,
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

  invokeActor(authority: ModuleActorAuthority | undefined, actorId: string, request: RegisteredOperationRequest) {
    const actor = this.options.entities.get(actorId);
    const binding = actor && authority?.forActor(actorId, actor.type);
    if (!binding)
      return {
        ok: false as const,
        code: 'ACTOR_AUTHORITY_UNAVAILABLE',
        message: 'Gameplay actor authority is unavailable.',
      };
    return this.invoke(binding.authorizer, { principalId: binding.principalId, originalActorId: actorId }, request);
  }

  flushQueued() {
    if (this.committing) throw new Error('Cannot drain module operations during a commit.');
    let remaining = 64;
    for (const runtime of [...this.executions]) {
      if (remaining === 0) break;
      remaining -= runtime.flushQueued(remaining).length;
    }
  }

  prepareSnapshot() {
    this.flushQueued();
    if ([...this.executions].some((runtime) => runtime.diagnostics().queued !== 0))
      throw new Error('Module operation queue exceeds the snapshot frontier budget.');
  }

  clearBindings() {
    this.lifecycleToken = {};
    this.executions.forEach((runtime) => runtime.dispose());
    this.executions.clear();
  }
  dispose() {
    this.clearBindings();
    this.disposed = true;
  }
}
