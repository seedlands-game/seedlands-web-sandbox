import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PACK_MEDIA_BYTES,
  PackMediaLoader,
  PackMediaLoaderError,
  packMediaIndexFromLock,
  type PackMediaFetchResponse,
} from '../../../src/client/presentation/pack-media-loader';

const bytes = (value: string) => new TextEncoder().encode(value).buffer;
const digest = 'a'.repeat(64);
const entry = (overrides: Record<string, unknown> = {}) => ({
  packId: 'sample:pack',
  path: 'assets/audio/song.mp3',
  digest,
  url: 'https://game.test/packs/assets/audio/song.mp3',
  size: 4,
  contentType: 'audio/mpeg',
  ...overrides,
});

const response = (overrides: Partial<PackMediaFetchResponse> = {}): PackMediaFetchResponse => ({
  ok: true,
  status: 200,
  contentType: 'audio/mpeg',
  contentLength: 4,
  bytes: vi.fn(async (_maxBytes: number) => bytes('song')),
  release: vi.fn(),
  ...overrides,
});

const errorCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PackMediaLoaderError);
    expect((error as PackMediaLoaderError).code).toBe(code);
    return;
  }
  throw new Error(`Expected Pack media loader failure: ${code}`);
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe('PackMediaLoader', () => {
  it('builds an exact same-origin audio index from a verified Pack lock', () => {
    vi.stubGlobal('location', { origin: 'https://game.test' });
    const index = packMediaIndexFromLock(
      {
        schemaVersion: 1,
        packs: [
          {
            id: 'sample:pack',
            version: '1.0.0',
            manifest: { path: 'sample.manifest.json', sha256: 'c'.repeat(64) },
            entry: { path: 'sample.mjs', sha256: 'd'.repeat(64) },
            resources: [
              {
                path: 'assets/audio/song.mp3',
                sha256: digest,
                size: 2_976_045,
                contentType: 'audio/mpeg',
              },
              {
                path: 'presentation.json',
                sha256: 'b'.repeat(64),
                size: 100,
                contentType: 'application/json',
              },
            ],
          },
        ],
      },
      new URL('https://game.test/packs/packs.lock.json'),
    );

    expect(index).toEqual([
      {
        packId: 'sample:pack',
        path: 'assets/audio/song.mp3',
        digest,
        size: 2_976_045,
        contentType: 'audio/mpeg',
        url: 'https://game.test/packs/assets/audio/song.mp3',
      },
    ]);
  });

  it('rejects incomplete resource metadata and a lock from another origin', () => {
    vi.stubGlobal('location', { origin: 'https://game.test' });
    expect(() =>
      packMediaIndexFromLock(
        {
          schemaVersion: 1,
          packs: [
            {
              id: 'sample:pack',
              version: '1.0.0',
              manifest: { path: 'sample.manifest.json', sha256: 'c'.repeat(64) },
              entry: { path: 'sample.mjs', sha256: 'd'.repeat(64) },
              resources: [{ path: 'song.mp3', sha256: digest }],
            },
          ],
        },
        new URL('https://game.test/packs/packs.lock.json'),
      ),
    ).toThrow(/resource lock/i);
    expect(() =>
      packMediaIndexFromLock({ schemaVersion: 1, packs: [] }, new URL('https://evil.test/packs/packs.lock.json')),
    ).toThrow(/origin/i);
  });

  it('resolves an exact Pack-scoped resource and returns independently releasable verified bytes', async () => {
    const fetched = response();
    const fetchBytes = vi.fn(async () => fetched);
    const sha256 = vi.fn(async () => digest);
    const loader = new PackMediaLoader([entry()], 'https://game.test', fetchBytes, sha256);

    const lease = await loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' });
    expect(fetchBytes).toHaveBeenCalledWith(
      new URL('https://game.test/packs/assets/audio/song.mp3'),
      expect.any(AbortSignal),
    );
    expect(new TextDecoder().decode(lease.bytes)).toBe('song');
    expect(sha256).toHaveBeenCalledOnce();
    expect(fetched.bytes).toHaveBeenCalledWith(MAX_PACK_MEDIA_BYTES);
    expect(fetched.release).toHaveBeenCalledOnce();

    lease.release();
    expect(() => lease.bytes).toThrow(/disposed/i);
    lease.release();
  });

  it('rejects invalid index entries and non-exact or unsafe references before fetching', async () => {
    const fetchBytes = vi.fn(async () => response());
    const sha256 = vi.fn(async () => digest);
    for (const invalid of [
      entry({ packId: 'pack' }),
      entry({ path: '../song.mp3' }),
      entry({ digest: 'bad' }),
      entry({ url: 'https://evil.test/song.mp3' }),
      entry({ size: MAX_PACK_MEDIA_BYTES + 1 }),
      entry({ contentType: 'text/html' }),
      entry({ unexpected: true }),
    ])
      expect(
        () => new PackMediaLoader([invalid as ReturnType<typeof entry>], 'https://game.test', fetchBytes, sha256),
      ).toThrow();
    expect(() => new PackMediaLoader([entry(), entry()], 'https://game.test', fetchBytes, sha256)).toThrow(
      /duplicate/i,
    );

    const loader = new PackMediaLoader([entry()], 'https://game.test', fetchBytes, sha256);
    await errorCode(loader.resolve({ packId: 'sample:other', path: 'assets/audio/song.mp3' }), 'resource-not-indexed');
    await errorCode(loader.resolve({ packId: 'sample:pack', path: './assets/audio/song.mp3' }), 'invalid-reference');
    await errorCode(loader.resolve({ packId: 'sample:pack', path: 'assets/../song.mp3' }), 'invalid-reference');
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('accepts the required MP3 size below the independent 8 MiB media cap', () => {
    expect(
      () =>
        new PackMediaLoader(
          [entry({ size: 2_976_045 })],
          'https://game.test',
          async () => response(),
          async () => digest,
        ),
    ).not.toThrow();
    expect(MAX_PACK_MEDIA_BYTES).toBe(8_388_608);
  });

  it('allows a verified non-media Pack lock and rejects later unindexed playback', async () => {
    const loader = new PackMediaLoader(
      [],
      'https://game.test',
      async () => response(),
      async () => digest,
    );
    await errorCode(loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' }), 'resource-not-indexed');
  });

  it('fails closed on status, content type, header/actual size and digest mismatches', async () => {
    const cases = [
      [response({ ok: false, status: 404 }), digest, 'request-failed'],
      [response({ contentType: 'text/html' }), digest, 'content-type-mismatch'],
      [response({ contentLength: 5 }), digest, 'size-mismatch'],
      [response({ bytes: async () => bytes('short') }), digest, 'size-mismatch'],
      [response(), 'b'.repeat(64), 'digest-mismatch'],
    ] as const;
    for (const [fetched, actualDigest, code] of cases) {
      const loader = new PackMediaLoader(
        [entry()],
        'https://game.test',
        async () => fetched,
        async () => actualDigest,
      );
      await errorCode(loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' }), code);
      expect(fetched.release).toHaveBeenCalledOnce();
    }
  });

  it('allows independent concurrent device requests without aborting either response', async () => {
    const first = deferred<PackMediaFetchResponse>();
    const firstResponse = response();
    const secondResponse = response();
    const signals: AbortSignal[] = [];
    const fetchBytes = vi.fn((_url: URL, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : Promise.resolve(secondResponse);
    });
    const loader = new PackMediaLoader([entry()], 'https://game.test', fetchBytes, async () => digest);

    const pending = loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' });
    const concurrent = loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' });
    await expect(concurrent).resolves.toBeDefined();
    first.resolve(firstResponse);
    expect(signals[0]!.aborted).toBe(false);
    await expect(pending).resolves.toBeDefined();
    expect(firstResponse.release).toHaveBeenCalledOnce();
    expect(secondResponse.release).toHaveBeenCalledOnce();
  });

  it('explicit abort and dispose invalidate pending requests and release active leases', async () => {
    const abortPending = deferred<PackMediaFetchResponse>();
    const disposePending = deferred<PackMediaFetchResponse>();
    const lateAbort = response();
    const lateDispose = response();
    const fetchBytes = vi
      .fn()
      .mockImplementationOnce(() => abortPending.promise)
      .mockImplementationOnce(async () => response())
      .mockImplementationOnce(() => disposePending.promise);
    const loader = new PackMediaLoader([entry()], 'https://game.test', fetchBytes, async () => digest);

    const aborted = loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' });
    loader.abort();
    abortPending.resolve(lateAbort);
    await errorCode(aborted, 'stale-request');
    expect(lateAbort.release).toHaveBeenCalledOnce();

    const lease = await loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' });
    const disposing = loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' });
    loader.dispose();
    disposePending.resolve(lateDispose);
    await errorCode(disposing, 'disposed');
    expect(lateDispose.release).toHaveBeenCalledOnce();
    expect(() => lease.bytes).toThrow(/disposed/i);
    await errorCode(loader.resolve({ packId: 'sample:pack', path: 'assets/audio/song.mp3' }), 'disposed');
  });
});
