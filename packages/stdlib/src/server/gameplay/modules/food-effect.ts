import type { ConsumeItemCapability } from '../item-registry';

export type FoodVitals = Readonly<{ health: number; maxHealth: number }>;
export type FoodNeeds = Readonly<{ hunger: number; maxHunger: number; meaning: 'satiety' | 'deficit' }>;

/** Computes one food effect; inventory and vitals are committed together by the actor owner. */
export function foodEffect(food: ConsumeItemCapability, needs: FoodNeeds, vitals?: FoodVitals) {
  if (food.healthRestore !== undefined && !vitals) throw new Error('health-unavailable');
  const health = vitals ? Math.min(vitals.maxHealth, vitals.health + (food.healthRestore ?? 0)) : undefined;
  const hunger =
    needs.meaning === 'satiety'
      ? Math.min(needs.maxHunger, needs.hunger + (food.hungerRestore ?? 0))
      : Math.max(0, needs.hunger - (food.hungerRestore ?? 0));
  if (hunger === needs.hunger && (health === undefined || health === vitals?.health))
    throw new Error(food.healthRestore !== undefined ? 'health-full' : 'hunger-full');
  return { hunger, ...(health === undefined ? {} : { health }) };
}
