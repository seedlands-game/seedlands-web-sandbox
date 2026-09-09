import { CHUNK_SIZE, chunkKey, Voxel } from '../../world/voxel';
import { GAME_SAVE_SCHEMA_VERSION, type FrozenGameSaveSnapshot } from '../persistence/game-save-snapshot';
import { WORLD_HARNESS_MAX_CHECKPOINT_BYTES, type WorldFrontier } from './world-harness-contract';

export const finiteTuple = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

export const integerTuple = (value: unknown): value is readonly [number, number, number] =>
  finiteTuple(value) && value.every(Number.isInteger);

export const checkpointBytes = (snapshot: FrozenGameSaveSnapshot): number => {
  const chunkBytes = snapshot.chunks.reduce(
    (sum, chunk) => sum + chunk.voxels.byteLength + (chunk.fluid?.byteLength ?? 0),
    0,
  );
  const metadata = JSON.stringify({
    ...snapshot,
    chunks: snapshot.chunks.map(({ voxels: _voxels, fluid: _fluid, ...chunk }) => chunk),
  });
  return chunkBytes + metadata.length * 3;
};

export function validatePortableCheckpoint(value: unknown): FrozenGameSaveSnapshot {
  if (!value || typeof value !== 'object') throw new TypeError('Checkpoint must be an object.');
  const snapshot = value as Partial<FrozenGameSaveSnapshot>;
  if (snapshot.version !== GAME_SAVE_SCHEMA_VERSION) throw new TypeError('Unsupported checkpoint version.');
  if (typeof snapshot.seedText !== 'string' || !snapshot.seedText.trim() || snapshot.seedText.length > 256)
    throw new TypeError('Checkpoint seedText is invalid.');
  if (
    !Number.isInteger(snapshot.generatorVersion) ||
    !Number.isSafeInteger(snapshot.commitSequence) ||
    snapshot.commitSequence! < 0
  )
    throw new TypeError('Checkpoint identity is invalid.');
  if (!Number.isSafeInteger(snapshot.worldRevision) || snapshot.worldRevision! < 0)
    throw new TypeError('Checkpoint world revision is invalid.');
  if (!snapshot.gameplay || typeof snapshot.gameplay !== 'object' || !Array.isArray(snapshot.chunks))
    throw new TypeError('Checkpoint gameplay or chunks are invalid.');
  if (snapshot.chunks.length > 4_096) throw new RangeError('Checkpoint contains too many chunks.');
  const keys = new Set<string>();
  for (const chunk of snapshot.chunks) {
    if (
      !chunk ||
      chunk.key !== chunkKey(chunk.cx, chunk.cy, chunk.cz) ||
      keys.has(chunk.key) ||
      chunk.seedText !== snapshot.seedText ||
      chunk.generatorVersion !== snapshot.generatorVersion ||
      !Number.isSafeInteger(chunk.revision) ||
      chunk.revision < 0 ||
      !(chunk.voxels instanceof Uint16Array) ||
      chunk.voxels.length !== CHUNK_SIZE ** 3 ||
      !chunk.voxels.every((voxel: number) => voxel >= Voxel.Air && voxel <= Voxel.Lantern) ||
      (chunk.fluid !== undefined && (!(chunk.fluid instanceof Uint8Array) || chunk.fluid.length !== CHUNK_SIZE ** 3))
    )
      throw new TypeError(`Checkpoint chunk is invalid: ${String(chunk?.key)}`);
    keys.add(chunk.key);
  }
  if (checkpointBytes(snapshot as FrozenGameSaveSnapshot) > WORLD_HARNESS_MAX_CHECKPOINT_BYTES)
    throw new RangeError('Checkpoint exceeds the portable size limit.');
  return snapshot as FrozenGameSaveSnapshot;
}

export function validateWorldFrontier(frontier: WorldFrontier): void {
  if (
    !frontier ||
    typeof frontier !== 'object' ||
    typeof frontier.worldId !== 'string' ||
    typeof frontier.epoch !== 'string' ||
    !Number.isSafeInteger(frontier.worldRevision) ||
    frontier.worldRevision < 0 ||
    !Number.isSafeInteger(frontier.commitSequence) ||
    frontier.commitSequence < 0 ||
    !Number.isSafeInteger(frontier.physicsTick) ||
    frontier.physicsTick < 0 ||
    !Number.isSafeInteger(frontier.fluidWorkSequence) ||
    frontier.fluidWorkSequence < 0 ||
    !Number.isSafeInteger(frontier.logicObservationSequence) ||
    frontier.logicObservationSequence < 0
  )
    throw new TypeError('World barrier frontier is invalid.');
}
