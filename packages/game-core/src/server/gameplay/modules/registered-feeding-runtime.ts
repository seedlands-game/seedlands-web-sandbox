import type { WorldComposition, ModuleInvocationValue } from '../../composition/contracts';
import type { ModuleActorAuthority } from '../../composition/gameplay-actor-authority';
import type {
  ModStateAddress,
  ObservedModState,
  RegisteredCommitContext,
  RegisteredStatePort,
  PreparedRegisteredCommit,
} from '../../composition/operation-contracts';
import type { WorldModuleBinding } from '../../commands/module-command';
import type { ActorAction } from '../../simulation/action-runtime';
import type { ActorAuthorityActionResult } from '../../simulation/actor-authority-rules';
import type { AutonomyRuntime } from '../../simulation/autonomy-runtime';
import { prepareFeedingEffects } from '../../simulation/prepared-feeding-effects';
import type { EntityStore } from '../entity-store';
import type { GameplayContent } from '../gameplay-content';
import { prepareEntityMutation } from '../prepared-entity-mutation';
import { positionsInRange } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import type { GameplayModuleRuntime } from './gameplay-module-runtime';
import {
  FEEDING_ACTOR_COMPONENT,
  FEEDING_ACTOR_RESOURCE,
  FEEDING_ITEM_COMPONENT,
  FEEDING_ITEM_RESOURCE,
  FEEDING_CONSUME_WORLD_ITEM_OPERATION,
  feedingActorAddress,
  feedingItemAddress,
  validateFeedingActorProjection,
  validateFeedingItemProjection,
  buildFeedingCandidate,
} from './feeding-model';

type Options = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  content: GameplayContent;
  actorAuthority?: ModuleActorAuthority;
  modules(): GameplayModuleRuntime;
  simulation(): AutonomyRuntime;
  revision(): number;
  assertCanChange(): void;
  changed(): void;
  getVoxel(position: [number, number, number]): number | undefined;
}>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const rejected = (reason: string): ActorAuthorityActionResult => ({ accepted: false, changed: false, reason });

