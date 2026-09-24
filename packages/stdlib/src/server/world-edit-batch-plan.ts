import {
  CHUNK_SIZE,
  chunkKey,
  floorDiv,
  mod,
  remeshChunkKeysForEdit,
  voxelIndex,
  type ChunkCoord,
} from '../world/voxel';
import { isFluidVoxel } from './fluid/fluid-cell-state';
import type {
  ServerChunk,
  VoxelRegionChanged,
  WorldCommitResult,
  WorldSemanticEvent,
  WorldSemanticEventInput,
} from './game-server-types';
import { assertMutationCoordinate, assertVoxelValue, type VoxelEdit } from './world-mutation';

export type ExpectedWorldVoxelEdit = VoxelEdit & Readonly<{ expectedVoxel: number; expectedFluid: number }>;
export const MAX_WORLD_EDIT_BATCH_EDITS = 65_536;

export function assertWorldEditBatchCardinality(edits: readonly unknown[]): void {
  if (edits.length > MAX_WORLD_EDIT_BATCH_EDITS)
    throw new RangeError(`World edit batch exceeds the ${MAX_WORLD_EDIT_BATCH_EDITS} object edit limit.`);
}

export type PreparedWorldEditBatch = Readonly<{
  committed: boolean;
  result: WorldCommitResult;
  validate(): void;
  apply(): WorldCommitResult;
}>;
export type PreparedWorldCommitMetadata = Readonly<{ validate(): void; apply(): void }>;

export type CanonicalWorldEditBatchPlan = PreparedWorldEditBatch &
  Readonly<{ measuredResult(applyFinishedAt: number): WorldCommitResult }>;

export type WorldEditBatchPlanState = Readonly<{
  getChunk(cx: number, cy: number, cz: number): ServerChunk | undefined;
  getRevision(): number;
  prepareCommitMetadata(worldRevision: number, mutationCount: number): PreparedWorldCommitMetadata;
  isVoxelRegistered?: (value: number) => boolean;
}>;

type PlannedCell = Readonly<{
  index: number;
  x: number;
  y: number;
  z: number;
  previousVoxel: number;
  previousFluid: number;
  voxel: number;
  fluid: number;
}>;

type PlannedChunk = Readonly<
  ChunkCoord & {
    key: string;
    chunk: ServerChunk;
    revision: number;
    voxels: Uint16Array;
    fluid: Uint8Array;
    observed: readonly Readonly<{ index: number; voxel: number; fluid: number }>[];
    changes: readonly PlannedCell[];
  }
>;

export const compareChunkCoordinates = (left: ChunkCoord, right: ChunkCoord): number =>
  left.cx < right.cx
    ? -1
    : left.cx > right.cx
      ? 1
      : left.cy < right.cy
        ? -1
        : left.cy > right.cy
          ? 1
          : left.cz < right.cz
            ? -1
            : left.cz > right.cz
              ? 1
              : 0;

const coordinatesFromChunkKey = (key: string): ChunkCoord => {
  const [cx, cy, cz] = key.split(',').map(Number);
  return { cx, cy, cz };
};

export const compareChunkKeys = (left: string, right: string): number =>
  compareChunkCoordinates(coordinatesFromChunkKey(left), coordinatesFromChunkKey(right));

