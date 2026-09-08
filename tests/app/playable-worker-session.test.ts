import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteAuthorityClient } from '../../apps/web/src/client/authority/remote-authority-client';
import { startPlayableWorkerSession } from '../../apps/web/src/app/world/playable-worker-session';

const options = () =>
  ({
    remote: { url: 'ws://127.0.0.1:8787/seedlands', accessKey: 'synthetic' },
    client: {},
    local: {},
    wasm: { artifact: 'off', kernels: [] },
    generalWorkerCount: 1,
  }) as never;

describe('playable worker session ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('远端连接后Worker构造失败会释放Authority并允许下一次连接', async () => {
    const first = { epoch: 'remote-first', dispose: vi.fn() } as unknown as RemoteAuthorityClient;
    const second = { epoch: 'remote-second', dispose: vi.fn() } as unknown as RemoteAuthorityClient;
    vi.spyOn(RemoteAuthorityClient, 'connect')
      .mockResolvedValueOnce({ authority: first, ready: {} as never })
      .mockResolvedValueOnce({ authority: second, ready: {} as never });
    let workerConstructionFails = true;
    class ControlledWorker {
      onmessage = null;
      onerror = null;
      constructor() {
        if (workerConstructionFails) throw new Error('worker construction failed');
      }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', ControlledWorker);

    await expect(startPlayableWorkerSession(options())).rejects.toThrow(/worker construction failed/);
    expect(first.dispose).toHaveBeenCalledOnce();
    workerConstructionFails = false;
    const reconnected = await startPlayableWorkerSession(options());
    expect(reconnected.authority).toBe(second);
    expect(second.dispose).not.toHaveBeenCalled();
    reconnected.compute.dispose();
  });
});
