import type { InventoryAccess, InventorySlot } from './inventory';
import type { ItemDefinitionRegistry } from './item-registry';
import type { ProjectileRuntime, ProjectileState, ProjectileVector } from './projectile-runtime';

export type RangedActionResult =
  Readonly<{ success: true; projectile: ProjectileState }> | Readonly<{ success: false; reason: string }>;

const removeOne = (slots: InventorySlot[], itemId: string) => {
  const index = slots.findIndex((slot) => slot?.itemId === itemId);
  if (index < 0) return false;
  const stack = slots[index]!;
  slots[index] = stack.count === 1 ? null : { ...stack, count: stack.count - 1 };
  return true;
};

export function fireSelectedRangedItem(
  input: Readonly<{
    ownerId: string;
    selectedSlot: number;
    position: ProjectileVector;
    direction: ProjectileVector;
    inventory: InventoryAccess;
    items: ItemDefinitionRegistry;
    projectiles: ProjectileRuntime;
  }>,
): RangedActionResult {
  const selected = input.inventory.slot(input.selectedSlot);
  if (!selected) return { success: false, reason: 'empty-slot' };
  const capability = input.items.capability(selected.itemId, 'ranged');
  if (!capability) return { success: false, reason: 'not-ranged-item' };
  if (!input.inventory.containsAmount(capability.ammunitionItemId, 1))
    return { success: false, reason: 'missing-ammunition' };
  const candidate = input.inventory.snapshot();
  if (!removeOne(candidate, capability.ammunitionItemId)) return { success: false, reason: 'missing-ammunition' };
  const held = candidate[input.selectedSlot];
  if (!held || held.itemId !== selected.itemId || !held.instance)
    return { success: false, reason: 'invalid-ranged-item' };
  candidate[input.selectedSlot] =
    held.instance.durability === 1
      ? null
      : { ...held, instance: { ...held.instance, durability: held.instance.durability - 1 } };
  let projectile: ProjectileState;
  try {
    projectile = input.projectiles.fire({
      ownerId: input.ownerId,
      position: input.position,
      direction: input.direction,
      damage: capability.damage,
      speed: capability.speed,
      lifetimeSeconds: capability.lifetimeSeconds,
    });
  } catch {
    return { success: false, reason: 'invalid-launch' };
  }
  input.inventory.replace(candidate);
  return { success: true, projectile };
}
