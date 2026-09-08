import { describe, expect, it, vi } from 'vitest';
import {
  AuthorityCanonicalPreparation,
  createAuthorityCanonicalRouter,
} from '../../packages/game-core/src/server/authority/authority-canonical-preparation';

const deferred = () => {
  let resolve!: (value: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('Authority canonical durable preparation', () => {
  it('Runtime构造前观察到的unknown会合并并在绑定后交付', () => {
    const router = createAuthorityCanonicalRouter();
    const target = vi.fn();
    router.request('5,1,0');
    router.request('5,1,0');

    router.bind(target);

    expect(target).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledWith('5,1,0');
  });

  it('同一Chunk并发unknown只执行一次持久化预检，命中后不请求procedural生成', async () => {
    const pending = deferred();
    const prepare = vi.fn(() => pending.promise);
    const requestGeneration = vi.fn();
    const onAvailable = vi.fn();
    const coordinator = new AuthorityCanonicalPreparation(
      { prepareCanonicalChunkForMutation: prepare },
      requestGeneration,
      onAvailable,
    );

    coordinator.request('5,1,0');
    coordinator.request('5,1,0');
    coordinator.request('5,1,0');
    expect(prepare).toHaveBeenCalledTimes(1);

    pending.resolve(true);
    await vi.waitFor(() => expect(onAvailable).toHaveBeenCalledWith('5,1,0'));
    expect(requestGeneration).not.toHaveBeenCalled();
  });

  it('持久化读取失败不降级成missing，后续观察可以重新预检', async () => {
    const prepare = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(true);
    const requestGeneration = vi.fn();
    const onAvailable = vi.fn();
    const coordinator = new AuthorityCanonicalPreparation(
      { prepareCanonicalChunkForMutation: prepare },
      requestGeneration,
      onAvailable,
    );

    coordinator.request('5,1,0');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    coordinator.request('5,1,0');

    await vi.waitFor(() => expect(onAvailable).toHaveBeenCalledWith('5,1,0'));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(requestGeneration).not.toHaveBeenCalled();
  });

  it('只有持久化明确missing才请求General Worker生成', async () => {
    const requestGeneration = vi.fn();
    const coordinator = new AuthorityCanonicalPreparation(
      { prepareCanonicalChunkForMutation: async () => false },
      requestGeneration,
      vi.fn(),
    );

    coordinator.request('5,1,0');

    await vi.waitFor(() => expect(requestGeneration).toHaveBeenCalledWith('5,1,0'));
  });
});
