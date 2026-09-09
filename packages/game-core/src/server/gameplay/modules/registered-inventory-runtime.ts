import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import type { ModuleInvocationValue, WorldComposition } from '../../composition/contracts';
import type { ModuleActorAuthority } from '../../composition/gameplay-actor-authority';
import type {
  ModStateAddress,
  ObservedModState,
  RegisteredCommitContext,
  RegisteredStatePort,
  PreparedRegisteredCommit,
} from '../../composition/operation-contracts';
import type { AutonomyRuntime } from '../../simulation/autonomy-runtime';
import type { EntityStore } from '../entity-store';
import type { GameplayContent } from '../gameplay-content';
import type { GameplayModuleRuntime } from './gameplay-module-runtime';
import { prepareEntityMutation } from '../prepared-entity-mutation';
import { positionsInRange } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import {
  INVENTORY_ACTOR_COMPONENT,
  INVENTORY_ITEM_COMPONENT,
  INVENTORY_RESOURCE,
  INVENTORY_ITEM_RESOURCE,
  buildInventoryActionCandidate,
  inventoryActorAddress,
  inventoryItemAddress,
  validateInventoryActorProjection,
  validateInventoryWorldItemProjection,
  type InventoryActionKind,
} from './inventory-action-model';

type Options = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  content: GameplayContent;
  actorAuthority?: ModuleActorAuthority;
  modules(): GameplayModuleRuntime;
  simulation(): AutonomyRuntime;
  revision(): number;
  assertCanChange(): void;
  changed(inventoryOperation: boolean): void;
  getVoxel(position: [number, number, number]): number | undefined;
}>;
const kinds: readonly InventoryActionKind[] = ['select', 'move', 'consume', 'craft', 'drop', 'pickup'];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Registered Inventory commands coordinate the existing ECS and Combat owners. */
export class RegisteredInventoryRuntime {
  readonly state: RegisteredStatePort;
  private sequence = 0;
  private readonly receipts = new Map<number, Readonly<{ address: string; signature: string }>>();
  constructor(private readonly options: Options) {
    this.state = Object.freeze<RegisteredStatePort>({
      read: (address) => {
        const value = this.project(address);
        if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Inventory observation capacity exhausted.');
        const revision = ++this.sequence;
        this.receipts.set(revision, { address: JSON.stringify(address), signature: this.signature(address, value) });
        while (this.receipts.size > 128) this.receipts.delete(this.receipts.keys().next().value!);
        return { revision, value };
      },
      commit: () => ({ ok: false, reason: 'Inventory actions require a prepared commit.' }),
      prepareCommit: (observed, writes, execution) => {
        if (writes.length)
          return {
            ok: false,
            code: 'INVENTORY_WRITE_FORBIDDEN',
            reason: 'Inventory actions return candidates, not writes.',
          };
        this.validateObserved(observed);
        return this.prepare(observed, execution);
      },
    });
  }
  private actor(id: string) {
    const entity = this.options.entities.get(id);
    if (!entity || entity.type === 'world-item') throw new Error('unknown-actor');
    const actor = this.options.entities.actorStateAccess(id);
    return validateInventoryActorProjection(
      {
        version: 1,
        reference: this.options.entities.createReference(id),
        kind: entity.type,
        slots: actor.inventory.snapshot(),
        equipment: { selectedSlot: actor.selectedSlot, hotbarSize: actor.hotbarSize },
        lifecycle: actor.lifecycle,
        needs: { hunger: actor.hunger, maxHunger: actor.maxHunger, meaning: actor.hungerMeaning },
      },
      this.options.content.items,
    );
  }
  private item(id: string) {
    const entity = this.options.entities.get(id);
    if (!entity || entity.type !== 'world-item' || !entity.stack) throw new Error('invalid-item');
    return validateInventoryWorldItemProjection(
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
      throw new TypeError('Invalid Inventory projection address.');
    if (address.componentId === INVENTORY_ACTOR_COMPONENT) return this.actor(address.target.entityId);
    if (address.componentId === INVENTORY_ITEM_COMPONENT) return this.item(address.target.entityId);
    throw new TypeError('Unknown Inventory projection component.');
  }
  private signature(address: ModStateAddress, value = this.project(address)) {
    return JSON.stringify([this.options.revision(), address, value]);
  }
  private validateObserved(observed: readonly ObservedModState[]) {
    const seen = new Set<string>();
    for (const entry of observed) {
      const address = JSON.stringify(entry.address),
        receipt = this.receipts.get(entry.revision);
      if (
        seen.has(address) ||
        !receipt ||
        receipt.address !== address ||
        receipt.signature !== this.signature(entry.address)
      )
        throw new Error('Inventory observation is stale.');
      seen.add(address);
    }
  }
  private prepare(observed: readonly ObservedModState[], execution: RegisteredCommitContext): PreparedRegisteredCommit {
    const { context } = execution;
    const kind = kinds.find((kind) => execution.operationId === `seedlands:inventory-${kind}`);
    if (!kind || context.kind !== 'actor' || context.target.kind !== 'entity')
      throw new TypeError('Invalid Inventory execution context.');
    const actorId = context.originalActorId,
      targetId = context.target.entityId;
    if (
      (kind !== 'pickup' && targetId !== actorId) ||
      execution.resource !== (kind === 'pickup' ? INVENTORY_ITEM_RESOURCE : INVENTORY_RESOURCE)
    )
      throw new TypeError('Inventory execution target/resource mismatch.');
    const validateActorExecution = () =>
      assertActorResourceExecution(this.options.composition, execution.authorizer, context, INVENTORY_RESOURCE);
    validateActorExecution();
    const addresses = [inventoryActorAddress(actorId), ...(kind === 'pickup' ? [inventoryItemAddress(targetId)] : [])];
    if (
      observed.length !== addresses.length ||
      addresses.some((address) => !observed.some((entry) => same(entry.address, address)))
    )
      throw new TypeError('Inventory transaction observation scope mismatch.');
    const actor = this.actor(actorId);
    const candidate = buildInventoryActionCandidate(
      this.options.content,
      kind === 'pickup'
        ? { kind, actor, input: execution.effectiveInput, item: this.item(targetId) }
        : { kind, actor, input: execution.effectiveInput },
    );
    if (!same(candidate, execution.candidateValue))
      throw new TypeError('Inventory candidate does not match current state and effective input.');
    const validateGeometry = () => {
      if (candidate.pickupIntent) {
        const from = this.options.entities.get(actorId)!.position,
          to = [...candidate.pickupIntent.position] as [number, number, number];
        if (!positionsInRange(from, to, 1.5)) throw new Error('out-of-range');
        const visibility = traceVoxelRay(to, from, (x, y, z) => this.options.getVoxel([x, y, z]));
        if (visibility !== 'clear') throw new Error(visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked');
      }
    };
    validateGeometry();
    this.options.assertCanChange();
    const components = this.options.entities.actorComponentSnapshot(actorId);
    const equippedChanged =
      actor.equipment.selectedSlot !== candidate.equipment.selectedSlot ||
      !same(actor.slots[actor.equipment.selectedSlot], candidate.slots[candidate.equipment.selectedSlot]);
    const cancellation = equippedChanged
      ? this.options.simulation().prepareCancellation([actorId], 'slot-changed')
      : undefined;
    const mutation = prepareEntityMutation(this.options.entities, {
      actors: [
        {
          reference: candidate.actorReference,
          health: this.options.entities.actorStateAccess(actorId).health,
          components: {
            ...components,
            inventory: [...candidate.slots],
            equipment: candidate.equipment,
            needs: { ...components.needs, hunger: candidate.hunger.hunger },
          },
        },
      ],
      spawns: candidate.dropIntent
        ? [{ position: this.options.entities.get(actorId)!.position, stack: candidate.dropIntent.stack }]
        : [],
      despawns: candidate.pickupIntent ? [candidate.pickupIntent.reference] : [],
    });
    const value = { ...candidate.result, ...(candidate.dropIntent ? { entityId: mutation.spawnIds[0] } : {}) };
    const revision = this.options.revision();
    let validated = false,
      used = false;
    return {
      ok: true,
      revision: revision + 1,
      value,
      validate: () => {
        validated = false;
        if (used || this.options.revision() !== revision) throw new Error('Prepared Inventory action is stale.');
        this.validateObserved(observed);
        validateActorExecution();
        this.options.assertCanChange();
        validateGeometry();
        mutation.validate();
        cancellation?.validate();
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Prepared Inventory action requires validation.');
        mutation.apply();
        cancellation?.apply();
        this.options.changed(kind !== 'select');
        used = true;
      },
    };
  }
  private invoke(
    actorId: string,
    kind: InventoryActionKind,
    input: ModuleInvocationValue | undefined,
    targetId = actorId,
  ) {
    const result = this.options.modules().invokeActor(this.options.actorAuthority, actorId, {
      operationId: `seedlands:inventory-${kind}`,
      target: { kind: 'entity', entityId: targetId },
      input,
    });
    return result.ok
      ? { success: true as const, value: result.value }
      : { success: false as const, reason: result.message };
  }
  private simple(
    actorId: string,
    kind: InventoryActionKind,
    input: ModuleInvocationValue | undefined,
    targetId = actorId,
  ) {
    const result = this.invoke(actorId, kind, input, targetId);
    return result.success ? { success: true as const } : result;
  }
  select(id: string, slot: number) {
    return this.simple(id, 'select', { slot });
  }
  move(id: string, source: number, target: number) {
    return this.simple(id, 'move', { source, target });
  }
  consume(id: string, slot: number) {
    return this.simple(id, 'consume', { slot });
  }
  pickup(id: string, entityId: string) {
    return this.simple(id, 'pickup', undefined, entityId);
  }
  craft(id: string, recipeId: string) {
    const result = this.invoke(id, 'craft', { recipeId });
    if (!result.success) return result;
    const value = result.value;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('recipeId' in value) ||
      typeof value.recipeId !== 'string'
    )
      throw new Error('Inventory craft receipt is invalid.');
    const recipe = this.options.content.recipes.get(value.recipeId);
    if (!recipe) throw new Error('Committed Inventory recipe is unavailable.');
    return { success: true as const, recipe };
  }
  drop(id: string, slot: number, count: number) {
    const result = this.invoke(id, 'drop', { slot, count });
    if (!result.success) return result;
    if (
      !result.value ||
      typeof result.value !== 'object' ||
      Array.isArray(result.value) ||
      !('entityId' in result.value) ||
      typeof result.value.entityId !== 'string'
    )
      throw new Error('Inventory drop receipt is invalid.');
    return { success: true as const, entity: this.options.entities.get(result.value.entityId)! };
  }
}
