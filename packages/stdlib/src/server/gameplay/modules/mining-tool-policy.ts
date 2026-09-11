import type { ItemDefinitionRegistry, ItemStack, MineItemCapability } from '../item-registry';

export type MiningToolRequirement = Readonly<{
  preferredTool: MineItemCapability['tool'] | null;
  minimumTier: number;
}>;

export type MiningToolUseCandidate = Readonly<{
  multiplier: number;
  nextStack: Readonly<ItemStack> | null;
}>;

function validateRequirement(requirement: MiningToolRequirement): void {
  if (
    (requirement.preferredTool !== null &&
      requirement.preferredTool !== 'axe' &&
      requirement.preferredTool !== 'pickaxe') ||
    !Number.isSafeInteger(requirement.minimumTier) ||
    requirement.minimumTier < 0 ||
    (requirement.minimumTier > 0 && requirement.preferredTool === null)
  )
    throw new TypeError('Mining tool requirement is invalid.');
}

function snapshotStack(stack: Readonly<ItemStack>): Readonly<ItemStack> {
  return Object.freeze({
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.instance ? { instance: Object.freeze({ durability: stack.instance.durability }) } : {}),
  });
}

/** Pure detached result. The owner decides whether and when to commit the candidate. */
export function createMiningToolUseCandidate(
  items: ItemDefinitionRegistry,
  selectedStackOrNull: Readonly<ItemStack> | null,
  requirement: MiningToolRequirement,
): MiningToolUseCandidate {
  validateRequirement(requirement);
  const selected = selectedStackOrNull === null ? null : items.normalizeStack(selectedStackOrNull);
  const mine = selected ? items.capability(selected.itemId, 'mine') : undefined;
  if (
    requirement.minimumTier > 0 &&
    (!mine || mine.tool !== requirement.preferredTool || (mine.tier ?? 0) < requirement.minimumTier)
  )
    throw new Error('mining-tool-requirement-not-met');

  const multiplier = mine?.tool === requirement.preferredTool ? mine.multiplier : 1;
  let nextStack = selected === null ? null : snapshotStack(selected);
  if (selected && mine && items.require(selected.itemId).durability) {
    const durability = selected.instance!.durability;
    nextStack =
      durability === 1
        ? null
        : snapshotStack({
            itemId: selected.itemId,
            count: selected.count,
            instance: { durability: durability - 1 },
          });
  }
  return Object.freeze({ multiplier, nextStack });
}
