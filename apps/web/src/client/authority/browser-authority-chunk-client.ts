import { PROTOCOL_VERSION, type SessionEpoch } from '@seedlands/game-core/runtime/session-protocol';
import type { AuthorityMeshPayload, AuthorityRequest } from '@seedlands/game-core/compute/authority-worker-protocol';
import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import type { WorldCommitResult } from '@seedlands/game-core/server/game-server-types';
import { chunkKey } from '@seedlands/game-core/world/voxel';
import type { ClientRequestRegistry } from '../client-request-registry';
import { acceptAuthorityMeshPreparation } from './authority-mesh-preparation';
import { AuthorityCollisionBaselineClient } from './authority-collision-baseline-client';
import type { AuthorityCollisionBaselinePayload } from './authority-collision-baseline-client';
import {
  AuthorityCollisionRevisionGuard,
  consumeTransferredAuthorityCollisionBaseline,
  publishAuthorityCollisionCommits,
} from './authority-collision-mirror';
import { matchesPreparedVisibilityCanonical, type VisibilityTask } from './authority-prepared-mesh-visibility';
import type {
  AuthorityCachedMesh,
  AuthorityCachedPreparation,
  AuthorityClientOptions,
} from './browser-authority-client-contract';

type Request = (payload: Record<string, unknown>, transfer?: Transferable[]) => Promise<unknown>;
type Post = (message: AuthorityRequest, transfer?: Transferable[]) => void;

export class BrowserAuthorityChunkClient {
  private readonly loads = new Map<string, Promise<void>>();
  private readonly meshes = new Map<string, AuthorityCachedMesh>();
  private readonly revisions = new AuthorityCollisionRevisionGuard();
  private readonly baselines: AuthorityCollisionBaselineClient;
  private readonly preparations = new Map<string, AuthorityCachedPreparation>();

  constructor(
    private readonly epoch: SessionEpoch,
    private readonly requests: ClientRequestRegistry,
    private readonly request: Request,
    private readonly post: Post,
    private readonly options: AuthorityClientOptions,
  ) {
    this.baselines = new AuthorityCollisionBaselineClient(
      this.meshes,
      this.revisions,
      (payload) => this.request(payload) as Promise<AuthorityCollisionBaselinePayload>,
      { consumeTransferredBuffers: true },
    );
  }

  ensure(cx: number, cy: number, cz: number, requestId: number): Promise<void> {
    const key = chunkKey(cx, cy, cz);
    const existing = this.loads.get(key);
    if (existing) return existing;
    const lease = this.revisions.beginBaseline(key);
    const loading = this.requests
      .create(requestId)
      .then((value) => {
        const prepared = acceptAuthorityMeshPreparation(
          value as AuthorityMeshPayload,
          key,
          this.meshes,
          this.revisions,
          lease,
        );
        if (prepared) this.preparations.set(key, prepared);
      })
      .finally(() => {
        this.revisions.finishBaseline(lease);
        if (this.loads.get(key) === loading) this.loads.delete(key);
      });
    this.loads.set(key, loading);
    try {
      this.post({ kind: 'prepare-mesh', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, requestId, cx, cy, cz });
    } catch (error) {
      this.requests.reject(requestId, error instanceof Error ? error : new Error(String(error)));
    }
    return loading;
  }

  release(cx: number, cy: number, cz: number): void {
    const key = chunkKey(cx, cy, cz);
    this.loads.delete(key);
    this.meshes.delete(key);
    this.revisions.release(key);
    this.releasePreparation(cx, cy, cz);
  }

  releasePreparation(cx: number, cy: number, cz: number): void {
    this.preparations.delete(chunkKey(cx, cy, cz));
    this.post({ kind: 'release-mesh', protocolVersion: PROTOCOL_VERSION, epoch: this.epoch, cx, cy, cz });
  }

  prepareWorkerInput(cx: number, cy: number, cz: number) {
    const cached = this.preparations.get(chunkKey(cx, cy, cz));
    if (!cached) throw new Error(`Authority worker input is not prepared for ${cx},${cy},${cz}.`);
    return {
      chunkRevision: cached.payload.chunkRevision,
      generatorVersion: cached.payload.generatorVersion,
      ...(cached.payload.preparationDiagnostics
        ? { preparationDiagnostics: cached.payload.preparationDiagnostics }
        : {}),
      ...(cached.canonical ? { canonical: cached.canonical.slice() } : {}),
      ...(cached.fluid ? { fluid: cached.fluid.slice() } : {}),
      overlays: cached.overlays.map((overlay) => ({
        cx: overlay.cx,
        cy: overlay.cy,
        cz: overlay.cz,
        voxels: overlay.voxels.slice(),
        ...(overlay.fluid ? { fluid: overlay.fluid.slice() } : {}),
      })),
    };
  }

  acceptCanonical(
    task: VisibilityTask,
    result: Readonly<{ canonical?: ArrayBuffer; generatorVersion?: number }>,
  ): Promise<boolean> {
    const prepared = this.preparations.get(task.chunkKey);
    return consumeTransferredAuthorityCollisionBaseline({
      key: task.chunkKey,
      chunkRevision: task.chunkRevision,
      generatorVersion: task.generatorVersion,
      result,
      preparedFluid: prepared?.fluid,
      chunks: this.meshes,
      guard: this.revisions,
      accept: async () => {
        const canonical = new Uint16Array(result.canonical!);
        if (matchesPreparedVisibilityCanonical(task, prepared, canonical)) return true;
        if (prepared?.canonical?.buffer === canonical.buffer) prepared.canonical = prepared.canonical.slice();
        const forAuthority = canonical.slice();
        const response = (await this.request(
          { kind: 'accept-generated-chunk', ...task, key: task.chunkKey, canonical: forAuthority.buffer },
          [forAuthority.buffer],
        )) as { accepted: boolean };
        return response.accepted;
      },
    });
  }

  getVoxel(x: number, y: number, z: number) {
    return this.baselines.getVoxel(x, y, z);
  }

  getFluidCell(x: number, y: number, z: number) {
    return this.baselines.getFluidCell(x, y, z);
  }

  getChunkRevision(cx: number, cy: number, cz: number) {
    return this.baselines.getChunkRevision(cx, cy, cz);
  }

  initialize(worldRevision: number): void {
    this.revisions.initializeCommitDelivery(worldRevision);
  }

  publish(commits: readonly WorldCommitResult[] | undefined): void {
    publishAuthorityCollisionCommits(commits, this.meshes, this.options, this.revisions);
  }

  synchronize(snapshot: AuthoritySnapshot): void {
    this.baselines.synchronize(snapshot.chunkRevisions);
  }

  clear(): void {
    this.loads.clear();
    this.meshes.clear();
    this.preparations.clear();
    this.revisions.clear();
  }
}
