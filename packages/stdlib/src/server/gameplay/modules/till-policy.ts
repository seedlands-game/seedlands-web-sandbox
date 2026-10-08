import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';

export type TillPolicy = Readonly<{
  sourceVoxels: readonly number[];
  targetVoxel: number;
  durabilityCost: number;
}>;

export type TillOutcome = Readonly<{
  toVoxel: number;
  nextStack: Readonly<ItemStack> | null;
}>;

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
  policy: TillPolicy,
  creative = false,
): TillOutcome {
  const selected = items.normalizeStack(selectedStack);
  const till = items.capability(selected.itemId, 'till');
  if (!till) throw new Error('till-requires-hoe');
  if (!policy.sourceVoxels.includes(sourceVoxel)) throw new Error('till-target-not-soil');
  if (!Number.isSafeInteger(policy.durabilityCost) || policy.durabilityCost < 0)
    throw new TypeError('Till durability cost is invalid.');

  let nextStack: Readonly<ItemStack> | null = snapshotStack(selected);
  if (!creative && policy.durabilityCost && items.require(selected.itemId).durability) {
    const durability = selected.instance!.durability;
    nextStack =
      durability <= policy.durabilityCost
        ? null
        : snapshotStack({
            itemId: selected.itemId,
            count: selected.count,
            instance: { durability: durability - policy.durabilityCost },
          });
  }
  return Object.freeze({ toVoxel: policy.targetVoxel, nextStack });
}
