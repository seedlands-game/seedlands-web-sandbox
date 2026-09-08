import { AuthoritySnapshotGate } from '../../../../apps/web/src/client/authority/authority-snapshot-gate';
import {
  AuthorityCollisionRevisionGuard,
  cacheAuthorityCollisionBaseline,
  publishAuthorityCollisionCommits,
  type AuthorityCollisionCachedChunk,
} from '../../../../apps/web/src/client/authority/authority-collision-mirror';
import {
  LocalPlayerPrediction,
  type LocalPredictionAdvance,
  type PredictionAuthorityState,
} from '../../../../apps/web/src/client/local-player-prediction';
import { VoxelCollisionWorld } from '../../../../packages/game-core/src/server/authority/voxel-collision-world';
import type {
  ChunkBaselineReference,
  ReferenceBinaryBlock,
} from '../../../../packages/game-core/src/server/protocol/network-reference-bootstrap';
import type {
  PlayerCorrectionReference,
  WorldCommitReference,
} from '../../../../packages/game-core/src/server/protocol/network-reference-projection';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../../../../packages/game-core/src/world/voxel';

type ReceiverBlock<Kind extends string> = Omit<ReferenceBinaryBlock, 'elementType'> & { elementType: Kind };
export type ReceiverBaseline = Omit<ChunkBaselineReference, 'canonical' | 'fluid'> & {
  canonical: ReceiverBlock<'uint16-le'>;
  fluid: ReceiverBlock<'uint8'>;
};

/** Change-local application oracle for already decoded/validated reference DTOs; not a public parser. */
export class NetworkReferenceReceiver {
  readonly chunks = new Map<string, AuthorityCollisionCachedChunk>();
  readonly requestedBaselines = new Set<string>();
  readonly prediction: LocalPlayerPrediction;
  readonly world: VoxelCollisionWorld;
  private readonly guard = new AuthorityCollisionRevisionGuard();
  private readonly gate: AuthoritySnapshotGate;
  private latest: PredictionAuthorityState | null = null;

  constructor(
    private readonly options: Readonly<{
      epoch: string;
      worldId: string;
      generatorVersion: number;
      physicsHz: 30 | 60 | 120;
      digest: (bytes: Uint8Array) => Promise<string>;
    }>,
  ) {
    this.gate = new AuthoritySnapshotGate(options.epoch);
    this.prediction = new LocalPlayerPrediction(options.epoch, options.physicsHz);
    this.world = new VoxelCollisionWorld(
      {
        getChunkRevision: (key) => this.readableChunk(key)?.chunkRevision ?? null,
        getLoadedVoxel: (x, y, z) => {
          const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
          const chunk = this.readableChunk(key);
          if (!chunk) return null;
          const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
          return {
            voxel: chunk.canonical[index],
            chunkKey: key,
            revision: chunk.chunkRevision,
            fluid: { level: chunk.fluid[index] & 0x0f },
          };
        },
      },
      (key) => this.requestedBaselines.add(key),
    );
  }

  async baseline(incoming: ReceiverBaseline): Promise<boolean> {
    // Freeze both metadata and bytes before async hashing can yield to another publication.
    const value = structuredClone(incoming);
    if (
      value.epoch !== this.options.epoch ||
      value.worldId !== this.options.worldId ||
      value.generatorVersion !== this.options.generatorVersion ||
      value.projectionVersion !== 1 ||
      !Number.isSafeInteger(value.chunkRevision) ||
      value.chunkRevision < 0
    )
      return false;
    const count = CHUNK_SIZE ** 3;
    if (
      value.canonical.elementType !== 'uint16-le' ||
      value.fluid.elementType !== 'uint8' ||
      value.canonical.elementCount !== count ||
      value.fluid.elementCount !== count ||
      value.canonical.byteLength !== count * 2 ||
      value.canonical.bytes.byteLength !== count * 2 ||
      value.fluid.byteLength !== count ||
      value.fluid.bytes.byteLength !== count
    )
      return false;
    const lease = this.guard.beginBaseline(value.key);
    try {
      const hashes = await Promise.all([
        this.options.digest(new Uint8Array(value.canonical.bytes)),
        this.options.digest(new Uint8Array(value.fluid.bytes)),
      ]);
      if (hashes[0] !== value.canonical.sha256 || hashes[1] !== value.fluid.sha256) return false;
      const canonical = new Uint16Array(count);
      const view = new DataView(value.canonical.bytes);
      for (let index = 0; index < count; index++) canonical[index] = view.getUint16(index * 2, true);
      const accepted = cacheAuthorityCollisionBaseline(
        this.chunks,
        value.key,
        {
          canonical,
          fluid: new Uint8Array(value.fluid.bytes).slice(),
          chunkRevision: value.chunkRevision,
        },
        this.guard,
        lease,
      );
      if (accepted) this.requestedBaselines.delete(value.key);
      return accepted;
    } finally {
      this.guard.finishBaseline(lease);
    }
  }

  commit(value: WorldCommitReference): boolean {
    if (value.epoch !== this.options.epoch) return false;
    publishAuthorityCollisionCommits(
      [{ ...value, collisionDelta: value.collisionDeltas }],
      this.chunks,
      {
        onUnknownChunk: (key) => this.requestedBaselines.add(key),
      },
      this.guard,
    );
    return true;
  }

  correction(incoming: PlayerCorrectionReference) {
    const value = structuredClone(incoming);
    const reason = this.gate.accept(value);
    if (reason) return { accepted: false as const, reason };
    for (const { key, revision } of value.collisionRevisions) {
      this.guard.require(key, revision);
      const cached = this.chunks.get(key);
      if (cached && cached.chunkRevision >= revision) this.guard.satisfy(key, cached.chunkRevision);
      else {
        this.chunks.delete(key);
        this.requestedBaselines.add(key);
      }
    }
    const state: PredictionAuthorityState = {
      physicsTick: value.physicsTick,
      acknowledgedInputSequence: value.acknowledgedInputSequence,
      inputResyncRequired: value.inputResyncRequired,
      player: {
        body: { position: value.player.position, velocity: value.player.velocity },
        grounded: value.player.grounded,
      },
      chunkRevisions: Object.fromEntries(value.collisionRevisions.map(({ key, revision }) => [key, revision])),
    };
    // Discard query-local revision observations before checking current residency.
    this.world.beginStep();
    const reconciliation = this.prediction.applyAuthoritySnapshot(state, this.world);
    this.latest = state;
    return { accepted: true as const, reconciliation };
  }

  advance(request: Omit<LocalPredictionAdvance, 'snapshot' | 'world'>) {
    if (!this.latest) throw new Error('Correction required before prediction');
    this.world.beginStep();
    return this.prediction.advance({ ...request, snapshot: this.latest, world: this.world });
  }

  private readableChunk(key: string) {
    const chunk = this.chunks.get(key);
    return chunk && this.guard.isReadable(key, chunk.chunkRevision) ? chunk : undefined;
  }
}
