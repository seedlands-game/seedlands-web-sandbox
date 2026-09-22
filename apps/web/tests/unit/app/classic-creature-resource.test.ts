import { readFileSync } from 'node:fs';
import * as pc from 'playcanvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadClassicCreatureBlob } from '../../../src/app/gameplay/classic-creature-resource';
const bytes = readFileSync('apps/web/public/models/classic/pig.glb');
const app = () => new pc.EventHandler() as pc.Application;
afterEach(() => vi.unstubAllGlobals());
describe('Classic 默认生物CPU资源生命周期', () => {
  it('同app同物种共享在途请求与已校验Blob，不跨app共享', async () => {
    const fetch = vi.fn(async () => new Response(Uint8Array.from(bytes)));
    vi.stubGlobal('fetch', fetch);
    const first = app();
    const second = app();
    const a = loadClassicCreatureBlob(first, 'seedlands:model/actor/pig');
    expect(loadClassicCreatureBlob(first, 'seedlands:model/actor/pig')).toBe(a);
    await a;
    await loadClassicCreatureBlob(first, 'seedlands:model/actor/pig');
    expect(fetch).toHaveBeenCalledTimes(1);
    await loadClassicCreatureBlob(second, 'seedlands:model/actor/pig');
    expect(fetch).toHaveBeenCalledTimes(2);
    first.fire('destroy');
    second.fire('destroy');
  });
  it('请求失败不污染缓存，未知ID不发请求', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(Uint8Array.from(bytes)));
    vi.stubGlobal('fetch', fetch);
    const owner = app();
    expect(loadClassicCreatureBlob(owner, 'user:model')).toBeUndefined();
    await expect(loadClassicCreatureBlob(owner, 'seedlands:model/actor/pig')).rejects.toThrow('HTTP 404');
    await expect(loadClassicCreatureBlob(owner, 'seedlands:model/actor/pig')).resolves.toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledTimes(2);
    owner.fire('destroy');
  });
  it('app销毁取消仍在途的默认资源请求', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('cancelled'))),
        );
      }),
    );
    const owner = app();
    const pending = loadClassicCreatureBlob(owner, 'seedlands:model/actor/pig');
    owner.fire('destroy');
    expect(signal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow('cancelled');
  });
});
