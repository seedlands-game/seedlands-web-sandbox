import { assertGeneratedChunk, requireWorldgenProvider, type KernelWorldgenProvider } from '@seedlands/kernel/spatial';
import { chunkKey } from '../world/voxel';
import { legacyFluid } from './fluid/fluid-cell-state';
import type { EntityStore } from './gameplay/entity-store';
import type { StationStateCodec } from './gameplay/ecs-station-state';
import type { ServerChunk } from './game-server-types';
import type { ChunkPersistence } from './persistence/chunk-persistence';
import { isValidChunkSnapshot } from './persistence/validate-chunk-snapshot';
import { restoreServerChunk } from './server-chunk-restore';
import { assertStationChunkIntegrity, stationChunkKeys } from './station-world-integrity';

type Input = Readonly<{
  seedText: string;
  seed: number;
  generatorVersion: number;
  epoch: number;
  accessEpoch: number;
  provider?: KernelWorldgenProvider;
  persistence?: ChunkPersistence;
  currentChunks: ReadonlyMap<string, ServerChunk>;
  currentEntities: EntityStore;
  candidateEntities: EntityStore;
  stationCodec?: StationStateCodec;
}>;

export function generateGameServerChunk(
  input: Readonly<{
    seed: number;
    generatorVersion: number;
    epoch: number;
    accessEpoch: number;
    cx: number;
    cy: number;
    cz: number;
    provider?: KernelWorldgenProvider;
  }>,
): ServerChunk {
  const provider = requireWorldgenProvider(input.provider);
  const coordinate = { x: input.cx, y: input.cy, z: input.cz };
  const generated = provider.generate({
    seed: input.seed,
    generatorVersion: input.generatorVersion,
    coordinate,
    epoch: input.epoch,
    revision: 0,
  });
  assertGeneratedChunk(
    {
      provider: provider.identity,
      generatorVersion: input.generatorVersion,
      epoch: input.epoch,
      revision: 0,
      coordinate,
    },
    generated,
  );
  return {
    key: chunkKey(input.cx, input.cy, input.cz),
    cx: input.cx,
    cy: input.cy,
    cz: input.cz,
    voxels: generated.voxels,
    revision: 0,
    persistedRevision: 0,
    dirty: false,
    materialized: false,
    accessEpoch: input.accessEpoch,
    fluid: legacyFluid(generated.voxels),
  };
}

/** Builds every station-dependent Chunk before the live gameplay owner is exchanged. */
export async function prepareGameServerRestoreChunks(input: Input): Promise<Map<string, ServerChunk>> {
  const keys = new Set([...stationChunkKeys(input.currentEntities), ...stationChunkKeys(input.candidateEntities)]);
  const prepared = new Map<string, ServerChunk>();
  for (const key of keys) {
    const [cx, cy, cz] = key.split(',').map(Number) as [number, number, number];
    if (input.persistence?.ensureSnapshot) await input.persistence.ensureSnapshot(cx, cy, cz);
    else await input.persistence?.ensureNeighborhood?.(cx, cy, cz);
    const snapshot = input.persistence?.loadSnapshot(key);
    let chunk: ServerChunk;
    if (snapshot) {
      if (
        !isValidChunkSnapshot(snapshot, {
          seedText: input.seedText,
          generatorVersion: input.generatorVersion,
          key,
          cx,
          cy,
          cz,
        })
      )
        throw new Error(`Persisted canonical Chunk is invalid for ${key}.`);
      chunk = restoreServerChunk(snapshot, input.accessEpoch + prepared.size + 1);
    } else {
      const current = input.currentChunks.get(key);
      if (current) chunk = current;
      else
        chunk = generateGameServerChunk({
          seed: input.seed,
          generatorVersion: input.generatorVersion,
          epoch: input.epoch,
          accessEpoch: input.accessEpoch + prepared.size + 1,
          cx,
          cy,
          cz,
          provider: input.provider,
        });
    }
    assertStationChunkIntegrity(chunk, input.stationCodec, input.candidateEntities);
    prepared.set(key, chunk);
  }
  return prepared;
}
