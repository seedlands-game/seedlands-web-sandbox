import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '../../world/voxel';
import type { ServerChunk, WorldEditBatch } from '../game-server-types';
import { hasAdjacentFluid, isFluidVoxel } from './fluid-cell-state';
import type { FluidCellValue, FluidChunkSnapshot, FluidPosition } from './fluid-transaction';
import type { FluidCell } from './fluid-cell';

export type PreviousFluidState = { x: number; y: number; z: number; voxel: number; cell: FluidCell | null };
export type BatchFluidSidecarEffectPlan = Readonly<{
  editedPositions: readonly (readonly [number, number, number])[];
  effects: readonly Readonly<{
    position: readonly [number, number, number];
    activate: boolean;
    removeSource: boolean;
  }>[];
  validate(): void;
}>;

export function readFluidChunk(
  key: string,
  allowsKey: (key: string) => boolean,
  chunks: ReadonlyMap<string, ServerChunk>,
): FluidChunkSnapshot | null {
  if (!allowsKey(key)) return null;
  const chunk = chunks.get(key);
  return chunk
    ? {
        key: chunk.key,
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
        revision: chunk.revision,
        voxels: chunk.voxels,
        fluid: chunk.fluid,
      }
    : null;
}

export function readFluidCell(
  [x, y, z]: FluidPosition,
  allowsPosition: (x: number, y: number, z: number) => boolean,
  chunks: ReadonlyMap<string, ServerChunk>,
): FluidCellValue | null {
  if (!allowsPosition(x, y, z)) return null;
  const chunk = chunks.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
  if (!chunk) return null;
  const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
  return { voxel: chunk.voxels[index], fluid: chunk.fluid[index] };
}

export function captureBatchFluidState(
  batch: WorldEditBatch,
  callbacks: {
    getVoxel(x: number, y: number, z: number): number;
    getCell(x: number, y: number, z: number): FluidCell | null;
  },
): Map<string, PreviousFluidState> {
  const previous = new Map<string, PreviousFluidState>();
  const remember = (x: number, y: number, z: number) => {
    const key = `${x},${y},${z}`;
    if (previous.has(key)) return;
    const voxel = callbacks.getVoxel(x, y, z);
    previous.set(key, { x, y, z, voxel, cell: isFluidVoxel(voxel) ? callbacks.getCell(x, y, z) : null });
  };
  batch.edits?.forEach((edit) => remember(edit.x, edit.y, edit.z));
  batch.buffers?.forEach((buffer) => buffer.forEach((x, y, z) => remember(x, y, z)));
  return previous;
}

export function commitBatchFluidSidecars(
  previous: ReadonlyMap<string, PreviousFluidState>,
  callbacks: {
    getVoxel(x: number, y: number, z: number): number;
    includeEditedPosition(x: number, y: number, z: number): void;
    writeCell(x: number, y: number, z: number, cell: FluidCell | null): boolean;
    peekVoxel(x: number, y: number, z: number): number | undefined;
    activate(position: [number, number, number]): boolean;
    removeSource(position: [number, number, number]): boolean;
  },
): void {
  for (const state of previous.values()) {
    const value = callbacks.getVoxel(state.x, state.y, state.z);
    if (value === state.voxel) continue;
    callbacks.includeEditedPosition(state.x, state.y, state.z);
    callbacks.writeCell(state.x, state.y, state.z, isFluidVoxel(value) ? { level: 8, source: true } : null);
    if (
      isFluidVoxel(state.voxel) ||
      isFluidVoxel(value) ||
      hasAdjacentFluid(callbacks.peekVoxel, state.x, state.y, state.z)
    )
      callbacks.activate([state.x, state.y, state.z]);
    if (state.cell?.source && !isFluidVoxel(value)) callbacks.removeSource([state.x, state.y, state.z]);
  }
}

export function captureBatchFinalValues(batch: WorldEditBatch): Map<string, number> {
  const final = new Map<string, number>();
  batch.edits?.forEach(({ x, y, z, value }) => final.set(`${x},${y},${z}`, value));
  [...(batch.buffers ?? [])]
    .sort((left, right) =>
      left.priority < right.priority
        ? -1
        : left.priority > right.priority
          ? 1
          : left.sourceId < right.sourceId
            ? -1
            : left.sourceId > right.sourceId
              ? 1
              : 0,
    )
    .forEach((buffer) => buffer.forEach((x, y, z, value) => final.set(`${x},${y},${z}`, value)));
  return final;
}

/** Derived scheduling after canonical voxel/fluid bytes commit; notification failures never falsify the world receipt. */
export function prepareBatchFluidSidecarEffects(
  previous: ReadonlyMap<string, PreviousFluidState>,
  final: ReadonlyMap<string, number>,
  peekVoxel: (x: number, y: number, z: number) => number | undefined,
): BatchFluidSidecarEffectPlan {
  const nextVoxel = (x: number, y: number, z: number) => final.get(`${x},${y},${z}`) ?? peekVoxel(x, y, z);
  const neighborPositions = new Map<string, readonly [number, number, number]>();
  const effects = [...previous.values()].flatMap((state) => {
    const value = final.get(`${state.x},${state.y},${state.z}`);
    if (value === undefined || value === state.voxel) return [];
    const neighbors = [
      [state.x - 1, state.y, state.z],
      [state.x + 1, state.y, state.z],
      [state.x, state.y - 1, state.z],
      [state.x, state.y + 1, state.z],
      [state.x, state.y, state.z - 1],
      [state.x, state.y, state.z + 1],
    ] as const;
    for (const position of neighbors) neighborPositions.set(position.join(','), position);
    return [
      Object.freeze({
        position: Object.freeze([state.x, state.y, state.z]) as [number, number, number],
        activate:
          isFluidVoxel(state.voxel) ||
          isFluidVoxel(value) ||
          neighbors.some((position) => isFluidVoxel(nextVoxel(...position) ?? 0)),
        removeSource: Boolean(state.cell?.source && !isFluidVoxel(value)),
      }),
    ];
  });
  const neighborReads = Object.freeze(
    [...neighborPositions.values()].map((position) => Object.freeze({ position, voxel: peekVoxel(...position) })),
  );
  const editedPositions = Object.freeze(effects.map(({ position }) => position));
  return Object.freeze({
    editedPositions,
    effects: Object.freeze(effects),
    validate() {
      if (neighborReads.some((entry) => peekVoxel(...entry.position) !== entry.voxel))
        throw new Error('Prepared adjacent fluid state is stale.');
    },
  });
}
