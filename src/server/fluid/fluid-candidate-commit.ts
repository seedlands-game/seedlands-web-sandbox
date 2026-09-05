import { CHUNK_SIZE, chunkKey, floorDiv, remeshChunkKeysForEdit } from '../../world/voxel';
import type { ServerChunk, WorldCommitResult } from '../game-server-types';
import { compareChunkKeys } from '../world-transaction-commit';
import type { FluidCandidate, FluidCellWrite } from './fluid-transaction';

const emptyResult = (worldRevision: number): WorldCommitResult => ({
  committed: false,
  worldRevision,
  structuralChange: null,
  semanticEvents: [],
  metrics: {
    timingStatus: 'not-collected-hot-path',
    inputMutationCount: 0,
    canonicalWriteCount: 0,
    dirtyChunkCount: 0,
    meshInvalidationCount: 0,
    structuralEventCount: 0,
    semanticEventCount: 0,
    mutationPayloadBytes: 0,
    mutationCapacityBytes: 0,
    validationMs: 0,
    resolveMs: 0,
    applyMs: 0,
    commitMs: 0,
  },
});

export function commitFluidCandidate(options: {
  candidate: FluidCandidate;
  chunks: Map<string, ServerChunk>;
  worldRevision: number;
  addMutationCount(count: number): void;
  setWorldRevision(revision: number): void;
}): WorldCommitResult {
  const writesByChunk = new Map<string, FluidCellWrite[]>();
  for (const write of options.candidate.writes) {
    const [x, y, z] = write.position;
    const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    const writes = writesByChunk.get(key) ?? [];
    writes.push(write);
    writesByChunk.set(key, writes);
  }
  const plans = [...writesByChunk]
    .map(([key, writes]) => ({ key, writes: writes.sort(compareWrites), chunk: options.chunks.get(key) }))
    .sort((left, right) => compareChunkKeys(left.key, right.key));
  if (!plans.length) return emptyResult(options.worldRevision);
  if (plans.some((plan) => !plan.chunk)) throw new Error('Accepted fluid candidate references an unloaded chunk.');
  const worldRevision = options.worldRevision + 1;
  const meshChunks = new Set<string>();
  let min: [number, number, number] | null = null;
  let max: [number, number, number] | null = null;
  for (const { writes } of plans)
    for (const { position } of writes) {
      const [x, y, z] = position;
      remeshChunkKeysForEdit(x, y, z).forEach((key) => meshChunks.add(key));
      min = min ? [Math.min(min[0], x), Math.min(min[1], y), Math.min(min[2], z)] : [x, y, z];
      max = max ? [Math.max(max[0], x), Math.max(max[1], y), Math.max(max[2], z)] : [x, y, z];
    }
  for (const { writes, chunk } of plans) {
    for (const write of writes) {
      const [x, y, z] = write.position;
      const index =
        x -
        chunk!.cx * CHUNK_SIZE +
        (z - chunk!.cz * CHUNK_SIZE) * CHUNK_SIZE +
        (y - chunk!.cy * CHUNK_SIZE) * CHUNK_SIZE ** 2;
      chunk!.voxels[index] = write.voxel;
      chunk!.fluid[index] = write.fluid;
    }
    chunk!.revision += 1;
    chunk!.dirty = true;
    chunk!.materialized = true;
  }
  options.setWorldRevision(worldRevision);
  options.addMutationCount(options.candidate.writes.length);
  return {
    committed: true,
    worldRevision,
    structuralChange: {
      type: 'voxel-region-changed',
      actorId: 'fluid-v2',
      worldRevision,
      mutationCount: options.candidate.writes.length,
      chunks: plans.map((plan) => plan.key),
      chunkRevisions: plans.map((plan) => ({ key: plan.key, revision: plan.chunk!.revision })),
      meshChunks: [...meshChunks].sort(compareChunkKeys),
      bounds: { min: min!, max: max! },
    },
    semanticEvents: [],
    metrics: {
      timingStatus: 'not-collected-hot-path',
      inputMutationCount: options.candidate.consumedFrontier.length,
      canonicalWriteCount: options.candidate.writes.length,
      dirtyChunkCount: plans.length,
      meshInvalidationCount: meshChunks.size,
      structuralEventCount: 1,
      semanticEventCount: 0,
      mutationPayloadBytes: options.candidate.writes.length * 18,
      mutationCapacityBytes: options.candidate.writes.length * 18,
      validationMs: 0,
      resolveMs: 0,
      applyMs: 0,
      commitMs: 0,
    },
  };
}

const compareWrites = (left: FluidCellWrite, right: FluidCellWrite) =>
  left.position[0] - right.position[0] || left.position[1] - right.position[1] || left.position[2] - right.position[2];
