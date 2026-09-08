import { describe, expect, it, vi } from 'vitest';
import { World, waitForInitialWorldReady } from '../../apps/web/src/app/world/world-runtime';

describe('remote initial playable area barrier', () => {
  it.each([
    [32, '0,0,0'],
    [64, '0,1,0'],
  ])('uses the layer below an exact y=%i boundary and accepts a completed empty mesh', async (y, key) => {
    const chunks = new Map([[key, { task: { chunkRevision: 4 }, triangles: 0 }]]);
    const wait = World.prototype.waitForInitialPlayableArea as unknown as (
      this: Readonly<{
        repository: { waitForFirstVisible(): Promise<void>; chunks: typeof chunks };
        scheduler: { request: ReturnType<typeof vi.fn> };
        disposed: boolean;
      }>,
      position: Readonly<{ x: number; y: number; z: number }>,
      radius: number,
    ) => Promise<void>;
    const request = vi.fn();
    const world = Object.assign(Object.create(World.prototype) as object, {
      repository: { waitForFirstVisible: async () => undefined, chunks },
      scheduler: { request },
      disposed: false,
    });

    await expect(wait.call(world, { x: 0.5, y, z: 0.5 }, 0)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(0, Number(key.split(',')[1]), 0, { priority: 'interactive' });
  });

  it('请求脚下3x3为首屏优先级且合法空网格仍按已完成处理', async () => {
    const chunks = new Map<string, { task: { chunkRevision: number }; triangles: number }>();
    for (let z = -1; z <= 1; z += 1)
      for (let x = -1; x <= 1; x += 1) chunks.set(`${x},0,${z}`, { task: { chunkRevision: 1 }, triangles: 0 });
    const request = vi.fn();
    const wait = World.prototype.waitForInitialPlayableArea as unknown as (
      this: Readonly<{
        repository: { waitForFirstVisible(): Promise<void>; chunks: typeof chunks };
        scheduler: { request: typeof request };
        disposed: boolean;
      }>,
      position: Readonly<{ x: number; y: number; z: number }>,
      radius: number,
    ) => Promise<void>;

    await expect(
      Promise.race([
        wait.call(
          Object.assign(Object.create(World.prototype) as object, {
            repository: { waitForFirstVisible: () => new Promise<void>(() => undefined), chunks },
            scheduler: { request },
            disposed: false,
          }),
          { x: 0.5, y: 18, z: 0.5 },
          1,
        ),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('empty initial area stalled')), 25)),
      ]),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(9);
    expect(request.mock.calls.every((call) => call[3]?.priority === 'interactive')).toBe(true);
  });

  it('30秒首屏超时时调用只读诊断且保留原失败', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const diagnostics = vi.fn(() => ({ requiredChunks: 9, completedChunks: 4 }));
    try {
      const result = waitForInitialWorldReady(new Promise<void>(() => undefined), diagnostics);
      const rejected = expect(result).rejects.toThrow('初始区块加载超时，请重试。');
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      expect(diagnostics).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        JSON.stringify({ kind: 'initial-world-ready-timeout', requiredChunks: 9, completedChunks: 4 }),
      );
    } finally {
      consoleError.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('诊断异常也必须按原超时错误结算', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = waitForInitialWorldReady(new Promise<void>(() => undefined), () => {
        throw new Error('disposed world');
      });
      const rejected = expect(result).rejects.toThrow('初始区块加载超时，请重试。');
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      expect(consoleError).toHaveBeenCalledWith(
        JSON.stringify({ kind: 'initial-world-ready-timeout', diagnosticsUnavailable: true }),
      );
    } finally {
      consoleError.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('超时诊断只报告必需完成数和有界队列计数', () => {
    const chunks = new Map([['0,0,0', { task: { chunkRevision: 1 }, triangles: 0 }]]);
    const diagnostics = World.prototype.initialPlayableAreaDiagnostics as unknown as (
      this: Readonly<{
        authority: { initialBaselineDiagnostics(): readonly Readonly<Record<string, number | string>>[] };
        repository: { chunks: typeof chunks; queueSize: number };
        scheduler: {
          schedulingDiagnostics: { queuedRequests: number; preparingRequests: number; failedPreparations: number };
          meshingQueueSize: number;
        };
      }>,
      position: Readonly<{ x: number; y: number; z: number }>,
      radius: number,
    ) => Record<string, number>;
    const world = {
      authority: {
        initialBaselineDiagnostics: () => [
          { requestOrdinal: 1, state: 'pages', expectedPages: 81, receivedPages: 18, receivedBytes: 786_432 },
        ],
      },
      repository: { chunks, queueSize: 2 },
      scheduler: {
        schedulingDiagnostics: { queuedRequests: 5, preparingRequests: 1, failedPreparations: 3 },
        meshingQueueSize: 1,
      },
    };

    expect(diagnostics.call(world, { x: 0.5, y: 18, z: 0.5 }, 1)).toEqual({
      requiredChunks: 9,
      completedChunks: 1,
      queuedRequests: 5,
      preparingRequests: 1,
      failedPreparations: 3,
      meshingRequests: 1,
      uploadQueue: 2,
      baselineRequests: [
        { requestOrdinal: 1, state: 'pages', expectedPages: 81, receivedPages: 18, receivedBytes: 786_432 },
      ],
    });
  });
});
