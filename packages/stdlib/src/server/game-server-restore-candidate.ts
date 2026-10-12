import { assertGeneratedChunk, requireWorldgenProvider, type KernelWorldgenProvider } from '@seedlands/kernel/spatial';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../world/voxel';
import { legacyFluid } from './fluid/fluid-cell-state';
import type { EntityStore } from './gameplay/entity-store';
import type { StationStateCodec } from './gameplay/ecs-station-state';
import type { ServerChunk } from './game-server-types';
import type { ChunkPersistence } from './persistence/chunk-persistence';
import type { VoxelSemanticsResolver } from '../world/voxel-semantics';
import { isValidChunkSnapshot } from './persistence/validate-chunk-snapshot';
import { restoreServerChunk } from './server-chunk-restore';
import { assertStationChunkIntegrity, stationChunkKeys } from './station-world-integrity';
import type { TransportDefinitionRegistryV1 } from './gameplay/modules/transport-model';
import { transportBodyConfig } from './gameplay/transport-body-config';
import { transportInclinationV1 } from './gameplay/modules/transport-motion-state';

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
  voxelSemantics?: VoxelSemanticsResolver;
  mediaPositions?: readonly (readonly [number, number, number])[];
  transportDefinitions?: TransportDefinitionRegistryV1;
}>;

function restoredTransportChunkKeys(input: Input): readonly string[] {
  const keys = new Set<string>();
  for (const entity of input.candidateEntities.query({ type: 'transport' })) {
    const reference = input.candidateEntities.createReference(entity.id);
    const state = reference && input.candidateEntities.transportState(reference);
    const definition = state && input.transportDefinitions?.require(state.definitionId);
    if (!state || !definition) throw new TypeError('Transport restore requires its current configured definition.');
    const bounds = transportBodyConfig(definition, state.pose.yaw, transportInclinationV1(state)).localAabb;
    const axes = ['x', 'y', 'z'] as const;
    const lower = entity.position.map((value, axis) =>
      floorDiv(Math.floor(value + bounds.min[axes[axis]!] - 1), CHUNK_SIZE),
    );
    const upper = entity.position.map((value, axis) =>
      floorDiv(Math.floor(value + bounds.max[axes[axis]!] + 1 - Number.EPSILON), CHUNK_SIZE),
    );
    const count = lower.reduce((total, value, axis) => total * (upper[axis]! - value + 1), 1);
    if (![...lower, ...upper].every(Number.isSafeInteger) || !Number.isSafeInteger(count) || count < 1 || count > 4096)
      throw new TypeError('Transport restore footprint exceeds the bounded terrain query.');
    for (let cx = lower[0]!; cx <= upper[0]!; cx++)
      for (let cy = lower[1]!; cy <= upper[1]!; cy++)
        for (let cz = lower[2]!; cz <= upper[2]!; cz++) {
          keys.add(chunkKey(cx, cy, cz));
          if (keys.size > 4096) throw new TypeError('Transport restore exceeds the bounded terrain query.');
        }
  }
  return [...keys].sort();
}

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

/** Builds station and configured transport terrain before the live gameplay owner is exchanged. */
export async function prepareGameServerRestoreChunks(input: Input): Promise<Map<string, ServerChunk>> {
  const keys = new Set([
    ...stationChunkKeys(input.currentEntities),
    ...stationChunkKeys(input.candidateEntities),
    ...restoredTransportChunkKeys(input),
  ]);
  for (const [x, y, z] of input.mediaPositions ?? [])
    keys.add(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
  const prepared = new Map<string, ServerChunk>();
  for (const key of keys) {
    const [cx, cy, cz] = key.split(',').map(Number) as [number, number, number];
    if (input.persistence?.ensureSnapshot) await input.persistence.ensureSnapshot(cx, cy, cz);
    else await input.persistence?.ensureNeighborhood?.(cx, cy, cz);
    const snapshot = input.persistence?.loadSnapshot(key);
    let chunk: ServerChunk;
    if (snapshot) {
      if (
        !isValidChunkSnapshot(
          snapshot,
          {
            seedText: input.seedText,
            generatorVersion: input.generatorVersion,
            key,
            cx,
            cy,
            cz,
          },
          input.voxelSemantics,
        )
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
