import { describe, expect, it, vi } from 'vitest';
import {
  BrowserAuthorityClient,
  type AuthorityWorkerPort,
} from '../../../src/client/authority/browser-authority-client';
import type { AuthorityResponse } from '../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import { testWorldgenProvider } from './fixtures/worldgen-provider';

class FakeAuthorityWorker implements AuthorityWorkerPort {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  transfers: Transferable[][] = [];

  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.posts.push(message);
    this.transfers.push(transfer);
  }

  terminate() {}

  emit(message: AuthorityResponse) {
    this.onmessage?.({ data: message } as MessageEvent<AuthorityResponse>);
  }
}

describe('BrowserAuthorityClient bootstrap', () => {
  it('把新世界出生点生成握手及显式世界配置交给通用计算池', async () => {
    const worker = new FakeAuthorityWorker();
    const canonical = new Uint16Array(32 ** 3).buffer;
    const bootstrap = vi.fn(async () => ({
      playerBodyPosition: [0.5, 33, 0.5] as [number, number, number],
      starterChunks: [
        {
          key: '0,1,0',
          cx: 0,
          cy: 1,
          cz: 0,
          chunkRevision: 0 as const,
          generatorVersion: 3,
          provider: testWorldgenProvider,
          canonical,
        },
      ],
    }));
    const client = new BrowserAuthorityClient(worker, 'world:1', { onBootstrapGeneration: bootstrap });
    void client.start({
      seedText: 'worker-client',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
    });
    const needed = {
      kind: 'authority-bootstrap-needed',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: 9,
      seed: 7,
      generatorVersion: 3,
      provider: testWorldgenProvider,
      starterEcology: null,
    } as const;
    worker.emit(needed);
    worker.emit(needed);

    await vi.waitFor(() =>
      expect(bootstrap).toHaveBeenCalledWith({
        seed: 7,
        generatorVersion: 3,
        provider: testWorldgenProvider,
        starterEcology: null,
      }),
    );
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(worker.posts.at(-1)).toMatchObject({
      kind: 'authority-bootstrap-result',
      requestId: 9,
      playerBodyPosition: [0.5, 33, 0.5],
      starterChunks: [expect.objectContaining({ key: '0,1,0', provider: testWorldgenProvider })],
    });
    expect(worker.transfers.at(-1)).toEqual([canonical]);
  });
});
