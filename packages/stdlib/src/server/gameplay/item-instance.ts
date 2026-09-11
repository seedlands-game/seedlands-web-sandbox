import type { ItemDefinitionRegistry, ItemStack } from './item-registry';

export type ItemDurabilityDefinition = Readonly<{ max: number }>;
export type ItemInstanceState = Readonly<{ durability: number }>;
export type ItemStackNormalizationOptions = Readonly<{
  migrateLegacyDurability?: 'initialize-at-max';
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
};

const cloneInstance = (instance: ItemInstanceState): ItemInstanceState =>
  Object.freeze({ durability: instance.durability });

export function cloneItemStack(stack: Readonly<ItemStack>): ItemStack {
  return {
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.instance ? { instance: cloneInstance(stack.instance) } : {}),
  };
}

export function sameItemStackIdentity(left: Readonly<ItemStack>, right: Readonly<ItemStack>): boolean {
  if (left.itemId !== right.itemId) return false;
  if (!left.instance || !right.instance) return left.instance === right.instance;
  return left.instance.durability === right.instance.durability;
}

export function normalizeItemStack(
  items: ItemDefinitionRegistry,
  value: unknown,
  options: ItemStackNormalizationOptions = {},
): ItemStack {
  if (!isRecord(value) || !hasOnlyKeys(value, ['itemId', 'count', 'instance']))
    throw new TypeError('Item stack shape is invalid.');
  if (typeof value.itemId !== 'string') throw new TypeError('Item stack identity is invalid.');
  const definition = items.require(value.itemId);
  if (!Number.isSafeInteger(value.count) || (value.count as number) <= 0)
    throw new TypeError('Item stack count must be a positive safe integer.');

  const count = value.count as number;
  if (!definition.durability) {
    if (value.instance !== undefined) throw new TypeError(`Item ${definition.id} does not accept instance state.`);
    return { itemId: definition.id, count };
  }
  if (count !== 1) throw new TypeError(`Durable item stack count must be one: ${definition.id}`);

  if (value.instance === undefined) {
    if (options.migrateLegacyDurability !== 'initialize-at-max')
      throw new TypeError(`Item ${definition.id} requires durability instance state.`);
    return {
      itemId: definition.id,
      count,
      instance: cloneInstance({ durability: definition.durability.max }),
    };
  }
  if (!isRecord(value.instance) || !hasOnlyKeys(value.instance, ['durability']))
    throw new TypeError(`Item durability instance state is invalid: ${definition.id}`);
  if (
    !Number.isSafeInteger(value.instance.durability) ||
    (value.instance.durability as number) <= 0 ||
    (value.instance.durability as number) > definition.durability.max
  )
    throw new TypeError(`Item durability is invalid: ${definition.id}`);
  return {
    itemId: definition.id,
    count,
    instance: cloneInstance({ durability: value.instance.durability as number }),
  };
}
