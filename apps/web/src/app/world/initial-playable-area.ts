import { COLLISION_EPSILON } from '@seedlands/game-core/physics/geometry';
import { CHUNK_SIZE, chunkKey, floorDiv } from '@seedlands/game-core/world/voxel';
import type { MeshTaskScheduler } from './mesh-task-scheduler';

type Position = Readonly<{ x: number; y: number; z: number }>;
type InitialChunk = Readonly<{ key: string; cx: number; cy: number; cz: number }>;
type InitialRepository = Readonly<{
  chunks: ReadonlyMap<string, unknown>;
  queueSize: number;
}>;

export type InitialPlayableAreaDiagnostics = Readonly<{
  requiredChunks: number;
  completedChunks: number;
  queuedRequests: number;
  preparingRequests: number;
  failedPreparations: number;
  meshingRequests: number;
  uploadQueue: number;
  baselineRequests?: readonly Readonly<Record<string, number | string>>[];
  baselineReassembler?: Readonly<Record<string, number>>;
}>;

const initialPlayableChunks = (position: Position, horizontalRadius: number): InitialChunk[] => {
  const centerX = floorDiv(position.x, CHUNK_SIZE);
  const centerY = floorDiv(position.y - COLLISION_EPSILON, CHUNK_SIZE);
  const centerZ = floorDiv(position.z, CHUNK_SIZE);
  const required: InitialChunk[] = [];
  for (let cz = centerZ - horizontalRadius; cz <= centerZ + horizontalRadius; cz += 1)
    for (let cx = centerX - horizontalRadius; cx <= centerX + horizontalRadius; cx += 1)
      required.push({ key: chunkKey(cx, centerY, cz), cx, cy: centerY, cz });
  return required;
};

export function prioritizeInitialPlayableArea(
  scheduler: MeshTaskScheduler,
  position: Position,
  horizontalRadius: number,
): void {
  for (const { cx, cy, cz } of initialPlayableChunks(position, horizontalRadius))
    scheduler.request(cx, cy, cz, { priority: 'interactive' });
}

export function initialPlayableAreaDiagnostics(
  scheduler: MeshTaskScheduler,
  repository: InitialRepository,
  position: Position,
  horizontalRadius: number,
  baselineDiagnostics?: Readonly<{
    requests: readonly Readonly<Record<string, number | string>>[];
    reassembler: Readonly<Record<string, number>>;
  }>,
): InitialPlayableAreaDiagnostics {
  const required = initialPlayableChunks(position, horizontalRadius);
  return {
    requiredChunks: required.length,
    completedChunks: required.filter(({ key }) => repository.chunks.has(key)).length,
    ...scheduler.schedulingDiagnostics,
    meshingRequests: scheduler.meshingQueueSize,
    uploadQueue: repository.queueSize,
    ...(baselineDiagnostics
      ? {
          baselineRequests: baselineDiagnostics.requests,
          baselineReassembler: baselineDiagnostics.reassembler,
        }
      : {}),
  };
}

export async function waitForInitialPlayableArea(
  scheduler: MeshTaskScheduler,
  repository: InitialRepository,
  isDisposed: () => boolean,
  position: Position,
  horizontalRadius: number,
): Promise<void> {
  prioritizeInitialPlayableArea(scheduler, position, horizontalRadius);
  const required = initialPlayableChunks(position, horizontalRadius);
  while (!isDisposed() && required.some(({ key }) => !repository.chunks.has(key)))
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  if (isDisposed()) throw new Error('初始可玩区域加载已取消。');
}
