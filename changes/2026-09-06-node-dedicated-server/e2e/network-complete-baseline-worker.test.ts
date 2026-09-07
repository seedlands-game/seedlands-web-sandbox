import { describe, expect, it, vi } from 'vitest';

const meshCalls = vi.hoisted(() => ({ makeChunk: 0, createProceduralMeshInput: 0 }));

vi.mock('../../../packages/game-core/src/world/mesh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packages/game-core/src/world/mesh')>();
  return {
    ...actual,
    makeChunk: (...args: Parameters<typeof actual.makeChunk>) => {
      meshCalls.makeChunk += 1;
      return actual.makeChunk(...args);
    },
    createProceduralMeshInput: (...args: Parameters<typeof actual.createProceduralMeshInput>) => {
      meshCalls.createProceduralMeshInput += 1;
      return actual.createProceduralMeshInput(...args);
    },
  };
});

import {
  createWorkerFirstDispatch,
  type AuthorityCompleteWorkerInput,
  type MeshDispatchRequest,
  type WorkerInput,
} from '../../../apps/web/src/app/world/mesh-task-dispatch';
import { CHUNK_SIZE, Voxel, chunkKey } from '../../../packages/game-core/src/world/voxel';
import { validateAuthorityCompleteMeshInput } from '../../../packages/game-core/src/worker/authority-complete-mesh-input';
import {
  runWorldComputeTask,
  type GenerateMeshTaskPayload,
} from '../../../packages/game-core/src/worker/world-compute-task';

const canonicalBytes = CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT;
const fluidBytes = CHUNK_SIZE ** 3;

const request: MeshDispatchRequest = {
  traceId: 'authority-complete-worker',
  epoch: 8,
  chunkKey: '0,0,0',
  cx: 0,
  cy: 0,
  cz: 0,
  priority: 'interactive',
};

const resetMeshCalls = () => {
  meshCalls.makeChunk = 0;
  meshCalls.createProceduralMeshInput = 0;
};

const completeInput = (): AuthorityCompleteWorkerInput => {
  const canonical = new Uint16Array(CHUNK_SIZE ** 3);
  canonical[0] = Voxel.Stone;
  const overlays = [] as {
    cx: number;
    cy: number;
    cz: number;
    voxels: Uint16Array;
    fluid: Uint8Array;
  }[];
  for (let cy = -1; cy <= 1; cy += 1)
    for (let cz = -1; cz <= 1; cz += 1)
      for (let cx = -1; cx <= 1; cx += 1) {
        if (cx === 0 && cy === 0 && cz === 0) continue;
        overlays.push({
          cx,
          cy,
          cz,
          voxels: new Uint16Array(CHUNK_SIZE ** 3),
          fluid: new Uint8Array(CHUNK_SIZE ** 3),
        });
      }
  return {
    inputStrategy: 'authority-complete',
    chunkRevision: 12,
    generatorVersion: 3,
    haloRevision: 'authority:0,0,0:12:complete',
    canonical,
    fluid: new Uint8Array(CHUNK_SIZE ** 3),
    overlays,
  };
};

const taskFor = (input: WorkerInput): GenerateMeshTaskPayload => {
  const dispatch = createWorkerFirstDispatch(47, request, 19, input);
  return dispatch.message as unknown as GenerateMeshTaskPayload;
};

const mutateTask = (
  task: GenerateMeshTaskPayload,
  mutate: (value: Record<string, unknown>) => void,
): GenerateMeshTaskPayload => {
  const value = structuredClone(task) as Record<string, unknown>;
  mutate(value);
  return value as unknown as GenerateMeshTaskPayload;
};

