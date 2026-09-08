type Position = readonly [number, number, number];
type NearbyCreature = Readonly<{ id: string; position: Position }>;

export class CreatureAmbience {
  private nextAt: number | null = null;

  sample(
    now: number,
    listener: Position,
    creatures: readonly NearbyCreature[],
    paused: boolean,
  ): NearbyCreature | null {
    if (!Number.isFinite(now)) return null;
    if (paused || this.nextAt === null) {
      this.nextAt = now + 6;
      return null;
    }
    if (now < this.nextAt) return null;
    let nearest: NearbyCreature | null = null;
    let distance = 18 ** 2;
    for (const creature of creatures) {
      const nextDistance = creature.position.reduce((sum, value, axis) => sum + (value - listener[axis]) ** 2, 0);
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = creature;
      }
    }
    if (nearest) this.nextAt = now + 12;
    return nearest;
  }
}
