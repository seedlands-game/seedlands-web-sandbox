#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadVerifiedPackArtifacts } from './pack-integrity.mjs';
import { permissionsForProductPlaybook } from './product-pack-admissions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const resourcePath = (value) =>
  typeof value === 'string' &&
  /^(?:\.\/)?[a-zA-Z0-9_-][a-zA-Z0-9._/-]*$/.test(value) &&
  !value.split('/').some((part) => part === '..' || part === '');
const readDeclaredResource = async (path) => {
  if (!resourcePath(path)) throw new TypeError(`Pack resource path is invalid: ${String(path)}`);
  const file = resolve(root, path);
  const fromRoot = relative(root, file);
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('../'))
    throw new TypeError(`Pack resource resolves outside the repository: ${path}`);
  return { path: path.replace(/^\.\//, ''), bytes: await readFile(file) };
};

const playbooks = {
  overworld: { entry: 'playbooks/classic/src/pack.ts', id: 'seedlands:overworld' },
  'click-conversion': {
    entry: 'apps/web/tests/fixtures/packs/builder/click-conversion.ts',
    id: 'seedlands:click-conversion',
  },
  builder: { entry: 'apps/web/tests/fixtures/packs/builder/builder.ts', id: 'seedlands:builder' },
  'modular-world': {
    entry: 'apps/web/tests/fixtures/packs/modular-world/modular-world.ts',
    id: 'sample:modular-world',
  },
};

export async function buildGameplayPacks(
  outputDirectory = resolve(root, 'dist/packs'),
  playbook = process.env.SEEDLANDS_PLAYBOOK ?? 'overworld',
) {
  if (!Object.hasOwn(playbooks, playbook)) throw new TypeError(`Unknown local Playbook: ${playbook}`);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [playbooks[playbook].entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    treeShaking: true,
    legalComments: 'inline',
  });
  const entryBytes = result.outputFiles[0].contents;
  const namespace = await import(`data:text/javascript;base64,${Buffer.from(entryBytes).toString('base64')}`);
  const manifest = namespace.pack?.manifest;
  if (!manifest || manifest.entry !== `${playbook}.mjs` || manifest.id !== playbooks[playbook].id)
    throw new TypeError('Built Playbook manifest is invalid.');
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const resources = await Promise.all((manifest.resources ?? []).map(readDeclaredResource));
  const lock = {
    schemaVersion: 1,
    packs: [
      {
        id: manifest.id,
        version: manifest.version,
        manifest: { path: `${playbook}.manifest.json`, sha256: digest(manifestBytes) },
        entry: { path: manifest.entry, sha256: digest(entryBytes) },
        resources: resources.map(({ path, bytes }) => ({ path, sha256: digest(bytes) })),
      },
    ],
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, manifest.entry), entryBytes);
  await writeFile(resolve(outputDirectory, `${playbook}.manifest.json`), manifestBytes);
  await Promise.all(
    resources.map(async ({ path, bytes }) => {
      const output = resolve(outputDirectory, path);
      const fromOutput = relative(outputDirectory, output);
      if (isAbsolute(fromOutput) || fromOutput === '..' || fromOutput.startsWith('../'))
        throw new TypeError(`Pack resource resolves outside the build directory: ${path}`);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, bytes);
    }),
  );
  const lockPath = resolve(outputDirectory, 'packs.lock.json');
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  // Product deployment policy is separate from untrusted Pack permission requests.
  const playbookAdmission = {
    id: manifest.id,
    version: manifest.version,
    integrity: {
      algorithm: 'sha256',
      manifestDigest: lock.packs[0].manifest.sha256,
      entryDigest: lock.packs[0].entry.sha256,
      resources: lock.packs[0].resources.map(({ path, sha256 }) => ({ path, digest: sha256 })),
    },
    permissions: permissionsForProductPlaybook(manifest.id),
  };
  await writeFile(
    resolve(outputDirectory, 'host-admissions.json'),
    `${JSON.stringify({ schemaVersion: 1, playbook: playbookAdmission, extensions: [] }, null, 2)}\n`,
  );
  await loadVerifiedPackArtifacts(lockPath);
  return Object.freeze({ lockPath, lock });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--out');
  const selected = process.argv.indexOf('--playbook');
  buildGameplayPacks(
    index < 0 ? undefined : resolve(process.argv[index + 1]),
    selected < 0 ? undefined : process.argv[selected + 1],
  )
    .then(({ lockPath }) => {
      process.stdout.write(`${JSON.stringify({ ok: true, lockPath })}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
