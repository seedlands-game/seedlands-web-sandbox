import { describe, expect, it, vi } from 'vitest';
import {
  estimateHardwareCores,
  preflightClientCapabilities,
  probeModuleWorker,
  requiredWorkerCount,
} from '../../src/app/client-capability-preflight';

class FakeProbeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  postMessage(message: unknown) {
    if (message === 'seedlands-worker-probe')
      queueMicrotask(() => this.onmessage?.({ data: 'seedlands-worker-ready' } as MessageEvent<unknown>));
  }

  terminate() {
    this.terminated = true;
  }
}

describe('客户端能力预检', () => {
  it('按 Worker 拓扑计算默认 5 / Harness 6 个最低核心估算', () => {
    expect(requiredWorkerCount(1)).toBe(5);
    expect(requiredWorkerCount(2)).toBe(6);
    expect(estimateHardwareCores(8)).toEqual({ count: 8, fallback: false });
    expect(estimateHardwareCores(undefined)).toEqual({ count: 1, fallback: true });
  });

  it('真实消息往返后才判定 module Worker 可用并终止 probe', async () => {
    const worker = new FakeProbeWorker();
    await expect(probeModuleWorker({ createWorker: () => worker })).resolves.toEqual({ supported: true });
    expect(worker.terminated).toBe(true);
  });

  it('构造失败和消息超时均 fail closed', async () => {
    await expect(
      probeModuleWorker({
        createWorker: () => {
          throw new Error('blocked');
        },
      }),
    ).resolves.toMatchObject({ supported: false, reason: 'blocked' });

    const worker = new FakeProbeWorker();
    worker.postMessage = vi.fn();
    await expect(probeModuleWorker({ createWorker: () => worker, timeoutMs: 1 })).resolves.toMatchObject({
      supported: false,
    });
    expect(worker.terminated).toBe(true);
  });

  it('低核心数只产生警告，Worker 不支持独立作为硬门禁', async () => {
    const state = await preflightClientCapabilities(1, {
      hardwareConcurrency: 4,
      createWorker: () => new FakeProbeWorker(),
    });
    expect(state).toMatchObject({
      workerSupport: 'supported',
      estimatedCores: 4,
      requiredWorkerCount: 5,
      lowCoreWarning: true,
    });
  });
});
