import { CHUNK_SIZE, Voxel, chunkKey, floorDiv, mod, voxelIndex } from '../world/voxel';
import type { ServerChunk, WorldCommitResult } from './game-server-types';
import { assertMutationCoordinate, assertVoxelValue } from './world-mutation';
import { createSingleWorldEditResult } from './single-world-edit';

type WorldEditPorts = Readonly<{
  getLoadedChunk(cx: number, cy: number, cz: number): ServerChunk | undefined;
  getRevision(): number;
  setWorldRevision(revision: number): void;
  addMutationCount(count: number): void;
}>;
export type PreparedWorldEdit = Readonly<{
  committed: boolean;
  validate(): void;
  apply(): WorldCommitResult;
}>;

/** Host-only participant. All owners validate before the synchronous, callback-free apply phase. */
export function prepareSingleWorldEdit(
  ports: WorldEditPorts,
  input: Readonly<{ actorId: string; x: number; y: number; z: number; value: number }>,
): PreparedWorldEdit {
  const { actorId, x, y, z, value } = input;
  if (typeof actorId !== 'string' || !actorId.trim()) throw new TypeError('World edit actor is invalid.');
  for (const coordinate of [x, y, z]) assertMutationCoordinate(coordinate);
  assertVoxelValue(value);
  const { getLoadedChunk, getRevision, setWorldRevision, addMutationCount } = ports;
  const cx = floorDiv(x, CHUNK_SIZE),
    cy = floorDiv(y, CHUNK_SIZE),
    cz = floorDiv(z, CHUNK_SIZE);
  const chunk = getLoadedChunk(cx, cy, cz);
  if (!chunk) throw new Error('World edit chunk is unavailable.');
  if (
    chunk.key !== chunkKey(cx, cy, cz) ||
    chunk.voxels.length !== CHUNK_SIZE ** 3 ||
    chunk.fluid.length !== CHUNK_SIZE ** 3
  )
    throw new TypeError('World edit chunk identity is invalid.');
  const worldRevision = getRevision(),
    chunkRevision = chunk.revision;
  const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  const voxels = chunk.voxels,
    fluid = chunk.fluid;
  const previous = voxels[index],
    previousFluid = fluid[index];
  const changing = previous !== value;
  for (const revision of [worldRevision, chunkRevision])
    if (!Number.isSafeInteger(revision) || revision < 0 || (changing && revision >= Number.MAX_SAFE_INTEGER))
      throw new RangeError('World edit revision capacity is exhausted or invalid.');
  const result = createSingleWorldEditResult({ actorId, x, y, z, value, worldRevision, chunk });
  let used = false,
    validated = false;
  const validate = () => {
    if (used) throw new Error('Prepared world edit was already used.');
    validated = false;
    if (
      getRevision() !== worldRevision ||
      getLoadedChunk(cx, cy, cz) !== chunk ||
      chunk.revision !== chunkRevision ||
      chunk.voxels !== voxels ||
      chunk.fluid !== fluid ||
      chunk.voxels[index] !== previous ||
      chunk.fluid[index] !== previousFluid
    )
      throw new Error('Prepared world edit is stale.');
    validated = true;
  };
  return Object.freeze({
    committed: result.committed,
    validate,
    apply() {
      if (used) throw new Error('Prepared world edit was already used.');
      if (!validated) throw new Error('Prepared world edit requires validation.');
      validate();
      used = true;
      if (result.committed) {
        chunk.voxels[index] = value;
        chunk.fluid[index] = value === Voxel.Water ? 0x88 : 0;
        chunk.revision = chunkRevision + 1;
        chunk.dirty = true;
        chunk.materialized = true;
        setWorldRevision(result.worldRevision);
        addMutationCount(1);
      }
      return result;
    },
  });
}
