import { assertWorldgenProviderIdentity, type KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';
import { CHUNK_SIZE, MAX_VOXEL_ID, Voxel, chunkKey } from '../world/voxel';
import { legacyFluid } from './fluid/fluid-cell-state';
import type { EntityStore } from './gameplay/entity-store';
import type { StationStateCodec } from './gameplay/ecs-station-state';
import type { ServerChunk, WorkerCanonicalResult } from './game-server-types';
import { assertStationChunkIntegrity } from './station-world-integrity';

type Result =
  | Readonly<{ kind: 'reject' }>
  | Readonly<{ kind: 'existing'; accepted: boolean }>
  | Readonly<{ kind: 'candidate'; chunk: Omit<ServerChunk, 'accessEpoch'> }>;

export function prepareWorkerCanonicalAdmission(
  input: Readonly<{
    result: WorkerCanonicalResult;
    generatorVersion: number;
    provider?: KernelWorldgenProviderIdentity;
    current?: ServerChunk;
    stationCodec?: StationStateCodec;
    entities: EntityStore;
  }>,
): Result {
  const { result } = input;
  if (input.provider) {
    if (!result.provider) return { kind: 'reject' };
    try {
      assertWorldgenProviderIdentity(input.provider, result.provider, result.generatorVersion);
    } catch {
      return { kind: 'reject' };
    }
  }
  if (
    result.generatorVersion !== input.generatorVersion ||
    result.key !== chunkKey(result.cx, result.cy, result.cz) ||
    result.canonical.length !== CHUNK_SIZE ** 3 ||
    !result.canonical.every((value) => value >= Voxel.Air && value <= MAX_VOXEL_ID)
  )
    return { kind: 'reject' };
  if (input.current)
    return {
      kind: 'existing',
      accepted:
        input.current.revision === result.chunkRevision &&
        input.current.voxels.every((value, index) => value === result.canonical[index]),
    };
  if (result.chunkRevision !== 0) return { kind: 'reject' };
  try {
    assertStationChunkIntegrity({ ...result, voxels: result.canonical }, input.stationCodec, input.entities);
  } catch {
    return { kind: 'reject' };
  }
  return {
    kind: 'candidate',
    chunk: {
      key: result.key,
      cx: result.cx,
      cy: result.cy,
      cz: result.cz,
      voxels: result.canonical,
      revision: 0,
      persistedRevision: 0,
      dirty: false,
      materialized: false,
      fluid: legacyFluid(result.canonical),
    },
  };
}