export const buildWorldEditBatchResult = (
  worldRevision: number,
  input: Readonly<{
    startedAt: number;
    validationFinishedAt: number;
    resolveFinishedAt: number;
    applyFinishedAt: number;
    inputMutationCount: number;
    mutationPayloadBytes?: number;
    mutationCapacityBytes?: number;
    timingStatus?: WorldCommitResult['metrics']['timingStatus'];
    structuralChange: VoxelRegionChanged | null;
    semanticEvents: readonly WorldSemanticEvent[];
    collisionDelta: NonNullable<WorldCommitResult['collisionDelta']>;
  }>,
): WorldCommitResult => ({
  committed: input.structuralChange !== null || input.semanticEvents.length > 0,
  worldRevision,
  structuralChange: input.structuralChange,
  semanticEvents: input.semanticEvents,
  ...(input.collisionDelta.length ? { collisionDelta: input.collisionDelta } : {}),
  metrics: {
    timingStatus: input.timingStatus ?? 'measured',
    inputMutationCount: input.inputMutationCount,
    canonicalWriteCount: input.structuralChange?.mutationCount ?? 0,
    dirtyChunkCount: input.structuralChange?.chunks.length ?? 0,
    meshInvalidationCount: input.structuralChange?.meshChunks.length ?? 0,
    structuralEventCount: input.structuralChange ? 1 : 0,
    semanticEventCount: input.semanticEvents.length,
    mutationPayloadBytes: input.mutationPayloadBytes ?? input.inputMutationCount * 14,
    mutationCapacityBytes: input.mutationCapacityBytes ?? input.inputMutationCount * 14,
    validationMs: input.timingStatus === 'not-collected-hot-path' ? 0 : input.validationFinishedAt - input.startedAt,
    resolveMs:
      input.timingStatus === 'not-collected-hot-path' ? 0 : input.resolveFinishedAt - input.validationFinishedAt,
    applyMs: input.timingStatus === 'not-collected-hot-path' ? 0 : input.applyFinishedAt - input.resolveFinishedAt,
    commitMs: input.timingStatus === 'not-collected-hot-path' ? 0 : input.applyFinishedAt - input.startedAt,
  },
});

const validateEdit = (edit: VoxelEdit, isRegistered?: (value: number) => boolean): void => {
  for (const coordinate of [edit.x, edit.y, edit.z]) assertMutationCoordinate(coordinate);
  assertVoxelValue(edit.value, isRegistered);
};

const freezeReceipt = (value: unknown): void => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeReceipt(child);
  Object.freeze(value);
};

const assertExactDenseArray = (value: readonly unknown[], label: string): void => {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const keys = Reflect.ownKeys(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key));
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index)))
    throw new TypeError(`${label} must be dense and cannot contain extra enumerable properties.`);
};

