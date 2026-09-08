import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function buildNodeServerArtifactFixture(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const artifact = join(directory, 'dist');
  const builder = pathToFileURL(resolve('scripts/build-node-server.mjs')).href;
  try {
    await run(process.execPath, [
      '--input-type=module',
      '-e',
      `import { buildNodeServer } from ${JSON.stringify(builder)}; await buildNodeServer(${JSON.stringify(artifact)});`,
    ]);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({
    entry: (name: string) => pathToFileURL(join(artifact, `${name}.js`)),
    close: () => rm(directory, { recursive: true, force: true }),
  });
}
