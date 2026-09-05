import { describe, expect, it, vi } from 'vitest';
import type * as pc from 'playcanvas';
import { World } from '../../src/app/world-runtime';
import { acceptStreamingCanonical, StreamingAdmissionRetry } from '../../src/app/streaming-admission-retry';

describe('World streaming admission backpressure', () => {
  it('同一streaming中心在Authority解除背压后重新请求缺失Chunk且退避有界', () => {
    let now = 0;
    const retry = new StreamingAdmissionRetry(() => now);
    const request = vi.fn();
    const world = {
      lastCenter: '',
      quality: { renderRadius: 0 },
      telemetryRecorder: { beginSpan: vi.fn(() => 1), endSpan: vi.fn() },
      authority: { setFluidActiveChunks: vi.fn(), releaseChunkNeighborhood: vi.fn() },
      repository: {
        chunks: new Map([['0,0,0', { task: { cx: 0, cy: 0, cz: 0 } }]]),
        unload: vi.fn(),
      },
      scheduler: { requestedKeys: new Set<string>(), cancel: vi.fn() },
      dirtyChunks: new Set<string>(),
      request,
      streamingAdmissionRetry: retry,
    } as unknown as World;
    const position = { x: 0, z: 0 } as pc.Vec3;

    World.prototype.updateStreaming.call(world, position);
    expect(request).toHaveBeenCalledTimes(2);
    World.prototype.updateStreaming.call(world, position);
    expect(request).toHaveBeenCalledTimes(2);

    retry.recordRetryableFailure();
    now = 99;
    World.prototype.updateStreaming.call(world, position);
    expect(request).toHaveBeenCalledTimes(2);
    now = 100;
    World.prototype.updateStreaming.call(world, position);
    expect(request).toHaveBeenCalledTimes(4);

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
});
