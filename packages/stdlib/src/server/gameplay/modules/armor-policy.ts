export const ARMOR_MAX_POINTS = 20;
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

export const isArmorSlot = (value: unknown): value is ArmorSlot =>
  typeof value === 'string' && (ARMOR_SLOTS as readonly string[]).includes(value);

/**
 * Minecraft-style flat armor reduction: each point removes 4% of incoming damage,
 * capped at ARMOR_MAX_POINTS. Pure and detached; the vitals owner commits the result.
 */
export function armorDamageReduction(incoming: number, armorPoints: number): number {
  if (!Number.isFinite(incoming) || incoming < 0) throw new RangeError('armor-incoming-invalid');
  if (!Number.isFinite(armorPoints) || armorPoints < 0) throw new RangeError('armor-points-invalid');
  const points = Math.min(ARMOR_MAX_POINTS, armorPoints);
  const reduced = incoming * (1 - (points * 4) / 100);
  return Math.round(Math.max(0, reduced) * 1_000_000) / 1_000_000;
}
