import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';
import type { PackManifest } from '@seedlands/stdlib/mod-api';
import {
  assembleProductPacks,
  type ProductExtensionAdmission,
  type VerifiedPackArtifact,
} from '@seedlands/stdlib/host';

type LockedPack = {
  id: string;
  version: string;
  manifest: { path: string; sha256: string };
  entry: { path: string; sha256: string };
  resources: never[];
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Real independently bundled extension bytes, not a class shared with the runtime under test. */
export async function buildCampPackFixture(options: { failingCondition?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-npc-camp-pack-'));
  const builder = (await import(pathToFileURL(resolve('scripts/build-gameplay-packs.mjs')).href)) as {
    buildGameplayPacks(path: string): Promise<{ lockPath: string }>;
  };
  const loader = (await import(pathToFileURL(resolve('scripts/pack-integrity.mjs')).href)) as {
    loadVerifiedPackArtifacts(path: string): Promise<readonly VerifiedPackArtifact[]>;
  };
  try {
    const { lockPath } = await builder.buildGameplayPacks(directory);
    const output = await build({
      absWorkingDir: process.cwd(),
      entryPoints: [
        `apps/web/tests/fixtures/packs/camp-work/${options.failingCondition ? 'failing-camp-work' : 'camp-work'}.ts`,
      ],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
    });
    const entryBytes = output.outputFiles[0].contents;
    const namespace = (await import(`data:text/javascript;base64,${Buffer.from(entryBytes).toString('base64')}`)) as {
      pack: { manifest: PackManifest };
    };
    const manifest = namespace.pack.manifest;
    if (manifest.id !== 'sample:camp-work' || manifest.entry !== 'camp-work.mjs')
      throw new Error('Camp fixture built an unexpected artifact');
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { schemaVersion: 1; packs: LockedPack[] };
    lock.packs.push({
      id: manifest.id,
      version: manifest.version,
      manifest: { path: 'camp-work.manifest.json', sha256: digest(manifestBytes) },
      entry: { path: manifest.entry, sha256: digest(entryBytes) },
      resources: [],
    });
    await writeFile(join(directory, manifest.entry), entryBytes);
    await writeFile(join(directory, 'camp-work.manifest.json'), manifestBytes);
    await writeFile(lockPath, JSON.stringify(lock));
    const artifacts = await loader.loadVerifiedPackArtifacts(lockPath);
    // Host grants are deliberately independent of the extension's requested permissions.
    const extension = artifacts.find((artifact) => artifact.manifest.id === 'sample:camp-work')!;
    const approvedExtensions: readonly ProductExtensionAdmission[] = [
      {
        id: extension.manifest.id,
        version: extension.manifest.version,
        integrity: extension.integrity,
        permissions: options.failingCondition ? [] : [{ resource: 'seedlands.inventory', operations: ['execute'] }],
      },
    ];
    await writeFile(
      join(directory, 'host-admissions.json'),
      JSON.stringify({ schemaVersion: 1, extensions: approvedExtensions }),
    );
    return {
      artifacts,
      approvedExtensions,
      createComposition: () => assembleProductPacks(artifacts, { approvedExtensions }),
      async route(page: Page) {
        const names = [
          'packs.lock.json',
          'host-admissions.json',
          ...lock.packs.flatMap((pack) => [pack.manifest.path, pack.entry.path]),
        ];
        const files = new Map(
          await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name))] as const)),
        );
        await page.route('**/packs/*', async (route) => {
          const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
          const bytes = files.get(name);
          if (!bytes) throw new Error(`Unapproved fixture artifact ${name}`);
          await route.fulfill({
            status: 200,
            contentType: name.endsWith('.mjs') ? 'text/javascript' : 'application/json',
            body: bytes,
          });
        });
      },
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
