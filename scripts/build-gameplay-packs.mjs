#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadVerifiedPackArtifacts } from './pack-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const playbooks = {
  overworld: 'playbooks/classic/src/pack.ts',
  'click-conversion': 'apps/web/tests/fixtures/packs/builder/click-conversion.ts',
  builder: 'apps/web/tests/fixtures/packs/builder/builder.ts',
};

export async function buildGameplayPacks(
  outputDirectory = resolve(root, 'dist/packs'),
  playbook = process.env.SEEDLANDS_PLAYBOOK ?? 'overworld',
) {
  if (!Object.hasOwn(playbooks, playbook)) throw new TypeError(`Unknown local Playbook: ${playbook}`);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [playbooks[playbook]],
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
  if (!manifest || manifest.entry !== `${playbook}.mjs` || manifest.id !== `seedlands:${playbook}`)
    throw new TypeError('Built Playbook manifest is invalid.');
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const lock = {
    schemaVersion: 1,
    packs: [
      {
        id: manifest.id,
        version: manifest.version,
        manifest: { path: `${playbook}.manifest.json`, sha256: digest(manifestBytes) },
        entry: { path: manifest.entry, sha256: digest(entryBytes) },
        resources: [],
      },
    ],
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, manifest.entry), entryBytes);
  await writeFile(resolve(outputDirectory, `${playbook}.manifest.json`), manifestBytes);
  const lockPath = resolve(outputDirectory, 'packs.lock.json');
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  // Product deployment policy is separate from untrusted Pack permission requests.
  await writeFile(
    resolve(outputDirectory, 'host-admissions.json'),
    `${JSON.stringify({ schemaVersion: 1, extensions: [] }, null, 2)}\n`,
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
