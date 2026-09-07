import type { NetworkBaselineOwnerRef } from './network-baseline-consumer-types';
import {
  canonicalEqualsLittleEndian,
  decodeCanonicalLittleEndian,
  fluidEquals,
  type ValidatedBaselineEntry,
} from './network-baseline-consumer-validation';

const PREPARATION_ENTRY_BYTES = 32 ** 3 * 3;

export type SharedPreparationEntry = {
  identity: string;
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  canonical: Uint16Array;
  fluid: Uint8Array;
  owners: number;
};

export type OwnerPreparation = {
  entries: SharedPreparationEntry[];
  haloRevision: string;
};

const identity = (entry: ValidatedBaselineEntry) =>
  JSON.stringify([entry.descriptor.key, entry.descriptor.chunkRevision, entry.descriptor.generatorVersion]);

export function preparationHaloIdentity(
  owner: NetworkBaselineOwnerRef,
  entries: readonly SharedPreparationEntry[],
): string {
  return JSON.stringify([
    'network-authority-complete-v1',
    owner.ref.epoch,
    owner.ref.serverEpoch,
    owner.ref.sessionId,
    owner.ref.worldId,
    owner.ownerId,
    owner.ownerGeneration,
    owner.key,
    entries.map(({ key, chunkRevision, generatorVersion }) => [key, chunkRevision, generatorVersion]),
  ]);
}

export class NetworkBaselineSharedPreparationStore {
  private readonly entries = new Map<string, SharedPreparationEntry>();
  private reservedBytes = 0;

  constructor(private readonly limitBytes: number) {}

  preflight(entries: readonly ValidatedBaselineEntry[]): 'conflicting-content' | 'resource-limit' | null {
    for (const entry of entries) {
      const current = this.entries.get(identity(entry));
      if (
        current &&
        (!canonicalEqualsLittleEndian(current.canonical, entry.canonicalLittleEndian) ||
          !fluidEquals(current.fluid, entry.fluid))
      )
        return 'conflicting-content';
    }
    return this.reservedBytes + this.requiredBytes(entries) > this.limitBytes ? 'resource-limit' : null;
  }

  acquire(entries: readonly ValidatedBaselineEntry[]): SharedPreparationEntry[] {
    const requiredBytes = this.requiredBytes(entries);
    this.reservedBytes += requiredBytes;
    const created: SharedPreparationEntry[] = [];
    try {
      for (const entry of entries) {
        const entryIdentity = identity(entry);
        if (this.entries.has(entryIdentity)) continue;
        created.push({
          identity: entryIdentity,
          key: entry.descriptor.key,
          chunkRevision: entry.descriptor.chunkRevision,
          generatorVersion: entry.descriptor.generatorVersion,
          canonical: decodeCanonicalLittleEndian(entry.canonicalLittleEndian),
          fluid: entry.fluid.slice(),
          owners: 0,
        });
      }
    } catch (error) {
      this.reservedBytes -= requiredBytes;
      throw error;
    }
    created.forEach((entry) => this.entries.set(entry.identity, entry));
    const acquired = entries.map((entry) => this.entries.get(identity(entry))!);
    acquired.forEach((entry) => (entry.owners += 1));
    return acquired;
  }

  release(entries: readonly SharedPreparationEntry[]): void {
    for (const entry of entries) {
      entry.owners -= 1;
      if (entry.owners !== 0) continue;
      this.entries.delete(entry.identity);
      this.reservedBytes -= PREPARATION_ENTRY_BYTES;
    }
  }

  diagnostics(): Readonly<{ bytes: number; entries: number }> {
    return { bytes: this.reservedBytes, entries: this.entries.size };
  }

  private requiredBytes(entries: readonly ValidatedBaselineEntry[]): number {
    return entries.reduce(
      (bytes, entry) => bytes + (this.entries.has(identity(entry)) ? 0 : PREPARATION_ENTRY_BYTES),
      0,
    );
  }
}