export function prepareWorldEditBatchPlan(
  state: WorldEditBatchPlanState,
  input: Readonly<{
    actorId: string;
    edits: readonly VoxelEdit[];
    expected?: readonly ExpectedWorldVoxelEdit[];
    semanticEvents?: readonly WorldSemanticEventInput[];
  }>,
  now: () => number,
): CanonicalWorldEditBatchPlan {
  const startedAt = now();
  if (!input.actorId.trim()) throw new TypeError('World edit actorId must not be empty.');
  assertWorldEditBatchCardinality(input.edits);
  if (input.expected) {
    assertExactDenseArray(input.edits, 'Prepared world edits');
    assertExactDenseArray(input.expected, 'Expected world edits');
  }
  const semanticInputs = input.semanticEvents ?? [];
  for (const event of semanticInputs) {
    if (!event.type.trim()) throw new TypeError('Semantic event type must not be empty.');
    if (!event.subjectId.trim()) throw new TypeError('Semantic event subjectId must not be empty.');
  }
  let inputMutationCount = 0;
  input.edits.forEach((edit) => {
    inputMutationCount += 1;
    validateEdit(edit, state.isVoxelRegistered);
  });
  const expected = new Map<string, ExpectedWorldVoxelEdit>();
  for (const edit of input.expected ?? []) {
    validateEdit(edit, state.isVoxelRegistered);
    assertVoxelValue(edit.expectedVoxel, state.isVoxelRegistered);
    if (!Number.isSafeInteger(edit.expectedFluid) || edit.expectedFluid < 0 || edit.expectedFluid > 255)
      throw new RangeError('Expected world fluid must be a Uint8 value.');
    const key = `${edit.x},${edit.y},${edit.z}`;
    if (expected.has(key)) throw new TypeError(`Expected world edits contain a duplicate position: ${key}`);
    expected.set(key, edit);
  }
  if (input.expected && expected.size !== input.edits.length)
    throw new TypeError('Expected world edits must cover every canonical edit exactly once.');

  const finalEdits = new Map<string, VoxelEdit>();
  input.edits.forEach((edit) => finalEdits.set(`${edit.x},${edit.y},${edit.z}`, edit));
  if (input.expected && finalEdits.size !== input.edits.length)
    throw new TypeError('Prepared world edits must use unique positions.');
  if (
    input.expected &&
    [...finalEdits].some(([key, edit]) => !expected.has(key) || expected.get(key)!.value !== edit.value)
  )
    throw new TypeError('Expected world edits must match every canonical edit.');
  const validationFinishedAt = now();

  const byChunk = new Map<string, { cx: number; cy: number; cz: number; edits: VoxelEdit[] }>();
  for (const edit of finalEdits.values()) {
    const cx = floorDiv(edit.x, CHUNK_SIZE),
      cy = floorDiv(edit.y, CHUNK_SIZE),
      cz = floorDiv(edit.z, CHUNK_SIZE),
      key = chunkKey(cx, cy, cz);
    const plan = byChunk.get(key) ?? { cx, cy, cz, edits: [] };
    plan.edits.push(edit);
    byChunk.set(key, plan);
  }

  const chunks: PlannedChunk[] = [...byChunk.entries()]
    .map(([key, source]) => {
      const chunk = state.getChunk(source.cx, source.cy, source.cz);
      if (!chunk) throw new Error(`World edit chunk is unavailable: ${key}`);
      if (chunk.key !== key || chunk.voxels.length !== CHUNK_SIZE ** 3 || chunk.fluid.length !== CHUNK_SIZE ** 3)
        throw new TypeError(`World edit chunk identity is invalid: ${key}`);
      const observed = source.edits
        .map((edit) => {
          const index = voxelIndex(mod(edit.x, CHUNK_SIZE), mod(edit.y, CHUNK_SIZE), mod(edit.z, CHUNK_SIZE));
          const previousVoxel = chunk.voxels[index]!,
            previousFluid = chunk.fluid[index]!;
          const expectation = expected.get(`${edit.x},${edit.y},${edit.z}`);
          if (expectation && expectation.expectedVoxel !== previousVoxel)
            throw new Error(`World edit expected voxel is stale: ${edit.x},${edit.y},${edit.z}`);
          if (expectation && expectation.expectedFluid !== previousFluid)
            throw new Error(`World edit expected fluid is stale: ${edit.x},${edit.y},${edit.z}`);
          return Object.freeze({ index, voxel: previousVoxel, fluid: previousFluid });
        })
        .sort((left, right) => left.index - right.index);
      const editsByIndex = new Map(
        source.edits.map((edit) => [
          voxelIndex(mod(edit.x, CHUNK_SIZE), mod(edit.y, CHUNK_SIZE), mod(edit.z, CHUNK_SIZE)),
          edit,
        ]),
      );
      const changes = observed.flatMap(({ index, voxel: previousVoxel, fluid: previousFluid }) => {
        const edit = editsByIndex.get(index)!;
        const fluid = isFluidVoxel(edit.value) ? 0x88 : 0;
        return previousVoxel === edit.value
          ? []
          : [
              Object.freeze({
                index,
                x: edit.x,
                y: edit.y,
                z: edit.z,
                previousVoxel,
                previousFluid,
                voxel: edit.value,
                fluid,
              }),
            ];
      });
      return Object.freeze({
        key,
        cx: source.cx,
        cy: source.cy,
        cz: source.cz,
        chunk,
        revision: chunk.revision,
        voxels: chunk.voxels,
        fluid: chunk.fluid,
        observed: Object.freeze(observed),
        changes: Object.freeze(changes),
      });
    })
    .sort(compareChunkCoordinates);

  const changed = chunks.filter((chunk) => chunk.changes.length > 0);
  const changes = changed.flatMap((chunk) => chunk.changes);
  const worldRevision = state.getRevision();
  if (
    !Number.isSafeInteger(worldRevision) ||
    worldRevision < 0 ||
    ((changes.length || semanticInputs.length) && worldRevision >= Number.MAX_SAFE_INTEGER)
  )
    throw new RangeError('World edit revision capacity is exhausted or invalid.');
  for (const chunk of changed)
    if (!Number.isSafeInteger(chunk.revision) || chunk.revision < 0 || chunk.revision >= Number.MAX_SAFE_INTEGER)
      throw new RangeError(`World edit Chunk revision capacity is exhausted or invalid: ${chunk.key}`);
  const nextRevision = changes.length || semanticInputs.length ? worldRevision + 1 : worldRevision;
  const meshChunks = new Set<string>();
  let min: [number, number, number] | null = null,
    max: [number, number, number] | null = null;
  for (const change of changes) {
    remeshChunkKeysForEdit(change.x, change.y, change.z).forEach((key) => meshChunks.add(key));
    min = min
      ? [Math.min(min[0], change.x), Math.min(min[1], change.y), Math.min(min[2], change.z)]
      : [change.x, change.y, change.z];
    max = max
      ? [Math.max(max[0], change.x), Math.max(max[1], change.y), Math.max(max[2], change.z)]
      : [change.x, change.y, change.z];
  }
  const structuralChange: VoxelRegionChanged | null = changes.length
    ? {
        type: 'voxel-region-changed',
        actorId: input.actorId,
        worldRevision: nextRevision,
        mutationCount: changes.length,
        chunks: changed.map(({ key }) => key),
        chunkRevisions: changed.map(({ key, revision }) => ({ key, revision: revision + 1 })),
        meshChunks: [...meshChunks].sort(compareChunkKeys),
        bounds: { min: min!, max: max! },
      }
    : null;
  const resolveFinishedAt = now();
  const receipt = buildWorldEditBatchResult(nextRevision, {
    startedAt,
    validationFinishedAt,
    resolveFinishedAt,
    applyFinishedAt: resolveFinishedAt,
    inputMutationCount,
    timingStatus: 'not-collected-hot-path',
    structuralChange,
    semanticEvents: semanticInputs.map((event) => ({ ...event, worldRevision: nextRevision })),
    collisionDelta: changed.map(({ key, revision, changes: cells }) => ({
      key,
      previousRevision: revision,
      revision: revision + 1,
      cells: cells.map(({ index, voxel, fluid }) => ({ index, voxel, fluid })),
    })),
  });
  if (input.expected) freezeReceipt(receipt);
  const measuredResult = (applyFinishedAt: number) =>
    buildWorldEditBatchResult(nextRevision, {
      startedAt,
      validationFinishedAt,
      resolveFinishedAt,
      applyFinishedAt,
      inputMutationCount,
      structuralChange,
      semanticEvents: receipt.semanticEvents,
      collisionDelta: receipt.collisionDelta ?? [],
    });
  const metadata = receipt.committed ? state.prepareCommitMetadata(receipt.worldRevision, changes.length) : undefined;

  let validated = false,
    used = false;
  const validate = () => {
    validated = false;
    if (used || state.getRevision() !== worldRevision) throw new Error('Prepared world edit batch is stale.');
    for (const plan of chunks) {
      const current = state.getChunk(plan.cx, plan.cy, plan.cz);
      if (
        current !== plan.chunk ||
        current.revision !== plan.revision ||
        current.voxels !== plan.voxels ||
        current.fluid !== plan.fluid
      )
        throw new Error(`Prepared world edit batch Chunk is stale: ${plan.key}`);
      for (const cell of plan.observed)
        if (current.voxels[cell.index] !== cell.voxel || current.fluid[cell.index] !== cell.fluid)
          throw new Error(`Prepared world edit batch cell is stale: ${plan.key}/${cell.index}`);
    }
    metadata?.validate();
    validated = true;
  };
  return Object.freeze({
    committed: receipt.committed,
    result: receipt,
    measuredResult,
    validate,
    apply() {
      if (!validated) throw new Error('Prepared world edit batch requires validation.');
      validate();
      used = true;
      metadata?.apply();
      for (const plan of changed) {
        for (const cell of plan.changes) {
          plan.voxels[cell.index] = cell.voxel;
          plan.fluid[cell.index] = cell.fluid;
        }
        plan.chunk.revision = plan.revision + 1;
        plan.chunk.dirty = true;
        plan.chunk.materialized = true;
      }
      return receipt;
    },
  });
}