describe('authority-complete worker mesh input', () => {
  it('保留完整版本向量，传输全部54个独有块，并且真实网格路径没有程序化回退', async () => {
    const input = completeInput();
    const dispatch = createWorkerFirstDispatch(47, request, 19, input);
    const task = dispatch.task;
    expect(task.haloRevision).toBe(input.haloRevision);
    expect(dispatch.message.haloRevision).toBe(input.haloRevision);
    expect(dispatch.transfers).toHaveLength(54);
    expect(new Set(dispatch.transfers)).toHaveLength(54);

    resetMeshCalls();
    const result = await runWorldComputeTask(dispatch.message as unknown as GenerateMeshTaskPayload);
    expect(result).toMatchObject({
      kind: 'mesh-result',
      haloRevision: input.haloRevision,
      authorityComplete: true,
      proceduralVoxelSamples: 0,
      macroContextCount: 0,
    });
    expect(meshCalls.makeChunk).toBe(0);
    expect(meshCalls.createProceduralMeshInput).toBe(1);
  });

  it.each([
    ['缺中心 canonical', (value: Record<string, unknown>) => delete value.canonical],
    ['缺中心 fluid', (value: Record<string, unknown>) => delete value.fluid],
    [
      '缺 overlay canonical',
      (value: Record<string, unknown>) => delete (value.overlays as Record<string, unknown>[])[0].voxels,
    ],
    [
      '缺 overlay fluid',
      (value: Record<string, unknown>) => delete (value.overlays as Record<string, unknown>[])[0].fluid,
    ],
    [
      '重复 overlay 坐标',
      (value: Record<string, unknown>) => {
        const overlays = value.overlays as Record<string, unknown>[];
        overlays[1].cx = overlays[0].cx;
        overlays[1].cy = overlays[0].cy;
        overlays[1].cz = overlays[0].cz;
      },
    ],
    [
      '中心混入 overlay',
      (value: Record<string, unknown>) => {
        const overlay = (value.overlays as Record<string, unknown>[])[0];
        overlay.cx = 0;
        overlay.cy = 0;
        overlay.cz = 0;
      },
    ],
    [
      '错误 overlay 坐标',
      (value: Record<string, unknown>) => {
        (value.overlays as Record<string, unknown>[])[0].cx = 2;
      },
    ],
    [
      '稀疏 overlay',
      (value: Record<string, unknown>) => {
        const overlays = value.overlays as Record<string, unknown>[];
        delete overlays[3];
      },
    ],
    [
      '错误 canonical 长度',
      (value: Record<string, unknown>) => {
        value.canonical = new ArrayBuffer(canonicalBytes - 2);
      },
    ],
    [
      '错误 overlay fluid 长度',
      (value: Record<string, unknown>) => {
        (value.overlays as Record<string, unknown>[])[0].fluid = new ArrayBuffer(fluidBytes - 1);
      },
    ],
    ['空 overlay 集合', (value: Record<string, unknown>) => (value.overlays = [])],
    [
      '重复 block buffer',
      (value: Record<string, unknown>) => {
        const overlays = value.overlays as Record<string, unknown>[];
        overlays[0].voxels = value.canonical;
      },
    ],
    ['空版本向量', (value: Record<string, unknown>) => (value.haloRevision = '')],
    ['不安全中心坐标', (value: Record<string, unknown>) => (value.cx = Number.MAX_SAFE_INTEGER)],
    ['非法 generatorVersion', (value: Record<string, unknown>) => (value.generatorVersion = 0)],
    ['非法 chunkRevision', (value: Record<string, unknown>) => (value.chunkRevision = Number.MAX_SAFE_INTEGER + 1)],
    ['未知输入策略', (value: Record<string, unknown>) => (value.inputStrategy = 'authority-complet')],
  ])('在%s时于生产入口拒绝而不调用生成或 halo 构建', async (_name, mutate) => {
    const task = mutateTask(taskFor(completeInput()), mutate);
    resetMeshCalls();
    await expect(runWorldComputeTask(task)).rejects.toThrow();
    expect(meshCalls.makeChunk).toBe(0);
    expect(meshCalls.createProceduralMeshInput).toBe(0);
  });

  it('仅校验完整输入时允许中心的安全 ±1 邻接抵达最大安全整数', () => {
    const task = mutateTask(taskFor(completeInput()), (value) => {
      const cx = Number.MAX_SAFE_INTEGER - 1;
      value.cx = cx;
      value.chunkKey = chunkKey(cx, 0, 0);
      for (const overlay of value.overlays as Record<string, unknown>[]) overlay.cx = cx + (overlay.cx as number);
    });
    expect(() => validateAuthorityCompleteMeshInput(task)).not.toThrow();
  });

  it('继续接受未声明策略的旧 local 输入', async () => {
    const result = await runWorldComputeTask({
      kind: 'generate-mesh',
      traceId: 'legacy',
      epoch: 0,
      chunkKey: chunkKey(0, 0, 0),
      seed: 1,
      cx: 0,
      cy: 0,
      cz: 0,
      chunkRevision: 0,
      haloRevision: 'worker-input-1',
      generatorVersion: 3,
      canonical: new ArrayBuffer(canonicalBytes),
      fluid: new ArrayBuffer(fluidBytes),
      overlays: [],
    });
    expect(result.kind).toBe('mesh-result');
    expect(result).not.toHaveProperty('authorityComplete');
  });
});
