export type PoiKind = 'home' | 'work' | 'food' | 'camp';
export type Poi = {
  id: string;
  kind: PoiKind;
  position: [number, number, number];
  label: string;
};
export type PoiInput = Omit<Poi, 'id'> & { id?: string };
export type PoiSnapshot = { version: 1; sequence: number; pois: Poi[] };

const clone = (poi: Poi): Poi => ({ ...poi, position: [...poi.position] });
const distanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

export class PoiRegistry {
  private readonly pois = new Map<string, Poi>();
  private sequence = 0;

  register(input: PoiInput): Poi {
    this.validate(input);
    const id = input.id ?? `poi-${++this.sequence}`;
    if (!id.trim()) throw new TypeError('POI id must not be empty.');
    if (this.pois.has(id)) throw new Error(`POI already exists: ${id}`);
    const poi: Poi = { ...input, id, position: [...input.position] };
    this.pois.set(id, poi);
    return clone(poi);
  }

  remove(id: string): boolean {
    return this.pois.delete(id);
  }

  get(id: string): Poi | null {
    const poi = this.pois.get(id);
    return poi ? clone(poi) : null;
  }

  query(kind?: PoiKind): Poi[] {
    return [...this.pois.values()].filter((poi) => !kind || poi.kind === kind).map(clone);
  }

  queryNearby(position: readonly [number, number, number], radius: number, kind?: PoiKind): Poi[] {
    if (!position.every(Number.isFinite) || !Number.isFinite(radius) || radius < 0)
      throw new TypeError('POI query position and radius are invalid.');
    return this.query(kind).filter((poi) => distanceSquared(position, poi.position) <= radius * radius);
  }

  snapshot(): PoiSnapshot {
    return { version: 1, sequence: this.sequence, pois: this.query() };
  }

  restore(raw: unknown): void {
    try {
      const snapshot = raw as PoiSnapshot;
      if (
        !snapshot ||
        snapshot.version !== 1 ||
        !Number.isInteger(snapshot.sequence) ||
        snapshot.sequence < 0 ||
        !Array.isArray(snapshot.pois)
      )
        throw new TypeError('header is invalid');
      const restored = new PoiRegistry();
      snapshot.pois.forEach((poi) => restored.register(poi));
      restored.sequence = Math.max(restored.sequence, snapshot.sequence);
      this.pois.clear();
      restored.pois.forEach((poi, id) => this.pois.set(id, clone(poi)));
      this.sequence = restored.sequence;
    } catch (error) {
      throw new Error(`Invalid POI snapshot: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }

  private validate(input: Omit<Poi, 'id'>): void {
    if (!['home', 'work', 'food', 'camp'].includes(input.kind)) throw new TypeError('POI kind is invalid.');
    if (input.position.length !== 3 || !input.position.every(Number.isFinite))
      throw new TypeError('POI position must contain three finite values.');
    if (!input.label.trim()) throw new TypeError('POI label must not be empty.');
  }
}
