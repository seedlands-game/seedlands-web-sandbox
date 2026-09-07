import type {
  DedicatedComputeResult,
  DedicatedComputeTask,
} from '@seedlands/game-core/server/compute/dedicated-compute-contract';

export type NodeComputeRequest = Readonly<{
  kind: 'run-dedicated-compute';
  task: DedicatedComputeTask;
  resourceGeneration: number;
  maxResultBytes: number;
}>;

export type NodeComputeResponse =
  | Readonly<{
      kind: 'dedicated-compute-result';
      epoch: string;
      taskId: number;
      generation: number;
      resourceGeneration: number;
      ok: true;
      result: DedicatedComputeResult;
    }>
  | Readonly<{
      kind: 'dedicated-compute-result';
      epoch: string;
      taskId: number;
      generation: number;
      resourceGeneration: number;
      ok: false;
      error: string;
    }>;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isTriple = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
const isTaskIdentity = (value: Record<string, unknown>): boolean =>
  typeof value.epoch === 'string' &&
  value.epoch.length > 0 &&
  isNonNegativeInteger(value.taskId) &&
  isNonNegativeInteger(value.generation) &&
  value.generation > 0 &&
  isNonNegativeInteger(value.estimatedBytes);
const isDedicatedComputeTask = (value: unknown): value is DedicatedComputeTask => {
  if (!isRecord(value) || !isTaskIdentity(value)) return false;
  if (value.kind === 'generate-canonical')
    return (
      typeof value.key === 'string' &&
      isFiniteNumber(value.seed) &&
      isNonNegativeInteger(value.generatorVersion) &&
      isFiniteNumber(value.cx) &&
      isFiniteNumber(value.cy) &&
      isFiniteNumber(value.cz)
    );
  if (value.kind === 'find-safe-spawn')
    return isFiniteNumber(value.seed) && isNonNegativeInteger(value.generatorVersion);
  if (value.kind === 'fluid')
    return (
      isRecord(value.snapshot) &&
      isFiniteNumber(value.snapshot.epoch) &&
      typeof value.snapshot.workId === 'string' &&
      Array.isArray(value.snapshot.frontier) &&
      Array.isArray(value.snapshot.chunks)
    );
  return (
    value.kind === 'logic' &&
    isRecord(value.observation) &&
    typeof value.observation.epoch === 'string' &&
    isNonNegativeInteger(value.observation.observationSequence) &&
    (value.physicsHz === 30 || value.physicsHz === 60 || value.physicsHz === 120)
  );
};
const isResult = (value: unknown): value is DedicatedComputeResult => {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'canonical-result')
    return (
      value.voxels instanceof ArrayBuffer &&
      value.voxels.byteLength > 0 &&
      typeof value.key === 'string' &&
      isFiniteNumber(value.cx) &&
      isFiniteNumber(value.cy) &&
      isFiniteNumber(value.cz) &&
      isNonNegativeInteger(value.generatorVersion) &&
      value.chunkRevision === 0
    );
  if (value.kind === 'safe-spawn-result')
    return (
      isTriple(value.playerBodyPosition) &&
      Array.isArray(value.starterChunks) &&
      value.starterChunks.every(
        (chunk) =>
          isRecord(chunk) &&
          typeof chunk.key === 'string' &&
          isFiniteNumber(chunk.cx) &&
          isFiniteNumber(chunk.cy) &&
          isFiniteNumber(chunk.cz) &&
          chunk.chunkRevision === 0 &&
          isNonNegativeInteger(chunk.generatorVersion) &&
          chunk.canonical instanceof ArrayBuffer &&
          chunk.canonical.byteLength > 0,
      )
    );
  if (value.kind === 'fluid-candidate')
    return (
      isRecord(value.candidate) &&
      isFiniteNumber(value.candidate.epoch) &&
      typeof value.candidate.workId === 'string' &&
      Array.isArray(value.candidate.readSet) &&
      Array.isArray(value.candidate.writes)
    );
  return (
    value.kind === 'logic-intents' &&
    isRecord(value.batch) &&
    typeof value.batch.epoch === 'string' &&
    isNonNegativeInteger(value.batch.observationSequence) &&
    isNonNegativeInteger(value.batch.expiresAtPhysicsTick) &&
    Array.isArray(value.batch.intents)
  );
};

export const isNodeComputeRequest = (value: unknown): value is NodeComputeRequest =>
  isRecord(value) &&
  value.kind === 'run-dedicated-compute' &&
  isDedicatedComputeTask(value.task) &&
  isNonNegativeInteger(value.resourceGeneration) &&
  isNonNegativeInteger(value.maxResultBytes);

export const isNodeComputeResponse = (value: unknown): value is NodeComputeResponse =>
  isRecord(value) &&
  value.kind === 'dedicated-compute-result' &&
  typeof value.epoch === 'string' &&
  isNonNegativeInteger(value.taskId) &&
  isNonNegativeInteger(value.generation) &&
  isNonNegativeInteger(value.resourceGeneration) &&
  typeof value.ok === 'boolean' &&
  (value.ok ? isResult(value.result) : typeof value.error === 'string' && value.error.length > 0);
