import type { CorePlatformPorts } from '../runtime/platform-ports';
import type { FluidCandidate, FluidActivationPriority } from './fluid/fluid-transaction';
import type { FluidActiveWindow } from './fluid/fluid-active-window';
import type { FluidChunkAccess } from './fluid/fluid-chunk-access';
import type { FluidTransactionRuntime } from './fluid/fluid-transaction-runtime';
import { commitFluidCandidate } from './fluid/fluid-candidate-commit';
import { commitSingleWorldEdit } from './single-world-edit';
import { commitServerWorldEdit, prepareServerWorldEdit } from './world-edit-runtime';
import type { ServerChunk, WorldCommitResult, WorldEditBatch } from './game-server-types';

type Options = Readonly<{
  chunks: Map<string, ServerChunk>;
  getChunk(cx: number, cy: number, cz: number): ServerChunk;
  getVoxel(x: number, y: number, z: number): number;
  getRevision(): number;
  setRevision(revision: number): void;
  addMutationCount(count: number): void;
  platform: Pick<CorePlatformPorts, 'now'>;
  fluidChunks: FluidChunkAccess;
  fluidWindow: FluidActiveWindow;
  fluidRuntime(): FluidTransactionRuntime<WorldCommitResult>;
  priorityForBatch(batch: WorldEditBatch): FluidActivationPriority;
}>;

export class ServerWorldCommitHost {
  constructor(private readonly options: Options) {}

  editBatch(batch: WorldEditBatch): WorldCommitResult {
    return commitServerWorldEdit(this.worldEditOptions(), batch);
  }

  prepareVoxelEdit(actorId: string, position: readonly [number, number, number], value: number) {
    return prepareServerWorldEdit(this.worldEditOptions(), { actorId, position, value });
  }

  applyFluidCandidate(candidate: FluidCandidate): WorldCommitResult {
    return commitFluidCandidate({
      candidate,
      chunks: this.options.chunks,
      worldRevision: this.options.getRevision(),
      setWorldRevision: this.options.setRevision,
      addMutationCount: this.options.addMutationCount,
    });
  }

  commitSingleEdit(actorId: string, x: number, y: number, z: number, value: number): WorldCommitResult {
    return commitSingleWorldEdit({
      actorId,
      x,
      y,
      z,
      value,
      worldRevision: this.options.getRevision(),
      getChunk: this.options.getChunk,
      setWorldRevision: this.options.setRevision,
      addMutationCount: this.options.addMutationCount,
    });
  }

  private worldEditOptions() {
    return {
      chunks: this.options.chunks,
      getChunk: this.options.getChunk,
      getVoxel: this.options.getVoxel,
      getRevision: this.options.getRevision,
      setRevision: this.options.setRevision,
      addMutationCount: this.options.addMutationCount,
      commitSingleEdit: (actorId: string, x: number, y: number, z: number, value: number) =>
        this.commitSingleEdit(actorId, x, y, z, value),
      now: this.options.platform.now,
      fluidChunks: this.options.fluidChunks,
      fluidWindow: this.options.fluidWindow,
      fluidRuntime: this.options.fluidRuntime(),
      priorityForBatch: this.options.priorityForBatch,
    };
  }
}
