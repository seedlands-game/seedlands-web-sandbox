import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrowserPackPresentationCatalog } from '../../../src/client/presentation/pack-presentation-loader';

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const response = (text: string, status = 200) => new Response(text, { status });
const presentation = '{"schemaVersion":1,"voxels":[],"items":[],"actors":[],"materials":[]}';
const resourceLock = async () => ({
  path: 'presentation.json',
  sha256: await sha256(presentation),
  size: new TextEncoder().encode(presentation).byteLength,
  contentType: 'application/json',
});
const lockWith = (resource: unknown, manifestDigest = 'a'.repeat(64)) =>
  JSON.stringify({
    schemaVersion: 1,
    packs: [
      {
        id: 'sample:strict',
        version: '1.0.0',
        manifest: { path: 'strict.manifest.json', sha256: manifestDigest },
        entry: { path: 'strict.mjs', sha256: 'b'.repeat(64) },
        resources: [resource],
      },
    ],
  });

afterEach(() => vi.unstubAllGlobals());

describe('browser Pack presentation resource lock contract', () => {
  it('keeps manifest file locks on the exact two-field contract', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const manifest = {
      path: 'strict.manifest.json',
      sha256: 'a'.repeat(64),
      size: 1,
      contentType: 'application/json',
    };
    const fetch = vi.fn(async () =>
      response(
        JSON.stringify({
          schemaVersion: 1,
          packs: [
            {
              id: 'sample:strict',
              version: '1.0.0',
              manifest,
              entry: { path: 'strict.mjs', sha256: 'b'.repeat(64) },
              resources: [await resourceLock()],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'))).rejects.toThrow(/file lock/i);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects malformed formal resource metadata before fetching Pack resources', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const valid = await resourceLock();
    const missingContentType = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'contentType'));
    const invalidResources: unknown[] = [
      { path: valid.path, sha256: valid.sha256 },
      missingContentType,
      { ...valid, extra: true },
      { ...valid, size: 0 },
      { ...valid, size: 32 * 1024 * 1024 + 1 },
      { ...valid, contentType: 'audio/mpeg' },
    ];
    const fetch = vi.fn(async () => response(''));
    vi.stubGlobal('fetch', fetch);

    for (const resource of invalidResources) {
      fetch.mockResolvedValueOnce(response(lockWith(resource)));
      await expect(loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'))).rejects.toThrow(
        /resource lock/i,
      );
    }
    expect(fetch).toHaveBeenCalledTimes(invalidResources.length);
  });

  it('rejects downloaded presentation bytes whose size differs from the formal resource lock', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'sample:strict',
      version: '1.0.0',
      kind: 'playbook',
      entry: 'strict.mjs',
      modules: [],
      resources: ['presentation.json'],
      presentation: { path: 'presentation.json' },
    });
    const locked = await resourceLock();
    const lock = lockWith({ ...locked, size: locked.size + 1 }, await sha256(manifest));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname.endsWith('packs.lock.json')) return response(lock);
        if (pathname.endsWith('strict.manifest.json')) return response(manifest);
        if (pathname.endsWith('presentation.json')) return response(presentation);
        return response('', 404);
      }),
    );

    await expect(loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'))).rejects.toThrow(
      /size mismatch/i,
    );
  });
});
