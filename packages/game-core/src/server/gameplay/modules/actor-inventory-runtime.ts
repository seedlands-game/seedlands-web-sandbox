import { prepareEntityMutation } from '../prepared-entity-mutation';
import type { EntityStore } from '../entity-store';
import { Inventory } from '../inventory';
import { positionsInRange } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import type { ActorComponentAccess } from '../ecs-actor-components';
import type { ItemStack } from '../item-registry';
import { craftRecipe, listCraftableRecipes, type RecipeRegistry } from '../recipe-registry';

type Result = { success: true } | { success: false; reason: string };
type Owner = Readonly<{
  actor(id: string): ActorComponentAccess;
  entities: EntityStore;
  getVoxel(position: [number, number, number]): number | undefined;
  assertCanChange(): void;
  assertCanCancelCombat(id: string): void;
  changed(inventoryOperation: boolean): void;
  cancelCombat(id: string, reason: string): void;
  prepareCancelCombat(id: string): Readonly<{ validate(): void; apply(): void }>;
  recipes: RecipeRegistry;
}>;

/** Domain actions forward into the single ECS inventory owner. */
export class ActorInventoryRuntime {
  constructor(private readonly owner: Owner) {}
  snapshot(id: string) {
    const actor = this.owner.actor(id);
    return { slots: actor.inventory.snapshot(), selectedSlot: actor.selectedSlot };
  }
  give(id: string, stack: ItemStack) {
    return this.adjust(id, stack, 'give');
  }
  remove(id: string, stack: ItemStack): Result {
    const result = this.adjust(id, stack, 'remove');
    return result.success ? { success: true } : result;
  }
  private adjust(id: string, stack: ItemStack, kind: 'give' | 'remove') {
    const actor = this.owner.actor(id);
    const candidate = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    if (!(kind === 'give' ? candidate.add(stack) : candidate.remove(stack)))
      return { success: false as const, reason: kind === 'give' ? 'inventory-full' : 'missing-items' };
    this.owner.assertCanChange();
    const equippedChanged =
      JSON.stringify(actor.inventory.slot(actor.selectedSlot)) !== JSON.stringify(candidate.slot(actor.selectedSlot));
    const cancellation = equippedChanged ? this.owner.prepareCancelCombat(id) : undefined;
    const slots = candidate.snapshot();
    const components = this.owner.entities.actorComponentSnapshot(id);
    const mutation = prepareEntityMutation(this.owner.entities, {
      actors: [
        {
          reference: this.owner.entities.createReference(id)!,
          health: actor.health,
          components: {
            ...components,
            inventory: slots,
            ...(equippedChanged && components.player ? { player: { ...components.player, breakAction: null } } : {}),
          },
        },
      ],
    });
    const result = { success: true as const, inventory: { slots, selectedSlot: actor.selectedSlot } };
    mutation.validate();
    cancellation?.validate();
    mutation.apply();
    cancellation?.apply();
    this.owner.changed(true);
    return result;
  }
  select(id: string, slot: number): Result {
    const actor = this.owner.actor(id),
      previous = actor.selectedSlot;
    if (!actor.selectSlot(slot)) return { success: false, reason: 'invalid-slot' };
    if (slot !== previous) this.owner.cancelCombat(id, 'slot-changed');
    this.owner.changed(false);
    return { success: true };
  }
  move(id: string, source: number, target: number): Result {
    const actor = this.owner.actor(id);
    if (actor.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    const candidate = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    if (!candidate.moveStack(source, target)) return { success: false, reason: 'cannot-move-item' };
    this.owner.assertCanChange();
    const equippedChanged = source === actor.selectedSlot || target === actor.selectedSlot;
    const cancellation = equippedChanged ? this.owner.prepareCancelCombat(id) : undefined;
    const components = this.owner.entities.actorComponentSnapshot(id);
    const mutation = prepareEntityMutation(this.owner.entities, {
      actors: [
        {
          reference: this.owner.entities.createReference(id)!,
          health: actor.health,
          components: { ...components, inventory: candidate.snapshot() },
        },
      ],
    });
    mutation.validate();
    cancellation?.validate();
    mutation.apply();
    cancellation?.apply();
    this.owner.changed(true);
    return { success: true };
  }
  craft(id: string, recipeId: string): ReturnType<typeof craftRecipe> | { success: false; reason: 'player-dead' } {
    const actor = this.owner.actor(id);
    if (actor.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    const candidate = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    const result = craftRecipe(candidate, recipeId, this.owner.recipes);
    if (!result.success) return result;
    this.owner.assertCanChange();
    const components = this.owner.entities.actorComponentSnapshot(id);
    const mutation = prepareEntityMutation(this.owner.entities, {
      actors: [
        {
          reference: this.owner.entities.createReference(id)!,
          health: actor.health,
          components: { ...components, inventory: candidate.snapshot() },
        },
      ],
    });
    mutation.validate();
    mutation.apply();
    this.owner.changed(true);
    return result;
  }
  drop(id: string, slot: number, count: number) {
    const actor = this.owner.actor(id);
    if (actor.lifecycle !== 'alive') return { success: false as const, reason: 'player-dead' };
    if (!Number.isInteger(slot) || slot < 0 || slot >= actor.inventory.capacity)
      return { success: false as const, reason: 'invalid-slot' };
    if (!Number.isInteger(count) || count <= 0) return { success: false as const, reason: 'invalid-count' };
    const stack = actor.inventory.slot(slot);
    if (!stack || stack.count < count) return { success: false as const, reason: 'missing-items' };
    const candidate = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    candidate.removeFromSlot(slot, count);
    const components = this.owner.entities.actorComponentSnapshot(id);
    this.owner.assertCanChange();
    if (slot === actor.selectedSlot) this.owner.assertCanCancelCombat(id);
    const prepared = prepareEntityMutation(this.owner.entities, {
      actors: [
        {
          reference: this.owner.entities.createReference(id)!,
          health: actor.health,
          components: { ...components, inventory: candidate.snapshot() },
        },
      ],
      spawns: [{ position: this.owner.entities.get(id)!.position, stack: { ...stack, count } }],
    });
    prepared.validate();
    const committed = prepared.apply();
    if (slot === actor.selectedSlot) this.owner.cancelCombat(id, 'slot-changed');
    this.owner.changed(true);
    return { success: true as const, entity: committed.spawned[0] };
  }
  pickup(id: string, entityId: string): Result {
    const actor = this.owner.actor(id);
    if (actor.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    const item = this.owner.entities.get(entityId);
    if (!item || item.type !== 'world-item' || !item.stack) return { success: false, reason: 'invalid-item' };
    const entity = this.owner.entities.get(id)!;
    if (!positionsInRange(entity.position, item.position, 1.5)) return { success: false, reason: 'out-of-range' };
    const visibility = traceVoxelRay(item.position, entity.position, (x, y, z) => this.owner.getVoxel([x, y, z]));
    if (visibility !== 'clear')
      return { success: false, reason: visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked' };
    const candidate = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    if (!candidate.add(item.stack)) return { success: false, reason: 'inventory-full' };
    const components = this.owner.entities.actorComponentSnapshot(id);
    this.owner.assertCanChange();
    const prepared = prepareEntityMutation(this.owner.entities, {
      actors: [
        {
          reference: this.owner.entities.createReference(id)!,
          health: actor.health,
          components: { ...components, inventory: candidate.snapshot() },
        },
      ],
      despawns: [this.owner.entities.createReference(entityId)!],
    });
    prepared.validate();
    prepared.apply();
    this.owner.changed(true);
    return { success: true };
  }
  consume(id: string, slot: number): Result {
    const actor = this.owner.actor(id);
    if (actor.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    if (!Number.isInteger(slot) || slot < 0 || slot >= actor.inventory.capacity)
      return { success: false, reason: 'invalid-slot' };
    const selected = actor.inventory.slot(slot);
    if (!selected) return { success: false, reason: 'no-selected-item' };
    const consume = actor.inventory.items.capability(selected.itemId, 'consume');
    if (!consume) return { success: false, reason: 'item-not-usable' };
    if (actor.hungerMeaning === 'satiety' ? actor.hunger >= actor.maxHunger : actor.hunger <= 0)
      return { success: false, reason: 'hunger-full' };
    const candidate = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    candidate.removeFromSlot(slot, 1);
    const hunger =
      actor.hungerMeaning === 'satiety'
        ? Math.min(actor.maxHunger, actor.hunger + consume.hungerRestore)
        : Math.max(0, actor.hunger - consume.hungerRestore);
    this.owner.assertCanChange();
    const components = this.owner.entities.actorComponentSnapshot(id);
    const mutation = prepareEntityMutation(this.owner.entities, {
      actors: [
        {
          reference: this.owner.entities.createReference(id)!,
          health: actor.health,
          components: {
            ...components,
            inventory: candidate.snapshot(),
            needs: { ...components.needs, hunger },
          },
        },
      ],
    });
    mutation.validate();
    mutation.apply();
    this.owner.changed(true);
    return { success: true };
  }
  listCraftable(id: string) {
    return listCraftableRecipes(this.owner.actor(id).inventory, this.owner.recipes);
  }
}
