export type BrowserPersistenceLoadToken = Readonly<{ identity: symbol; generation: number }>;

export type BrowserPersistenceNeighborhoodLease = Readonly<{
  centerKey: string;
  identity: symbol;
  keys: readonly string[];
}>;

export class BrowserPersistenceLoadRegistry {
  private generation = 0;
  private readonly currentLoads = new Map<string, BrowserPersistenceLoadToken>();
  private readonly exactClaims = new Set<string>();
  private readonly neighborhoods = new Map<string, BrowserPersistenceNeighborhoodLease>();
  private readonly neighborhoodCounts = new Map<string, number>();

  claimExact(key: string): void {
    this.exactClaims.add(key);
  }

  consumeExact(key: string): void {
    this.exactClaims.delete(key);
  }

  failExact(key: string): void {
    this.exactClaims.delete(key);
  }

  beginNeighborhood(centerKey: string, keys: readonly string[]): BrowserPersistenceNeighborhoodLease {
    const existing = this.neighborhoods.get(centerKey);
    if (existing) return existing;
    const lease = { centerKey, identity: Symbol(centerKey), keys: [...keys] };
    this.neighborhoods.set(centerKey, lease);
    keys.forEach((key) => this.neighborhoodCounts.set(key, (this.neighborhoodCounts.get(key) ?? 0) + 1));
    return lease;
  }

  isNeighborhoodCurrent(lease: BrowserPersistenceNeighborhoodLease): boolean {
    return this.neighborhoods.get(lease.centerKey) === lease;
  }

  releaseNeighborhood(centerKey: string, expected?: BrowserPersistenceNeighborhoodLease): readonly string[] {
    const lease = this.neighborhoods.get(centerKey);
    if (!lease || (expected && lease !== expected)) return [];
    this.neighborhoods.delete(centerKey);
    const unowned: string[] = [];
    lease.keys.forEach((key) => {
      const count = (this.neighborhoodCounts.get(key) ?? 1) - 1;
      if (count > 0) this.neighborhoodCounts.set(key, count);
      else {
        this.neighborhoodCounts.delete(key);
        if (!this.exactClaims.has(key)) {
          this.currentLoads.delete(key);
          unowned.push(key);
        }
      }
    });
    return unowned;
  }

  beginLoad(key: string): BrowserPersistenceLoadToken {
    const token = { identity: Symbol(key), generation: ++this.generation };
    this.currentLoads.set(key, token);
    return token;
  }

  isCurrentLoad(key: string, token: BrowserPersistenceLoadToken): boolean {
    return this.currentLoads.get(key) === token;
  }

  shouldPublish(key: string, token: BrowserPersistenceLoadToken): boolean {
    return this.isCurrentLoad(key, token) && this.hasConsumer(key);
  }

  finishLoad(key: string, token: BrowserPersistenceLoadToken): void {
    if (this.currentLoads.get(key) === token) this.currentLoads.delete(key);
  }

  captureSaveFence(): number {
    return this.generation;
  }

  applySaveFence(keys: readonly string[], fence: number): readonly string[] {
    const invalidated: string[] = [];
    keys.forEach((key) => {
      const token = this.currentLoads.get(key);
      if (token && token.generation <= fence) {
        this.currentLoads.delete(key);
        invalidated.push(key);
      }
    });
    return invalidated;
  }

  dispose(): void {
    this.currentLoads.clear();
    this.exactClaims.clear();
    this.neighborhoods.clear();
    this.neighborhoodCounts.clear();
  }

  private hasConsumer(key: string): boolean {
    return this.exactClaims.has(key) || (this.neighborhoodCounts.get(key) ?? 0) > 0;
  }
}
