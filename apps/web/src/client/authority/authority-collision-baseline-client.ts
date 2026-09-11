import { CHUNK_SIZE, Voxel, chunkKey, floorDiv, mod, voxelIndex } from '@seedlands/stdlib/world/voxel';
import {
  cacheAuthorityCollisionBaseline,
  type AuthorityCollisionCachedChunk,
  type AuthorityCollisionRevisionGuard,
} from './authority-collision-mirror';

export type AuthorityCollisionBaselinePayload =
  | Readonly<{
      status: 'available';
      key: string;
      chunkRevision: number;
      canonical: ArrayBuffer;
      fluid: ArrayBuffer;
    }>
  | Readonly<{ status: 'unavailable'; key: string }>;

type AuthorityCollisionBaselineRequest = Readonly<{
  kind: 'request-collision-baseline';
  key: string;
  minimumRevision: number;
}>;

type AuthorityCollisionBaselineClientOptions = Readonly<{
  /** Only BrowserAuthorityClient may opt into this after a Worker transfer. */
  consumeTransferredBuffers?: boolean;
}>;

export class AuthorityCollisionBaselineClient {
  constructor(
    private readonly chunks: Map<string, AuthorityCollisionCachedChunk>,
    private readonly guard: AuthorityCollisionRevisionGuard,
    private readonly request: (
      request: AuthorityCollisionBaselineRequest,
    ) => Promise<AuthorityCollisionBaselinePayload>,
    private readonly options: AuthorityCollisionBaselineClientOptions = {},
  ) {}

  getVoxel(x: number, y: number, z: number): number {
    const cached = this.readableChunk(
      chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)),
    );
    return cached?.canonical[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))] ?? Voxel.Air;
  }

  getFluidCell(x: number, y: number, z: number): { level: number; source: boolean } | null {
    const cached = this.readableChunk(
      chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)),
    );
    if (!cached) return null;
    const value = cached.fluid[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
    const level = value & 0x0f;
    return level ? { level, source: (value & 0x80) !== 0 } : null;
  }

  getChunkRevision(cx: number, cy: number, cz: number): number | null {
    return this.readableChunk(chunkKey(cx, cy, cz))?.chunkRevision ?? null;
  }

  synchronize(revisions: Readonly<Record<string, number>>): void {
    for (const [key, minimumRevision] of Object.entries(revisions)) {
      const cached = this.chunks.get(key);
      if (cached && cached.chunkRevision >= minimumRevision) {
        this.guard.satisfy(key, cached.chunkRevision);
        continue;
      }
      if (!this.guard.require(key, minimumRevision)) continue;
      void this.refresh(key, minimumRevision).catch(() => undefined);
    }
  }

  async refresh(key: string, minimumRevision: number): Promise<boolean> {
    const lease = this.guard.beginBaseline(key);
    try {
      const payload = await this.request({ kind: 'request-collision-baseline', key, minimumRevision });
      if (
        payload.status !== 'available' ||
        payload.key !== key ||
        payload.chunkRevision < minimumRevision ||
        payload.canonical.byteLength !== CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT ||
        payload.fluid.byteLength !== CHUNK_SIZE ** 3
      )
        return false;
      return cacheAuthorityCollisionBaseline(
        this.chunks,
        key,
        {
          // Public request callbacks retain the old copy contract. The browser
          // Worker path opts in only after transfer establishes exclusivity.
          canonical: this.options.consumeTransferredBuffers
            ? new Uint16Array(payload.canonical)
            : new Uint16Array(payload.canonical).slice(),
          fluid: this.options.consumeTransferredBuffers
            ? new Uint8Array(payload.fluid)
            : new Uint8Array(payload.fluid).slice(),
          chunkRevision: payload.chunkRevision,
        },
        this.guard,
        lease,
      );
    } finally {
      this.guard.finishBaseline(lease);
    }
  }

  private readableChunk(key: string): AuthorityCollisionCachedChunk | null {
    const cached = this.chunks.get(key);
    return cached && this.guard.isReadable(key, cached.chunkRevision) ? cached : null;
  }
}
