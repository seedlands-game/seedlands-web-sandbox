import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { CorePlatformPorts } from '../runtime/platform-ports';
import type { FluidActivationPriority } from './fluid/fluid-transaction';
import type { FluidActiveWindow } from './fluid/fluid-active-window';
import type { FluidChunkAccess } from './fluid/fluid-chunk-access';
import type { FluidTransactionRuntime } from './fluid/fluid-transaction-runtime';
import type { EntityStore } from './gameplay/entity-store';
import type { StationStateCodec } from './gameplay/ecs-station-state';
import type { ServerChunk, WorldCommitResult, WorldEditBatch } from './game-server-types';
import { prepareWorldCommitMetadata } from './prepared-world-commit-metadata';
import { ServerWorldCommitHost } from './server-world-commit-host';
import { assertNoRawStationEdits } from './station-world-integrity';
import type { ExpectedWorldVoxelEdit } from './world-transaction-commit';
import { assertWorldMutationBatch } from './world-mutation';
import { assertWorldEditBatchCardinality } from './world-edit-batch-plan';

type Options = Readonly<{
  chunks: Map<string, ServerChunk>;
  getChunk(cx: number, cy: number, cz: number): ServerChunk;
  kernelState: KernelStateOwner;
  mutationCount: Readonly<{ get(): number; set(value: number): void }>;
  platform: Pick<CorePlatformPorts, 'now'>;
  fluidChunks: FluidChunkAccess;
  fluidWindow: FluidActiveWindow;
  fluidRuntime(): FluidTransactionRuntime<WorldCommitResult>;
  priorityForBatch(batch: WorldEditBatch): FluidActivationPriority;
  entities(): EntityStore;
  stationCodec(): StationStateCodec | undefined;
  getVoxel(x: number, y: number, z: number): number;
  getLoadedVoxel(x: number, y: number, z: number): number | undefined;
  isVoxelRegistered?: (voxel: number) => boolean;
}>;

export function createGameServerWorldCommitApi(options: Options) {
  const commits = new ServerWorldCommitHost({
    ...options,
    getRevision: () => options.kernelState.worldRevision,
    setRevision: (revision) => options.kernelState.commitWorldRevision(options.kernelState.epoch, revision),
    addMutationCount: (count) => options.mutationCount.set(options.mutationCount.get() + count),
    prepareCommitMetadata: (revision, count) =>
      prepareWorldCommitMetadata(options.kernelState, revision, count, options.mutationCount),
  });
  return Object.freeze({
    commits,
    editBatch(batch: WorldEditBatch) {
      if (batch.edits) assertWorldEditBatchCardinality(batch.edits);
      assertWorldMutationBatch(batch, options.isVoxelRegistered);
      assertNoRawStationEdits(batch, options.stationCodec(), options.entities(), options.getVoxel);
      return commits.editBatch(batch);
    },
    prepareVoxelEdit(actorId: string, position: readonly [number, number, number], value: number) {
      const [x, y, z] = position;
      const batch = { actorId, edits: [{ x, y, z, value }] };
      assertWorldMutationBatch(batch, options.isVoxelRegistered);
      assertNoRawStationEdits(batch, options.stationCodec(), options.entities(), options.getLoadedVoxel);
      return commits.prepareVoxelEdit(actorId, position, value);
    },
    prepareVoxelEdits(actorId: string, edits: readonly ExpectedWorldVoxelEdit[]) {
      assertWorldEditBatchCardinality(edits);
      const batch = { actorId, edits: edits.map(({ x, y, z, value }) => ({ x, y, z, value })) };
      assertWorldMutationBatch(batch, options.isVoxelRegistered);
      assertNoRawStationEdits(batch, options.stationCodec(), options.entities(), options.getLoadedVoxel);
      return commits.prepareVoxelEdits(actorId, edits);
    },
  });
}

export type GameServerWorldCommitApi = Omit<ReturnType<typeof createGameServerWorldCommitApi>, 'commits'>;

export function installGameServerWorldCommitApi(target: object, api: GameServerWorldCommitApi): void {
  for (const name of ['editBatch', 'prepareVoxelEdit', 'prepareVoxelEdits'] as const)
    Object.defineProperty(target, name, { configurable: true, enumerable: false, value: api[name] });
}
