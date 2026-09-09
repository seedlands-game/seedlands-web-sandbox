import type { ActorComponentAccess } from '../ecs-actor-components';
import type { ItemStack } from '../item-registry';
import { craftRecipe, listCraftableRecipes, type RecipeRegistry } from '../recipe-registry';

type Result = { success: true } | { success: false; reason: string };
type Owner = Readonly<{
  actor(id: string): ActorComponentAccess;
  changed(inventoryOperation: boolean): void;
  cancelCombat(id: string, reason: string): void;
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
    if (!this.owner.actor(id).inventory.add(stack)) return { success: false as const, reason: 'inventory-full' };
    this.owner.changed(true);
    return { success: true as const, inventory: this.snapshot(id) };
  }
  remove(id: string, stack: ItemStack): Result {
    if (!this.owner.actor(id).inventory.remove(stack)) return { success: false, reason: 'missing-items' };
    this.owner.changed(true);
    return { success: true };
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
    if (!actor.inventory.moveStack(source, target)) return { success: false, reason: 'cannot-move-item' };
    if (source === actor.selectedSlot || target === actor.selectedSlot) this.owner.cancelCombat(id, 'slot-changed');
    this.owner.changed(true);
    return { success: true };
  }
  craft(id: string, recipeId: string): ReturnType<typeof craftRecipe> | { success: false; reason: 'player-dead' } {
    const actor = this.owner.actor(id);
    if (actor.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    const result = craftRecipe(actor.inventory, recipeId, this.owner.recipes);
    if (result.success) this.owner.changed(true);
    return result;
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
    actor.inventory.removeFromSlot(slot, 1);
    actor.hunger =
      actor.hungerMeaning === 'satiety'
        ? Math.min(actor.maxHunger, actor.hunger + consume.hungerRestore)
        : Math.max(0, actor.hunger - consume.hungerRestore);
    this.owner.changed(true);
    return { success: true };
  }
  listCraftable(id: string) {
    return listCraftableRecipes(this.owner.actor(id).inventory, this.owner.recipes);
  }
}
