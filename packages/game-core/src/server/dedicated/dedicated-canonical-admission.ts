export type CanonicalAdmissionLease = Readonly<{
  claim(key: string): boolean;
  releaseUnused(): void;
}>;

export class DedicatedCanonicalAdmissionLedger {
  private readonly reserved = new Set<string>();

  constructor(
    private readonly source: Readonly<{
      hasLoaded(key: string): boolean;
      residentCount(): number;
      hardLimit(): number;
      pendingCount(): number;
      pendingLimit(): number;
      maintain(): void;
    }>,
  ) {}

  reserve(keys: readonly string[]): CanonicalAdmissionLease | null {
    const unique = [...new Set(keys)];
    if (unique.length !== keys.length) throw new TypeError('Canonical admission keys must be unique.');
    this.source.maintain();
    const additions = unique.filter((key) => !this.source.hasLoaded(key) && !this.reserved.has(key));
    if (
      this.source.residentCount() + this.reserved.size + additions.length > this.source.hardLimit() ||
      this.source.pendingCount() + additions.length > this.source.pendingLimit()
    )
      return null;
    additions.forEach((key) => this.reserved.add(key));
    const unclaimed = new Set(additions);
    return {
      claim: (key) => unclaimed.delete(key),
      releaseUnused: () => {
        for (const key of unclaimed) this.reserved.delete(key);
        unclaimed.clear();
      },
    };
  }

  release(key: string): void {
    this.reserved.delete(key);
  }

  get reservedCount(): number {
    return this.reserved.size;
  }
}
