import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const adapter = join(root, 'scripts/pack-integrity.mjs');
const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fixture = async (entry: string, manifestOverride: Record<string, unknown> = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-pack-integrity-'));
  directories.push(directory);
  const marker = join(directory, 'executed.txt');
  const manifest = JSON.stringify({
    schemaVersion: 1,
    id: 'example:pack',
    version: '1.0.0',
    kind: 'playbook',
    entry: './entry.mjs',
    modules: [],
    resources: ['./texture.bin'],
    ...manifestOverride,
  });
  const resource = 'resource-bytes';
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), manifest),
    writeFile(join(directory, 'entry.mjs'), entry),
    writeFile(join(directory, 'texture.bin'), resource),
  ]);
  const lock = JSON.stringify({
    schemaVersion: 1,
    packs: [
      {
        id: 'example:pack',
        version: '1.0.0',
        manifest: { path: './manifest.json', sha256: sha256(manifest) },
        entry: { path: './entry.mjs', sha256: sha256(entry) },
        resources: [{ path: './texture.bin', sha256: sha256(resource) }],
      },
    ],
  });
  const lockPath = join(directory, 'packs.lock.json');
  await writeFile(lockPath, lock);
  return { directory, lockPath, marker };
};

const runAdapter = (lockPath: string, marker: string) =>
  execFileAsync(process.execPath, [adapter, '--lock', lockPath], {
    env: { ...process.env, PACK_INTEGRITY_MARKER: marker },
  });

