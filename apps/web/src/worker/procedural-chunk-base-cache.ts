export type ProceduralChunkIdentity = Readonly<{
  seedText: string;
  generatorVersion: number;
  providerIdentity: string;
  cx: number;
  cy: number;
  cz: number;
}>;

const MAX_ENTRY_COUNT = 64;
const MAX_BYTE_LENGTH = 4 * 1_024 * 1_024;

const identityKey = ({ seedText, generatorVersion, providerIdentity, cx, cy, cz }: ProceduralChunkIdentity) =>
  JSON.stringify([seedText, generatorVersion, providerIdentity, cx, cy, cz]);

export class ProceduralChunkBaseCache {
  private readonly entries = new Map<string, Uint16Array>();
  private bytes = 0;

  constructor(private readonly generate: (identity: ProceduralChunkIdentity) => Uint16Array) {}

  get(identity: ProceduralChunkIdentity): Uint16Array {
    const key = identityKey(identity);
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.slice();
    }
    const generated = this.generate(identity);
    if (generated.byteLength <= MAX_BYTE_LENGTH) {
      while (this.entries.size >= MAX_ENTRY_COUNT || this.bytes + generated.byteLength > MAX_BYTE_LENGTH)
        this.evictLeastRecentlyUsed();
      this.entries.set(key, generated);
      this.bytes += generated.byteLength;
    }
    return generated.slice();
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  get entryCount(): number {
    return this.entries.size;
  }

  get byteLength(): number {
    return this.bytes;
  }

  private evictLeastRecentlyUsed(): void {
    const oldest = this.entries.entries().next().value as [string, Uint16Array] | undefined;
    if (!oldest) return;
    this.entries.delete(oldest[0]);
    this.bytes -= oldest[1].byteLength;
  }
}