export class RegisteredFeedingRuntime {
  readonly state: RegisteredStatePort;
  private sequence = 0;
  private readonly observations = new Map<number, Readonly<{ address: string; signature: string }>>();
  constructor(private readonly options: Options) {
    this.state = {
      read: (address) => {
        const value = this.project(address);
        if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Feeding observation capacity exhausted.');
        const revision = ++this.sequence;
        this.observations.set(revision, {
          address: JSON.stringify(address),
          signature: this.signature(address, value),
        });
        while (this.observations.size > 128) this.observations.delete(this.observations.keys().next().value!);
        return { revision, value };
      },
      commit: () => ({ ok: false, reason: 'Feeding requires a prepared transaction.' }),
      prepareCommit: (observed, writes, execution) => {
        if (writes.length) throw new TypeError('Feeding candidates cannot issue direct state writes.');
        this.validateObserved(observed);
        return this.prepare(observed, execution);
      },
    };
  }
  private actor(id: string) {
    const entity = this.options.entities.get(id);
    const reference = this.options.entities.createReference(id);
    if (!entity || !reference || entity.type === 'world-item') throw new Error('unknown-actor');
    const state = this.options.entities.actorStateAccess(id);
    const actor = this.options.simulation().getActor(id);
    return validateFeedingActorProjection({
      version: 1,
      reference,
      position: entity.position,
      lifecycle: state.lifecycle,
      active: actor?.active ?? false,
      archetype: actor?.archetype ?? null,
      needs: { hunger: state.hunger, maxHunger: state.maxHunger, meaning: state.hungerMeaning },
    });
  }
  private item(id: string) {
    const entity = this.options.entities.get(id);
    if (entity?.type !== 'world-item' || !entity.stack) throw new Error('invalid-food');
    return validateFeedingItemProjection(
      {
        version: 1,
        reference: this.options.entities.createReference(id),
        position: entity.position,
        stack: entity.stack,
      },
      this.options.content.items,
    );
  }
  private project(address: ModStateAddress): ModuleInvocationValue {
    if (address.target.kind !== 'entity' || address.partition !== undefined)
      throw new TypeError('Invalid Feeding address.');
    if (address.componentId === FEEDING_ACTOR_COMPONENT) return this.actor(address.target.entityId);
    if (address.componentId === FEEDING_ITEM_COMPONENT) return this.item(address.target.entityId);
    throw new TypeError('Unknown Feeding component.');
  }
  private signature(address: ModStateAddress, value = this.project(address)) {
    return JSON.stringify([
      this.options.revision(),
      address,
      value,
      address.componentId === FEEDING_ACTOR_COMPONENT && address.target.kind === 'entity'
        ? this.options.simulation().actionForActor(address.target.entityId)
        : null,
    ]);
  }
  private validateObserved(observed: readonly ObservedModState[]) {
    const seen = new Set<string>();
    for (const entry of observed) {
      const address = JSON.stringify(entry.address),
        receipt = this.observations.get(entry.revision);
      if (
        seen.has(address) ||
        !receipt ||
        receipt.address !== address ||
        receipt.signature !== this.signature(entry.address)
      )
        throw new Error('Feeding observation is stale.');
      seen.add(address);
    }
  }
  private prepare(observed: readonly ObservedModState[], execution: RegisteredCommitContext): PreparedRegisteredCommit {
    const { context } = execution;
    const owner = this.options.composition.registrations.operations.find(
      ({ definition }) => definition.id === FEEDING_CONSUME_WORLD_ITEM_OPERATION,
    );
    if (
      execution.operationId !== FEEDING_CONSUME_WORLD_ITEM_OPERATION ||
      execution.resource !== FEEDING_ITEM_RESOURCE ||
      context.kind !== 'actor' ||
      context.target.kind !== 'entity' ||
      owner?.moduleId !== context.provenance.moduleId
    )
      throw new TypeError('Feeding execution context mismatch.');
    const actorId = context.originalActorId,
      targetId = context.target.entityId;
    const validateActorExecution = () => {
      const decision = execution.authorizer.authorize(context.principal.id, {
        resource: FEEDING_ACTOR_RESOURCE,
        operation: 'execute',
        target: { kind: 'entity', entityId: actorId },
      });
      if (!decision.allowed) throw new TypeError('Feeding actor execution permission denied.');
      const module = this.options.composition.moduleBindings[context.provenance.moduleId];
      if (
        !module?.permissions.some(
          (permission) => permission.resource === FEEDING_ACTOR_RESOURCE && permission.operations.includes('execute'),
        )
      )
        throw new TypeError('Feeding module actor execution permission denied.');
    };
    validateActorExecution();
    const addresses = [feedingActorAddress(actorId), feedingItemAddress(targetId)];
    if (observed.length !== 2 || addresses.some((address) => !observed.some((entry) => same(entry.address, address))))
      throw new TypeError('Feeding observation scope mismatch.');
    const candidate = buildFeedingCandidate(this.options.content, {
      actor: this.actor(actorId),
      item: this.item(targetId),
      input: execution.effectiveInput,
    });
    if (!same(candidate, execution.candidateValue)) throw new TypeError('Feeding candidate mismatch.');
    const validateGeometry = () => {
      const from = this.options.entities.get(actorId)!.position;
      const to = [...candidate.position] as [number, number, number];
      if (!positionsInRange(from, to, 1.1)) throw new Error('out-of-range');
      const visibility = traceVoxelRay(from, to, (x, y, z) => this.options.getVoxel([x, y, z]));
      if (visibility !== 'clear') throw new Error(visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked');
    };
    validateGeometry();
    this.options.assertCanChange();
    const components = this.options.entities.actorComponentSnapshot(actorId);
    const mutation = prepareEntityMutation(this.options.entities, {
      actors: [
        {
          reference: candidate.actorReference,
          health: this.options.entities.actorStateAccess(actorId).health,
          components: { ...components, needs: { ...components.needs, hunger: candidate.hungerAfter } },
        },
      ],
      worldItems: candidate.nextStack ? [{ reference: candidate.itemReference, count: candidate.nextStack.count }] : [],
      despawns: candidate.nextStack ? [] : [candidate.itemReference],
    });
    const effects = prepareFeedingEffects(
      this.options.simulation(),
      actorId,
      targetId,
      candidate.existingActionId ?? undefined,
    );
    const value = {
      ...candidate.result,
      action: { ...effects.action, result: { consumedEntityId: targetId, count: 1 } },
    };
    const revision = this.options.revision();
    let validated = false,
      used = false;
    return {
      ok: true,
      revision: revision + 1,
      value,
      validate: () => {
        validated = false;
        if (used || this.options.revision() !== revision) throw new Error('Prepared Feeding is stale.');
        this.validateObserved(observed);
        validateActorExecution();
        this.options.assertCanChange();
        validateGeometry();
        mutation.validate();
        effects.validate();
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Prepared Feeding requires validation or was already used.');
        mutation.apply();
        effects.apply();
        this.options.changed();
        used = true;
      },
    };
  }
  request(
    actorId: string,
    targetId: string,
    existingActionId?: string,
    binding?: WorldModuleBinding,
  ): ActorAuthorityActionResult {
    const request = {
      operationId: FEEDING_CONSUME_WORLD_ITEM_OPERATION,
      target: { kind: 'entity' as const, entityId: targetId },
      input: existingActionId ? { existingActionId } : undefined,
    };
    const result = binding
      ? this.options
          .modules()
          .invoke(binding.authorizer, { principalId: binding.principalId, originalActorId: actorId }, request)
      : this.options.modules().invokeActor(this.options.actorAuthority, actorId, request);
    if (!result.ok) return rejected(result.message);
    const value = result.value;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('action' in value) ||
      !value.action ||
      typeof value.action !== 'object' ||
      Array.isArray(value.action) ||
      !('actorId' in value.action) ||
      value.action.actorId !== actorId ||
      !('type' in value.action) ||
      value.action.type !== 'eat' ||
      !('status' in value.action) ||
      value.action.status !== 'succeeded'
    )
      throw new Error('Feeding receipt is invalid.');
    return { accepted: true, changed: true, action: value.action as unknown as ActorAction };
  }
}
