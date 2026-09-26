import { chunkKey } from '../world/voxel';
import type { ServerChunk, WorldCommitResult, WorldEditBatch } from './game-server-types';
import {
  commitWorldEditBatch,
  prepareWorldEditBatch,
  type ExpectedWorldVoxelEdit,
  type PreparedWorldEditBatch,
} from './world-transaction-commit';
import { prepareSingleWorldEdit, type PreparedWorldEdit } from './prepared-world-edit';
import * as FluidSidecars from './fluid/fluid-edit-sidecars';
import type { FluidChunkAccess } from './fluid/fluid-chunk-access';
import type { FluidActiveWindow } from './fluid/fluid-active-window';
import type { FluidTransactionRuntime } from './fluid/fluid-transaction-runtime';
import type { FluidActivationPriority } from './fluid/fluid-transaction';
import { assertWorldEditBatchCardinality } from './world-edit-batch-plan';

type WorldEditRuntimeOptions = Readonly<{
  chunks: ReadonlyMap<string, ServerChunk>;
  getChunk(cx: number, cy: number, cz: number): ServerChunk;
  getVoxel(x: number, y: number, z: number): number;
  getRevision(): number;
  setRevision(revision: number): void;
  addMutationCount(count: number): void;
  prepareCommitMetadata: import('./world-edit-batch-plan').WorldEditBatchPlanState['prepareCommitMetadata'];
  commitSingleEdit(actorId: string, x: number, y: number, z: number, value: number): WorldCommitResult;
  now(): number;
  fluidChunks: FluidChunkAccess;
  fluidWindow: FluidActiveWindow;
  fluidRuntime: FluidTransactionRuntime<WorldCommitResult>;
  priorityForBatch(batch: WorldEditBatch): FluidActivationPriority;
  isVoxelRegistered?: (value: number) => boolean;
}>;

export function commitServerWorldEdit(options: WorldEditRuntimeOptions, batch: WorldEditBatch): WorldCommitResult {
  if (batch.edits) assertWorldEditBatchCardinality(batch.edits);
  const previousFluid = FluidSidecars.captureBatchFluidState(batch, {
    getVoxel: options.getVoxel,
    getCell: (x, y, z) => options.fluidChunks.cell(x, y, z, true),
  });
  const finalValues = FluidSidecars.captureBatchFinalValues(batch);
  const preparedEffects = prepareFluidEffects(options, batch, finalValues, previousFluid);
  preparedEffects.validate();
  const result = commitWorldEditBatch(options, batch, options.now);
  if (result.committed) preparedEffects.apply();
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
      prepareCommitMetadata: options.prepareCommitMetadata,
      isVoxelRegistered: options.isVoxelRegistered,
    },
    { actorId, x, y, z, value },
  );
  const previous = FluidSidecars.captureBatchFluidState(
    { actorId, edits: [{ x, y, z, value }] },
    {
      getVoxel: options.getVoxel,
      getCell: (a, b, c) => options.fluidChunks.cell(a, b, c, true),
    },
  );
  const effects = prepareFluidEffects(
    options,
    { actorId, edits: [{ x, y, z, value }] },
    new Map([[`${x},${y},${z}`, value]]),
    previous,
  );
  let validated = false;
  const validate = () => {
    validated = false;
    base.validate();
    effects.validate();
    validated = true;
  };
  return Object.freeze({
    committed: base.committed,
    result: base.result,
    validate,
    apply() {
      if (!validated) throw new Error('Prepared world edit requires validation.');
      validate();
      const result = base.apply();
      if (result.committed) effects.apply();
      return result;
    },
  });
}

export function prepareServerWorldEditBatch(
  options: WorldEditRuntimeOptions,
  actorId: string,
  edits: readonly ExpectedWorldVoxelEdit[],
): PreparedWorldEditBatch {
  assertWorldEditBatchCardinality(edits);
  const batch = { actorId, edits: edits.map(({ x, y, z, value }) => ({ x, y, z, value })) };
  const base = prepareWorldEditBatch(
    { ...options, getChunk: (cx, cy, cz) => options.chunks.get(chunkKey(cx, cy, cz)) },
    actorId,
    edits,
    options.now,
  );
  const previousFluid = new Map(
    edits.map(({ x, y, z, expectedVoxel, expectedFluid }) => [
      `${x},${y},${z}`,
      {
        x,
        y,
        z,
        voxel: expectedVoxel,
        cell: expectedFluid ? { level: expectedFluid & 0x0f, source: Boolean(expectedFluid & 0x80) } : null,
      },
    ]),
  );
  const effects = prepareFluidEffects(options, batch, FluidSidecars.captureBatchFinalValues(batch), previousFluid);
  let validated = false,
    used = false;
  const validate = () => {
    validated = false;
    base.validate();
    effects.validate();
    validated = true;
  };
  return Object.freeze({
    committed: base.committed,
    result: base.result,
    validate,
    apply() {
      if (used || !validated) throw new Error('Prepared world edit batch requires validation.');
      validate();
      used = true;
      const result = base.apply();
      if (result.committed) effects.apply();
      return result;
    },
  });
}

function prepareFluidEffects(
  options: WorldEditRuntimeOptions,
  batch: WorldEditBatch,
  finalValues: ReadonlyMap<string, number>,
  previous: ReadonlyMap<string, FluidSidecars.PreviousFluidState>,
) {
  const priority = options.priorityForBatch(batch);
  const plan = FluidSidecars.prepareBatchFluidSidecarEffects(previous, finalValues, (x, y, z) =>
    options.fluidChunks.peekVoxel(x, y, z),
  );
  const window = options.fluidWindow.prepareEditedPositions(plan.editedPositions);
  const fluid = options.fluidRuntime.prepareEditEffects(plan.effects, priority);
  if (!plan.editedPositions.length && !plan.effects.length)
    return Object.freeze({ validate: plan.validate, apply() {} });
  return Object.freeze({
    validate() {
      plan.validate();
      window.validate();
      fluid.validate();
    },
    apply() {
      window.apply();
      fluid.apply();
    },
  });
}
