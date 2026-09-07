import { describe, expect, it, vi } from 'vitest';
import type * as pc from 'playcanvas';
import { World } from '../../apps/web/src/app/world/world-runtime';
import {
  acceptStreamingCanonical,
  prepareStreamingNeighborhood,
  StreamingAdmissionRetry,
} from '../../apps/web/src/app/world/streaming-admission-retry';

describe('World streaming admission backpressure', () => {
  it('同一streaming中心在Authority解除背压后重新请求缺失Chunk且退避有界', () => {
    let now = 0;
    const retry = new StreamingAdmissionRetry(() => now);
    const request = vi.fn();
    const retryFailedPreparations = vi.fn();
    const world = {
      lastCenter: '',
      quality: { renderRadius: 0 },
      telemetryRecorder: { beginSpan: vi.fn(() => 1), endSpan: vi.fn() },
      authority: { setFluidActiveChunks: vi.fn(), releaseChunkNeighborhood: vi.fn() },
      repository: {
        chunks: new Map(),
        unload: vi.fn(),
      },
      scheduler: { requestedKeys: new Set<string>(), cancel: vi.fn(), retryFailedPreparations },
      dirtyChunks: new Set<string>(),
      request,
      streamingAdmissionRetry: retry,
    } as unknown as World;
    const position = { x: 0, z: 0 } as pc.Vec3;

    World.prototype.updateStreaming.call(world, position);
    expect(request).toHaveBeenCalledTimes(2);
    expect(retryFailedPreparations).toHaveBeenCalledTimes(1);
    World.prototype.updateStreaming.call(world, position);
    expect(request).toHaveBeenCalledTimes(2);

    retry.recordRetryableFailure();
    now = 99;
    World.prototype.updateStreaming.call(world, position);
    expect(request).toHaveBeenCalledTimes(2);
    now = 100;
    World.prototype.updateStreaming.call(world, position);
    expect(request).toHaveBeenCalledTimes(4);
    expect(retryFailedPreparations).toHaveBeenCalledTimes(2);

    for (let failure = 0; failure < 10; failure += 1) retry.recordRetryableFailure();
    expect(retry.retryAtMs! - now).toBeLessThanOrEqual(2_000);
  });

  it('Authority拒绝或抛错时都安排重试，合法接纳不制造额外重试', async () => {
    let now = 0;
    const retry = new StreamingAdmissionRetry(() => now);
    await expect(acceptStreamingCanonical(() => false, retry)).resolves.toBe(false);
    expect(retry.retryAtMs).toBe(100);
    retry.reset();
    await expect(acceptStreamingCanonical(() => true, retry)).resolves.toBe(true);
    expect(retry.retryAtMs).toBeNull();
    now = 10;
    await expect(
      acceptStreamingCanonical(() => Promise.reject(new Error('authority unavailable')), retry),
    ).rejects.toThrow('authority unavailable');
    expect(retry.retryAtMs).toBe(110);
  });

  it('Authority Mesh准备背压失败后按相同有界退避重试且成功不再延后', async () => {
    let now = 0;
    const retry = new StreamingAdmissionRetry(() => now);
    const prepare = vi.fn().mockRejectedValueOnce(new Error('canonical pressure')).mockResolvedValue(undefined);

    await expect(prepareStreamingNeighborhood(prepare, retry)).rejects.toThrow('canonical pressure');
    expect(retry.retryAtMs).toBe(100);
    now = 100;
    expect(retry.consumeDueRetry()).toBe(true);
    await expect(prepareStreamingNeighborhood(prepare, retry)).resolves.toBeUndefined();

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(retry.retryAtMs).toBeNull();
  });

  it('同中心已有旧可见Chunk时到期重试仍交回scheduler的失败请求', () => {
    let now = 0;
    const retry = new StreamingAdmissionRetry(() => now);
    const schedulerRequest = vi.fn();
    const retryFailedPreparations = vi.fn();
    const request = (World.prototype as unknown as { request: (cx: number, cy: number, cz: number) => void }).request;
    const world = {
      lastCenter: '0,0',
      quality: { renderRadius: 0 },
      telemetryRecorder: { beginSpan: vi.fn(() => 1), endSpan: vi.fn() },
      authority: { setFluidActiveChunks: vi.fn(), releaseChunkNeighborhood: vi.fn() },
      repository: {
        chunks: new Map([
          ['0,0,0', { task: { cx: 0, cz: 0 } }],
          ['0,1,0', { task: { cx: 0, cz: 0 } }],
        ]),
        unload: vi.fn(),
      },
      scheduler: {
        request: schedulerRequest,
        retryFailedPreparations,
        requestedKeys: new Set<string>(),
        cancel: vi.fn(),
      },
      dirtyChunks: new Set<string>(),
      streamingAdmissionRetry: retry,
      request,
    } as unknown as World;
    retry.recordRetryableFailure();
    now = 100;

    World.prototype.updateStreaming.call(world, { x: 0, z: 0 } as pc.Vec3);

    expect(schedulerRequest).not.toHaveBeenCalled();
    expect(retryFailedPreparations).toHaveBeenCalledOnce();
  });
});
