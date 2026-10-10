import type { FluidChunkActivationQueue } from './fluid/fluid-chunk-activation-queue';
import type { ChunkPersistence } from './persistence/chunk-persistence';
import type { EntityStore } from './gameplay/entity-store';
import type { StationStateCodec } from './gameplay/ecs-station-state';
import type { ServerChunk, WorkerCanonicalResult } from './game-server-types';
import { prepareWorkerCanonicalAdmission } from './game-server-worker-canonical';
import type { VoxelSemanticsResolver } from '../world/voxel-semantics';
import type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';

export function acceptServerWorkerCanonical(
  input: Readonly<{
    result: WorkerCanonicalResult;
    generatorVersion: number;
    provider?: KernelWorldgenProviderIdentity;
    chunks: Map<string, ServerChunk>;
    stationCodec?: StationStateCodec;
    entities: EntityStore;
    voxelSemantics?: VoxelSemanticsResolver;
    prepareAdmission(key: string): boolean;
    nextAccessEpoch(): number;
    persistence?: ChunkPersistence;
    fluidAllows(key: string): boolean;
    fluidActivations: FluidChunkActivationQueue;
    maintainResidency(): void;
  }>,
): boolean {
  const prepared = prepareWorkerCanonicalAdmission({
    result: input.result,
    generatorVersion: input.generatorVersion,
    provider: input.provider,
    current: input.chunks.get(input.result.key),
    stationCodec: input.stationCodec,
    entities: input.entities,
    voxelSemantics: input.voxelSemantics,
  });
  if (prepared.kind === 'reject') return false;
  if (prepared.kind === 'existing') return prepared.accepted;
  if (!input.prepareAdmission(input.result.key)) return false;
  const accepted: ServerChunk = { ...prepared.chunk, accessEpoch: input.nextAccessEpoch() };
  input.chunks.set(input.result.key, accepted);
  input.persistence?.evictSnapshot?.(input.result.key);
  if (input.fluidAllows(input.result.key)) input.fluidActivations.schedule(accepted);
  input.maintainResidency();
  return true;
}
