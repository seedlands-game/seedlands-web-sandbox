import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrowserPackPresentationCatalog } from '../../../src/client/presentation/pack-presentation-loader';

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const response = (text: string, status = 200) =>
  new Response(text, { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('browser Pack presentation loader', () => {
  it('accepts an exact locked same-origin JSON resource and exposes generic voxel, item and actor bindings', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:pack-resource');
        static revokeObjectURL = vi.fn();
      },
    );
    const presentation = JSON.stringify({
      schemaVersion: 1,
      voxels: [{ id: 'sample:glow-block', texture: 'builtin:textures/glow.png', material: 'sample:glow' }],
      items: [
        {
          id: 'sample:glow-block',
          model: 'builtin:models/glow.glb',
          icon: 'builtin:icons/glow.png',
          material: 'sample:glow',
        },
      ],
      actors: [{ id: 'sample:sentinel', model: 'models/sentinel.glb', texture: 'builtin:textures/sentinel.png' }],
      materials: [{ id: 'sample:glow', faceMaterial: 21, texture: 'builtin:textures/glow.png', renderMode: 'opaque' }],
    });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'sample:modular-world',
      version: '1.0.0',
      kind: 'playbook',
      entry: 'modular-world.mjs',
      modules: [],
      resources: ['presentation.json', 'models/sentinel.glb'],
      presentation: { path: 'presentation.json' },
    });
    const entry = 'export const pack = { modules: [] };';
    const lock = JSON.stringify({
      schemaVersion: 1,
      packs: [
        {
          id: 'sample:modular-world',
          version: '1.0.0',
          manifest: { path: 'modular-world.manifest.json', sha256: await sha256(manifest) },
          entry: { path: 'modular-world.mjs', sha256: await sha256(entry) },
          resources: [
            { path: 'presentation.json', sha256: await sha256(presentation) },
            { path: 'models/sentinel.glb', sha256: await sha256('sentinel-glb') },
          ],
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        switch (new URL(String(input)).pathname) {
          case '/packs/packs.lock.json':
            return response(lock);
          case '/packs/modular-world.manifest.json':
            return response(manifest);
          case '/packs/modular-world.mjs':
            return response(entry, 200);
          case '/packs/presentation.json':
            return response(presentation);
          case '/packs/models/sentinel.glb':
            return response('sentinel-glb');
          default:
            return response('', 404);
        }
      }),
    );

    await expect(loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'))).resolves.toEqual(
      expect.objectContaining({
        voxels: expect.objectContaining({
          'sample:glow-block': expect.objectContaining({ texture: 'builtin:textures/glow.png' }),
        }),
        items: expect.objectContaining({
          'sample:glow-block': expect.objectContaining({ icon: 'builtin:icons/glow.png' }),
        }),
        actors: expect.objectContaining({
          'sample:sentinel': expect.objectContaining({ model: 'models/sentinel.glb' }),
        }),
        materials: expect.objectContaining({ 'sample:glow': expect.objectContaining({ renderMode: 'opaque' }) }),
        assetUrls: expect.objectContaining({ 'models/sentinel.glb': 'blob:pack-resource' }),
      }),
    );
  });

  it('assigns a browser-decodable media type to verified image Blob resources', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const create = vi.fn(() => 'blob:texture');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = vi.fn();
      },
    );
    const presentation = JSON.stringify({
      schemaVersion: 1,
      voxels: [{ id: 'sample:block', texture: 'texture.svg', material: 'sample:material' }],
      items: [],
      actors: [],
      materials: [{ id: 'sample:material', faceMaterial: 21, texture: 'texture.svg', renderMode: 'cutout' }],
    });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'sample:pack',
      version: '1.0.0',
      kind: 'playbook',
      entry: 'pack.mjs',
      modules: [],
      resources: ['presentation.json', 'texture.svg'],
      presentation: { path: 'presentation.json' },
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const lock = JSON.stringify({
      schemaVersion: 1,
      packs: [
        {
          id: 'sample:pack',
          version: '1.0.0',
          manifest: { path: 'pack.manifest.json', sha256: await sha256(manifest) },
          entry: { path: 'pack.mjs', sha256: 'a'.repeat(64) },
          resources: [
            { path: 'presentation.json', sha256: await sha256(presentation) },
            { path: 'texture.svg', sha256: await sha256(svg) },
          ],
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname.endsWith('packs.lock.json')) return response(lock);
        if (pathname.endsWith('pack.manifest.json')) return response(manifest);
        if (pathname.endsWith('presentation.json')) return response(presentation);
        if (pathname.endsWith('texture.svg')) return response(svg);
        return response('', 404);
      }),
    );

    await loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/svg+xml' }));
  });

  it.each([
    ['unlocked path', 'outside.json', 'presentation resource is not locked'],
    ['digest mismatch', 'presentation.json', 'Pack digest mismatch'],
  ])('fails closed for %s', async (_case, presentationPath, message) => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const presentation = '{"schemaVersion":1,"voxels":[],"items":[],"actors":[],"materials":[]}';
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'sample:broken',
      version: '1.0.0',
      kind: 'playbook',
      entry: 'broken.mjs',
      modules: [],
      resources: ['presentation.json'],
      presentation: { path: presentationPath },
    });
    const entry = 'export const pack = { modules: [] };';
    const lock = JSON.stringify({
      schemaVersion: 1,
      packs: [
        {
          id: 'sample:broken',
          version: '1.0.0',
          manifest: { path: 'broken.manifest.json', sha256: await sha256(manifest) },
          entry: { path: 'broken.mjs', sha256: await sha256(entry) },
          resources: [{ path: 'presentation.json', sha256: 'a'.repeat(64) }],
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        switch (new URL(String(input)).pathname) {
          case '/packs/packs.lock.json':
            return response(lock);
          case '/packs/broken.manifest.json':
            return response(manifest);
          case '/packs/presentation.json':
            return response(presentation);
          default:
            return response('', 404);
        }
      }),
    );

    await expect(loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'))).rejects.toThrow(message);
  });

  it('rejects a non-builtin asset reference that is not present in the Pack resource lock', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const presentation = JSON.stringify({
      schemaVersion: 1,
      voxels: [],
      items: [],
      actors: [{ id: 'sample:sentinel', model: 'models/sentinel.glb', texture: 'builtin:textures/sentinel.png' }],
      materials: [],
    });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'sample:broken',
      version: '1.0.0',
      kind: 'playbook',
      entry: 'broken.mjs',
      modules: [],
      resources: ['presentation.json'],
      presentation: { path: 'presentation.json' },
    });
    const lock = JSON.stringify({
      schemaVersion: 1,
      packs: [
        {
          id: 'sample:broken',
          version: '1.0.0',
          manifest: { path: 'broken.manifest.json', sha256: await sha256(manifest) },
          entry: { path: 'broken.mjs', sha256: 'a'.repeat(64) },
          resources: [{ path: 'presentation.json', sha256: await sha256(presentation) }],
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/packs/packs.lock.json') return response(lock);
        if (pathname === '/packs/broken.manifest.json') return response(manifest);
        if (pathname === '/packs/presentation.json') return response(presentation);
        return response('', 404);
      }),
    );

    await expect(loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'))).rejects.toThrow(
      /asset is not locked/i,
    );
  });

  it('rejects a voxel texture that disagrees with its bound material texture', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const presentation = JSON.stringify({
      schemaVersion: 1,
      voxels: [{ id: 'sample:block', texture: 'builtin:texture-a', material: 'sample:material' }],
      items: [],
      actors: [],
      materials: [{ id: 'sample:material', faceMaterial: 21, texture: 'builtin:texture-b', renderMode: 'transparent' }],
    });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'sample:broken',
      version: '1.0.0',
      kind: 'playbook',
      entry: 'broken.mjs',
      modules: [],
      resources: ['presentation.json'],
      presentation: { path: 'presentation.json' },
    });
    const lock = JSON.stringify({
      schemaVersion: 1,
      packs: [
        {
          id: 'sample:broken',
          version: '1.0.0',
          manifest: { path: 'broken.manifest.json', sha256: await sha256(manifest) },
          entry: { path: 'broken.mjs', sha256: 'a'.repeat(64) },
          resources: [{ path: 'presentation.json', sha256: await sha256(presentation) }],
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname.endsWith('packs.lock.json')) return response(lock);
        if (pathname.endsWith('broken.manifest.json')) return response(manifest);
        if (pathname.endsWith('presentation.json')) return response(presentation);
        return response('', 404);
      }),
    );

    await expect(loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'))).rejects.toThrow(
      /voxel material binding/i,
    );
  });

  it('revokes object URLs for verified Pack resources exactly once', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:verified-model');
        static revokeObjectURL = revoke;
      },
    );
    const presentation = JSON.stringify({
      schemaVersion: 1,
      voxels: [],
      items: [],
      actors: [{ id: 'sample:sentinel', model: 'models/sentinel.glb', texture: 'builtin:textures/sentinel.png' }],
      materials: [],
    });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'sample:pack',
      version: '1.0.0',
      kind: 'playbook',
      entry: 'pack.mjs',
      modules: [],
      resources: ['presentation.json', 'models/sentinel.glb'],
      presentation: { path: 'presentation.json' },
    });
    const lock = JSON.stringify({
      schemaVersion: 1,
      packs: [
        {
          id: 'sample:pack',
          version: '1.0.0',
          manifest: { path: 'pack.manifest.json', sha256: await sha256(manifest) },
          entry: { path: 'pack.mjs', sha256: 'a'.repeat(64) },
          resources: [
            { path: 'presentation.json', sha256: await sha256(presentation) },
            { path: 'models/sentinel.glb', sha256: await sha256('model') },
          ],
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/packs/packs.lock.json') return response(lock);
        if (pathname === '/packs/pack.manifest.json') return response(manifest);
        if (pathname === '/packs/presentation.json') return response(presentation);
        if (pathname === '/packs/models/sentinel.glb') return response('model');
        return response('', 404);
      }),
    );

    const catalog = await loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'));
    expect(catalog.assetUrls['models/sentinel.glb']).toBe('blob:verified-model');
    catalog.dispose();
    catalog.dispose();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('releases every object URL when a later Pack binding fails', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:staged');
        static revokeObjectURL = revoke;
      },
    );
    const presentation = JSON.stringify({
      schemaVersion: 1,
      voxels: [],
      items: [],
      actors: [{ id: 'sample:sentinel', model: 'models/sentinel.glb', texture: 'builtin:texture' }],
      materials: [],
    });
    const manifest = (id: string) =>
      JSON.stringify({
        schemaVersion: 1,
        id,
        version: '1.0.0',
        kind: id === 'sample:first' ? 'playbook' : 'extension',
        entry: `${id.split(':')[1]}.mjs`,
        modules: [],
        resources: ['presentation.json', 'models/sentinel.glb'],
        presentation: { path: 'presentation.json' },
      });
    const lock = JSON.stringify({
      schemaVersion: 1,
      packs: await Promise.all(
        ['sample:first', 'sample:second'].map(async (id) => ({
          id,
          version: '1.0.0',
          manifest: { path: `${id.split(':')[1]}.manifest.json`, sha256: await sha256(manifest(id)) },
          entry: { path: `${id.split(':')[1]}.mjs`, sha256: 'a'.repeat(64) },
          resources: [
            { path: 'presentation.json', sha256: await sha256(presentation) },
            { path: 'models/sentinel.glb', sha256: await sha256('model') },
          ],
        })),
      ),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname.endsWith('packs.lock.json')) return response(lock);
        if (pathname.endsWith('first.manifest.json')) return response(manifest('sample:first'));
        if (pathname.endsWith('second.manifest.json')) return response(manifest('sample:second'));
        if (pathname.endsWith('presentation.json')) return response(presentation);
        if (pathname.endsWith('models/sentinel.glb')) return response('model');
        return response('', 404);
      }),
    );

    await expect(loadBrowserPackPresentationCatalog(new URL('http://localhost/packs/'))).rejects.toThrow(/Duplicate/);
    expect(revoke).toHaveBeenCalledOnce();
  });
});
