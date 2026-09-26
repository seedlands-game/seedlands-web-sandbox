import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import { Voxel } from '../../../world/voxel';

export type TillOutcome = Readonly<{
  toVoxel: number;
  nextStack: Readonly<ItemStack> | null;
}>;

const TILLABLE = new Set<number>([Voxel.Grass, Voxel.Dirt]);

function snapshotStack(stack: Readonly<ItemStack>): Readonly<ItemStack> {
  return Object.freeze({
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.instance ? { instance: Object.freeze({ durability: stack.instance.durability }) } : {}),
  });
}

/** Pure detached result. The block owner decides whether and when to commit the till edit. */
export function tillOutcome(
  items: ItemDefinitionRegistry,
  sourceVoxel: number,
  selectedStack: Readonly<ItemStack>,
): TillOutcome {
  const selected = items.normalizeStack(selectedStack);
  const till = items.capability(selected.itemId, 'till');
  if (!till) throw new Error('till-requires-hoe');
  if (!TILLABLE.has(sourceVoxel)) throw new Error('till-target-not-soil');

  let nextStack: Readonly<ItemStack> | null = snapshotStack(selected);
  if (items.require(selected.itemId).durability) {
    const durability = selected.instance!.durability;
    nextStack =
      durability === 1
        ? null
        : snapshotStack({ itemId: selected.itemId, count: selected.count, instance: { durability: durability - 1 } });
  }
  return Object.freeze({ toVoxel: Voxel.Farmland, nextStack });
}
