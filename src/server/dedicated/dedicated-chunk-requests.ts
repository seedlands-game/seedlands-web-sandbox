import { parseAuthorityChunkKey } from '../authority/authority-baseline-capture';
import type { AuthorityRuntime } from '../authority/authority-runtime';
import type { DedicatedComputeResult } from '../compute/dedicated-compute-contract';
import type { GameServer } from '../game-server';
import { CHUNK_SIZE } from '../../world/voxel';
import { DedicatedCanonicalAdmissionLedger, type CanonicalAdmissionLease } from './dedicated-canonical-admission';
import type { DedicatedHostState } from './dedicated-host-types';

export type DedicatedChunkGeneration = Readonly<{
  key: string;
  cx: number;
  cy: number;
  cz: number;
}>;

export function acceptDedicatedCanonicalResult(
  runtime: AuthorityRuntime,
  request: DedicatedChunkGeneration,
  result: DedicatedComputeResult,
): boolean {
  const { key, cx, cy, cz } = request;
  if (
    result.kind !== 'canonical-result' ||
    result.key !== key ||
    result.cx !== cx ||
    result.cy !== cy ||
    result.cz !== cz ||
    result.voxels.byteLength !== CHUNK_SIZE ** 3 * 2
  )
    throw new Error('Dedicated canonical candidate does not match its request.');
  return runtime.acceptGeneratedChunk({ ...result, canonical: new Uint16Array(result.voxels) });
}

export class DedicatedChunkRequestCoordinator {
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly admissions: DedicatedCanonicalAdmissionLedger;

  constructor(
    private readonly options: Readonly<{
      server: GameServer;
      state(): DedicatedHostState;
      pendingLimit: number;
      generate(request: DedicatedChunkGeneration, finish: (accepted: boolean) => void): void;
      onPreparationFailure(error: unknown): void;
      notifyProgress(): void;
    }>,
  ) {
    this.admissions = new DedicatedCanonicalAdmissionLedger({
      hasLoaded: (key) => options.server.hasLoadedCanonicalChunk(key),
      residentCount: () => options.server.canonicalResidencyDiagnostics.residentCount,
      hardLimit: () => options.server.canonicalResidencyDiagnostics.hardLimit,
      pendingCount: () => this.pending.size,
      pendingLimit: () => options.pendingLimit,
      maintain: () => {
        options.server.maintainCanonicalResidency();
      },
    });
  }

  request(key: string, internal = false): Promise<boolean> {
    let coordinates: readonly [number, number, number];
    try {
      coordinates = parseAuthorityChunkKey(key);
    } catch {
      return Promise.resolve(false);
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (!this.accepting(internal)) return Promise.resolve(false);
    if (this.options.server.hasLoadedCanonicalChunk(key)) return Promise.resolve(true);
    const lease = this.admissions.reserve([key]);
    if (!lease) return Promise.resolve(false);
    const request = this.requestReserved(key, internal, lease, coordinates);
    lease.releaseUnused();
    return request;
  }

  reserve(keys: readonly string[]): CanonicalAdmissionLease | null {
    return this.admissions.reserve(keys);
  }

  requestReserved(
    key: string,
    internal: boolean,
    lease: CanonicalAdmissionLease,
    parsed?: readonly [number, number, number],
  ): Promise<boolean> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (!this.accepting(internal)) return Promise.resolve(false);
    if (this.options.server.hasLoadedCanonicalChunk(key)) return Promise.resolve(true);
    if (!lease.claim(key)) return Promise.resolve(false);
    const [cx, cy, cz] = parsed ?? parseAuthorityChunkKey(key);
    let resolve!: (accepted: boolean) => void;
    const completion = new Promise<boolean>((accept) => {
      resolve = accept;
    });
    this.pending.set(key, completion);
    let finished = false;
    const finish = (accepted: boolean) => {
      if (finished) return;
      finished = true;
      this.pending.delete(key);
      this.admissions.release(key);
      resolve(accepted);
      this.options.notifyProgress();
    };
    void this.options.server
      .prepareCanonicalChunkForMutation(cx, cy, cz)
      .then((available) => {
        if (available) finish(true);
        else this.options.generate({ key, cx, cy, cz }, finish);
      })
      .catch((error: unknown) => {
        this.options.onPreparationFailure(error);
        finish(false);
      });
    return completion;
  }

  diagnostics() {
    return { pendingChunks: this.pending.size, reservedCanonicalAdmissions: this.admissions.reservedCount };
  }

  private accepting(internal: boolean): boolean {
    const state = this.options.state();
    return state === 'running' || (internal && state === 'draining');
  }
}
