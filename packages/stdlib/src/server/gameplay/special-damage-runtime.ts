export type SpecialDamageCause = 'sunlight' | 'drowning' | 'cactus' | 'fire' | 'fall';

const causes = new Set<SpecialDamageCause>(['sunlight', 'drowning', 'cactus', 'fire', 'fall']);

export class SpecialDamageRuntime {
  constructor(private readonly damage: (sourceId: string, targetId: string, amount: number) => number | null) {}

  apply(targetId: string, cause: SpecialDamageCause, amount: number) {
    if (!targetId.trim() || !causes.has(cause) || !Number.isFinite(amount) || amount <= 0)
      return { success: false as const, reason: 'invalid-special-damage' };
    const applied = this.damage(`environment:${cause}`, targetId, amount);
    return applied === null
      ? { success: false as const, reason: 'target-unavailable' }
      : { success: true as const, damage: applied };
  }

  applyFall(targetId: string, distance: number) {
    if (!Number.isFinite(distance) || distance <= 3) return { success: false as const, reason: 'non-damaging-fall' };
    return this.apply(targetId, 'fall', Math.ceil(distance - 3));
  }
}
