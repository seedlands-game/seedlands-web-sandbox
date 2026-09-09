import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it('an independent author project compiles and runs through package exports without host factories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-mod-consumer-'));
  try {
    await mkdir(join(directory, 'node_modules/@seedlands'), { recursive: true });
    await symlink(join(process.cwd(), 'packages/game-core'), join(directory, 'node_modules/@seedlands/game-core'));
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const entry = join(directory, 'consumer.ts');
    await writeFile(
      entry,
      `import { definePack, type ModModule } from '@seedlands/game-core/mod-api';
// @ts-expect-error Host world construction is intentionally absent from the author facade.
import type { createWorldFromPacks } from '@seedlands/game-core/mod-api';
// @ts-expect-error Authors cannot construct authorization contexts.
import type { createAuthorizedModuleExecution } from '@seedlands/game-core/mod-api';
export type ForbiddenHost = typeof createWorldFromPacks | typeof createAuthorizedModuleExecution;
const content: ModModule = {
  descriptor: { id: 'consumer:items', version: '1.0.0' },
  register(api) { api.registerItem({ id: 'consumer:berry', name: 'Berry', stackLimit: 16 }); }
};
export const pack = definePack({ id: 'consumer:playbook', version: '1.0.0', kind: 'playbook', modules: [content] });
`,
    );
    const config = join(directory, 'tsconfig.json');
    await writeFile(
      config,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          lib: ['ES2022'],
          types: [],
          skipLibCheck: false,
          module: 'ESNext',
          moduleResolution: 'Bundler',
        },
        files: ['consumer.ts'],
      }),
    );
    await execute('pnpm', ['exec', 'tsc', '-p', config], { cwd: process.cwd() });
    const output = join(directory, 'consumer.mjs');
    await build({ entryPoints: [entry], outfile: output, bundle: true, format: 'esm', platform: 'neutral' });
    const script = `const {pack} = await import(${JSON.stringify(pathToFileURL(output).href)});
console.log(JSON.stringify({ id: pack.manifest.id, count: pack.modules.length, hasIntegrity: 'integrity' in pack }));`;
    const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', script]);
    expect(JSON.parse(stdout)).toEqual({ id: 'consumer:playbook', count: 1, hasIntegrity: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