describe('Pack artifact integrity adapter', () => {
  it('rejects a manifest that supplies required fields through __proto__ before import', async () => {
    const source = `process.getBuiltinModule('node:fs').writeFileSync(process.env.PACK_INTEGRITY_MARKER, 'bad');\nexport const pack = { modules: [] };\n`;
    const value = await fixture(source, {
      schemaVersion: undefined,
      ['__proto__']: { schemaVersion: 1 },
    });
    await expect(runAdapter(value.lockPath, value.marker)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Pack manifest schemaVersion must be 1'),
    });
    await expect(readFile(value.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('checks actual manifest, entry and resource bytes before executing the ESM Pack', async () => {
    const source = `process.getBuiltinModule('node:fs').writeFileSync(process.env.PACK_INTEGRITY_MARKER, 'yes');\nexport const pack = { modules: [] };\n`;
    const { lockPath, marker } = await fixture(source);

    const { stdout } = await runAdapter(lockPath, marker);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      packs: [{ id: 'example:pack', version: '1.0.0', moduleCount: 0 }],
    });
    expect(await readFile(marker, 'utf8')).toBe('yes');
  });

  it('fails a tampered entry before import side effects', async () => {
    const original = `export const pack = { modules: [] };\n`;
    const { directory, lockPath, marker } = await fixture(original);
    await writeFile(
      join(directory, 'entry.mjs'),
      `process.getBuiltinModule('node:fs').writeFileSync(process.env.PACK_INTEGRITY_MARKER, 'bad');\nexport const pack = { modules: [] };\n`,
    );

    await expect(runAdapter(lockPath, marker)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('entry digest mismatch'),
    });
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails missing resources and invalid manifest schema before import', async () => {
    const source = `export const pack = { modules: [] };\n`;
    const missingResource = await fixture(source);
    await rm(join(missingResource.directory, 'texture.bin'));
    await expect(runAdapter(missingResource.lockPath, missingResource.marker)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('ENOENT'),
    });

    const sideEffect = `process.getBuiltinModule('node:fs').writeFileSync(process.env.PACK_INTEGRITY_MARKER, 'bad');\nexport const pack = { modules: [] };\n`;
    const invalid = await fixture(sideEffect, {
      modules: [
        {
          id: 'example:module',
          version: '1.0.0',
          permissions: [{ resource: 'example.inventory', operations: [] }],
        },
      ],
    });
    await expect(runAdapter(invalid.lockPath, invalid.marker)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('operations must not be empty'),
    });
    await expect(readFile(invalid.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    [`import /* comment */ './payload.mjs'\nexport const pack = { modules: [] };\n`, 'payload.mjs'],
    [`const load = () => import('./payload.mjs');\nexport const pack = { modules: [], load };\n`, '<dynamic-import>'],
  ])('rejects unlocked static or dynamic code dependencies before evaluation', async (source, diagnostic) => {
    const value = await fixture(source);
    await writeFile(
      join(value.directory, 'payload.mjs'),
      `process.getBuiltinModule('node:fs').writeFileSync(process.env.PACK_INTEGRITY_MARKER, 'bad');\n`,
    );
    await expect(runAdapter(value.lockPath, value.marker)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(diagnostic),
    });
    await expect(readFile(value.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('verifies the complete lock set before evaluating the first Pack', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seedlands-pack-set-'));
    directories.push(directory);
    const marker = join(directory, 'executed.txt');
    const firstEntry = `process.getBuiltinModule('node:fs').writeFileSync(process.env.PACK_INTEGRITY_MARKER, 'bad');\nexport const pack = { modules: [] };\n`;
    const secondEntry = `export const pack = { modules: [] };\n`;
    const firstManifest = JSON.stringify({
      schemaVersion: 1,
      id: 'example:first',
      version: '1.0.0',
      kind: 'playbook',
      entry: './first.mjs',
      modules: [],
      resources: [],
    });
    const secondManifest = JSON.stringify({
      schemaVersion: 1,
      id: 'example:second',
      version: '1.0.0',
      kind: 'extension',
      entry: './second.mjs',
      modules: [],
      resources: ['./second.bin'],
    });
    await Promise.all([
      writeFile(join(directory, 'first.json'), firstManifest),
      writeFile(join(directory, 'first.mjs'), firstEntry),
      writeFile(join(directory, 'second.json'), secondManifest),
      writeFile(join(directory, 'second.mjs'), secondEntry),
      writeFile(join(directory, 'second.bin'), 'tampered'),
    ]);
    const lockPath = join(directory, 'packs.lock.json');
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: 1,
        packs: [
          {
            id: 'example:first',
            version: '1.0.0',
            manifest: { path: './first.json', sha256: sha256(firstManifest) },
            entry: { path: './first.mjs', sha256: sha256(firstEntry) },
            resources: [],
          },
          {
            id: 'example:second',
            version: '1.0.0',
            manifest: { path: './second.json', sha256: sha256(secondManifest) },
            entry: { path: './second.mjs', sha256: sha256(secondEntry) },
            resources: [{ path: './second.bin', sha256: sha256('original') }],
          },
        ],
      }),
    );
    await expect(runAdapter(lockPath, marker)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('resource digest mismatch'),
    });
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a locked file whose symlink escapes the lock directory', async () => {
    const value = await fixture(`export const pack = { modules: [] };\n`);
    const outside = await mkdtemp(join(tmpdir(), 'seedlands-pack-outside-'));
    directories.push(outside);
    await writeFile(join(outside, 'resource.bin'), 'resource-bytes');
    await rm(join(value.directory, 'texture.bin'));
    await symlink(join(outside, 'resource.bin'), join(value.directory, 'texture.bin'));
    await expect(runAdapter(value.lockPath, value.marker)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('outside the Pack lock directory'),
    });
  });

  it.each([
    [
      'same provider twice',
      [
        { capability: 'example:capability', moduleId: 'example:first' },
        { capability: 'example:capability', moduleId: 'example:first' },
      ],
    ],
    [
      'conflicting providers',
      [
        { capability: 'example:capability', moduleId: 'example:first' },
        { capability: 'example:capability', moduleId: 'example:second' },
      ],
    ],
  ])('rejects duplicate provider selections before evaluating the Pack: %s', async (_case, providerSelections) => {
    const source = `process.getBuiltinModule('node:fs').writeFileSync(process.env.PACK_INTEGRITY_MARKER, 'bad');\nexport const pack = { modules: [] };\n`;
    const value = await fixture(source, {
      providerSelections,
    });
    await expect(runAdapter(value.lockPath, value.marker)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('provider selection'),
    });
    await expect(readFile(value.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns non-polluting deep-frozen manifest, receipt and loaded descriptors', async () => {
    const descriptor = {
      id: 'example:module',
      version: '1.0.0',
      provides: [{ id: 'example:capability', version: '1.0.0' }],
      permissions: [{ resource: 'world.identity', operations: ['read'] }],
    };
    const source = `const descriptor = ${JSON.stringify(descriptor)};\nglobalThis.__packDescriptor = descriptor;\nexport const pack = { modules: [{ descriptor, register(api) { api.provideCapability(descriptor.provides[0].id, {}); } }] };\n`;
    const value = await fixture(source, { modules: [descriptor] });
    const runner = `
      import { pathToFileURL } from 'node:url';
      const { loadVerifiedPackArtifacts } = await import(pathToFileURL(${JSON.stringify(adapter)}).href);
      const [artifact] = await loadVerifiedPackArtifacts(${JSON.stringify(value.lockPath)});
      let mutationRejected = false;
      try { artifact.modules[0].descriptor.provides[0].id = 'example:mutated'; } catch { mutationRejected = true; }
      let callbackCapability = '';
      artifact.modules[0].register({ provideCapability(id) { callbackCapability = id; } });
      process.stdout.write(JSON.stringify({
        manifestDeepFrozen: Object.isFrozen(artifact.manifest.modules[0].permissions[0].operations),
        receiptDeepFrozen: Object.isFrozen(artifact.integrity.resources),
        descriptorDeepFrozen: Object.isFrozen(artifact.modules[0].descriptor.provides[0]),
        authorObjectNotFrozen: !Object.isFrozen(globalThis.__packDescriptor.provides[0]),
        mutationRejected,
        descriptorId: artifact.modules[0].descriptor.provides[0].id,
        callbackCapability,
      }));
    `;
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', runner]);
    expect(JSON.parse(stdout)).toEqual({
      manifestDeepFrozen: true,
      receiptDeepFrozen: true,
      descriptorDeepFrozen: true,
      authorObjectNotFrozen: true,
      mutationRejected: true,
      descriptorId: 'example:capability',
      callbackCapability: 'example:capability',
    });
  });
});
