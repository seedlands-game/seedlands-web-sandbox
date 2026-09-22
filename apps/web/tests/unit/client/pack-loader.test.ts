import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePack, type PackDefinition } from '@seedlands/stdlib/mod-api';
import { assembleProductPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import { loadBrowserHostAdmissions, loadBrowserProductAssembly } from '../../../src/worker/pack-loader';

const admissionUrl = new URL('http://localhost/packs/host-admissions.json');
const integrity = {
  algorithm: 'sha256' as const,
  manifestDigest: 'a'.repeat(64),
  entryDigest: 'b'.repeat(64),
  resources: [],
};
const artifact = (pack: PackDefinition): VerifiedPackArtifact => ({ ...pack, integrity });
const playbookAdmission = { id: 'seedlands:overworld', version: '1.0.0', integrity, permissions: [] };
const reply = (value: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })),
  );
const sha256 = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

afterEach(() => vi.unstubAllGlobals());

describe('browser Pack host admission loader', () => {
  it('loads exact host-owned integrity and permission grants without deriving them from a Pack', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    reply({
      schemaVersion: 1,
      playbook: playbookAdmission,
      extensions: [
        {
          id: 'example:resident-crafting',
          version: '1.0.0',
          integrity,
          permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
        },
      ],
    });

    await expect(loadBrowserHostAdmissions(admissionUrl)).resolves.toEqual({
      playbook: playbookAdmission,
      extensions: [
        expect.objectContaining({
          id: 'example:resident-crafting',
          version: '1.0.0',
          integrity,
          permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
        }),
      ],
    });
  });

  it('fails closed when the host policy file is missing or has an incomplete schema', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    reply({ error: 'missing' }, 404);
    await expect(loadBrowserHostAdmissions(admissionUrl)).rejects.toThrow('Pack asset failed');

    reply({
      schemaVersion: 1,
      playbook: playbookAdmission,
      extensions: [{ id: 'example:extension', version: '1.0.0', integrity }],
    });
    await expect(loadBrowserHostAdmissions(admissionUrl)).rejects.toThrow('extension is invalid');

    reply({
      schemaVersion: 1,
      playbook: playbookAdmission,
      extensions: [
        {
          id: 'example:extension',
          version: '1.0.0',
          integrity: { ...integrity, resources: [{ path: 'assets/../secret', digest: 'c'.repeat(64) }] },
          permissions: [],
        },
      ],
    });
    await expect(loadBrowserHostAdmissions(admissionUrl)).rejects.toThrow('extension resource is invalid');
  });

  it('does not load an extension when the trusted host grants none', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    reply({ schemaVersion: 1, playbook: playbookAdmission, extensions: [] });
    const admissions = await loadBrowserHostAdmissions(admissionUrl);
    const playbook = definePack({ id: 'seedlands:overworld', version: '1.0.0', kind: 'playbook', modules: [] });
    const extension = definePack({
      id: 'example:resident-crafting',
      version: '1.0.0',
      kind: 'extension',
      dependencies: [{ id: playbook.manifest.id, version: playbook.manifest.version }],
      modules: [],
    });

    expect(() =>
      assembleProductPacks([artifact(playbook), artifact(extension)], {
        approvedPlaybook: admissions.playbook,
        approvedExtensions: admissions.extensions,
      }),
    ).toThrow('not been exactly approved');
  });

  it('rejects an unapproved extension before importing its entry module', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'example:unapproved',
      version: '1.0.0',
      kind: 'extension',
      entry: './extension.mjs',
      modules: [],
      resources: [],
    });
    const entry = 'globalThis.unapprovedPackExecuted = true; export const pack = { modules: [] };';
    const lock = {
      schemaVersion: 1,
      packs: [
        {
          id: 'example:unapproved',
          version: '1.0.0',
          manifest: { path: './extension.manifest.json', sha256: await sha256(manifest) },
          entry: { path: './extension.mjs', sha256: await sha256(entry) },
          resources: [],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | RequestInfo) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('host-admissions.json'))
          return new Response(JSON.stringify({ schemaVersion: 1, playbook: playbookAdmission, extensions: [] }));
        if (path.endsWith('packs.lock.json')) return new Response(JSON.stringify(lock));
        if (path.endsWith('extension.manifest.json')) return new Response(manifest);
        if (path.endsWith('extension.mjs')) return new Response(entry);
        return new Response('', { status: 404 });
      }),
    );
    const importEntry = vi.spyOn(URL, 'createObjectURL');

    await expect(loadBrowserProductAssembly(new URL('http://localhost/packs/'))).rejects.toThrow('not host-approved');
    expect(importEntry).not.toHaveBeenCalled();
  });

  it('rejects an unapproved Playbook before importing its entry module', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: 'sample:unapproved-playbook',
      version: '1.0.0',
      kind: 'playbook',
      entry: './playbook.mjs',
      modules: [],
      resources: [],
    });
    const entry = 'globalThis.unapprovedPlaybookExecuted = true; export const pack = { modules: [] };';
    const lock = {
      schemaVersion: 1,
      packs: [
        {
          id: 'sample:unapproved-playbook',
          version: '1.0.0',
          manifest: { path: './playbook.manifest.json', sha256: await sha256(manifest) },
          entry: { path: './playbook.mjs', sha256: await sha256(entry) },
          resources: [],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | RequestInfo) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('host-admissions.json'))
          return new Response(JSON.stringify({ schemaVersion: 1, playbook: playbookAdmission, extensions: [] }));
        if (path.endsWith('packs.lock.json')) return new Response(JSON.stringify(lock));
        if (path.endsWith('playbook.manifest.json')) return new Response(manifest);
        if (path.endsWith('playbook.mjs')) return new Response(entry);
        return new Response('', { status: 404 });
      }),
    );
    const importEntry = vi.spyOn(URL, 'createObjectURL');

    await expect(loadBrowserProductAssembly(new URL('http://localhost/packs/'))).rejects.toThrow('not host-approved');
    expect(importEntry).not.toHaveBeenCalled();
  });
});
