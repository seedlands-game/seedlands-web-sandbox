import { Voxel, chunkKey, floorDiv, CHUNK_SIZE, mod, voxelIndex } from '../world/voxel';
import type { ServerChunk, WorldCommitResult, WorldEditBatch } from './game-server-types';
import { commitWorldEditBatch } from './world-transaction-commit';
import { prepareSingleWorldEdit, type PreparedWorldEdit } from './prepared-world-edit';
import * as FluidSidecars from './fluid/fluid-edit-sidecars';
import { hasAdjacentWater } from './fluid/fluid-cell-state';
import type { FluidChunkAccess } from './fluid/fluid-chunk-access';
import type { FluidActiveWindow } from './fluid/fluid-active-window';
import type { FluidTransactionRuntime } from './fluid/fluid-transaction-runtime';
import type { FluidActivationPriority } from './fluid/fluid-transaction';

type WorldEditRuntimeOptions = Readonly<{
  chunks: ReadonlyMap<string, ServerChunk>;
  getChunk(cx: number, cy: number, cz: number): ServerChunk;
  getVoxel(x: number, y: number, z: number): number;
  getRevision(): number;
  setRevision(revision: number): void;
  addMutationCount(count: number): void;
  commitSingleEdit(actorId: string, x: number, y: number, z: number, value: number): WorldCommitResult;
  now(): number;
  fluidChunks: FluidChunkAccess;
  fluidWindow: FluidActiveWindow;
  fluidRuntime: FluidTransactionRuntime<WorldCommitResult>;
  priorityForBatch(batch: WorldEditBatch): FluidActivationPriority;
}>;

export function commitServerWorldEdit(options: WorldEditRuntimeOptions, batch: WorldEditBatch): WorldCommitResult {
  const previousFluid = FluidSidecars.captureBatchFluidState(batch, {
    getVoxel: options.getVoxel,
    getCell: (x, y, z) => options.fluidChunks.cell(x, y, z, true),
  });
  const result = commitWorldEditBatch(options, batch, options.now);
  if (result.committed)
    FluidSidecars.commitBatchFluidSidecars(previousFluid, {
      getVoxel: options.getVoxel,
      includeEditedPosition: (x, y, z) => options.fluidWindow.includeEditedPosition(x, y, z),
      writeCell: (x, y, z, cell) => options.fluidChunks.write(x, y, z, cell),
      peekVoxel: (x, y, z) => options.fluidChunks.peekVoxel(x, y, z),
      activate: (position) => options.fluidRuntime.activate(position, options.priorityForBatch(batch)),
      removeSource: (position) => options.fluidRuntime.removeSource(position),
    });
  return result;
}

/** Prepared gameplay edits include canonical fluid bytes and use the existing bounded rescan-backed frontier. */
export function prepareServerWorldEdit(
  options: WorldEditRuntimeOptions,
  input: Readonly<{ actorId: string; position: readonly [number, number, number]; value: number }>,
): PreparedWorldEdit {
  const { actorId, value } = input;
  const [x, y, z] = input.position;
  const base = prepareSingleWorldEdit(
    {
      getLoadedChunk: (cx, cy, cz) => options.chunks.get(chunkKey(cx, cy, cz)),
      getRevision: options.getRevision,
      setWorldRevision: options.setRevision,
      addMutationCount: options.addMutationCount,
    },
    { actorId, x, y, z, value },
  );
  const chunk = options.chunks.get(
    chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)),
  )!;
  const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  const previousVoxel = chunk.voxels[index],
    previousFluid = chunk.fluid[index];
  const peek = (a: number, b: number, c: number) => options.fluidChunks.peekVoxel(a, b, c);
  const neighbors = [
    [x - 1, y, z],
    [x + 1, y, z],
    [x, y - 1, z],
    [x, y + 1, z],
    [x, y, z - 1],
    [x, y, z + 1],
  ] as const;
  const observed = neighbors.map((at) => peek(...at));
  const activate = previousVoxel === Voxel.Water || value === Voxel.Water || hasAdjacentWater(peek, x, y, z);
  const removeSource = previousVoxel === Voxel.Water && (previousFluid & 0x80) !== 0 && value !== Voxel.Water;
  const priority = options.priorityForBatch({ actorId, edits: [{ x, y, z, value }] });
  let validated = false;
  const validate = () => {
    validated = false;
    base.validate();
    if (neighbors.some((at, i) => peek(...at) !== observed[i]))
      throw new Error('Prepared adjacent fluid state is stale.');
    validated = true;
  };
  return Object.freeze({
    committed: base.committed,
    validate,
    apply() {
      if (!validated) throw new Error('Prepared world edit requires validation.');
      validate();
      const result = base.apply();
      if (result.committed) {
        options.fluidWindow.includeEditedPosition(x, y, z);
        if (activate) options.fluidRuntime.activate([x, y, z], priority);
        if (removeSource) options.fluidRuntime.removeSource([x, y, z]);
      }
      return result;
    },
  });
}
