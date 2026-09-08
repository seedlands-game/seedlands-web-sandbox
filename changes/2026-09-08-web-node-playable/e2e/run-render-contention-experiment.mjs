import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const selfTest = process.argv.includes('--self-test');
const outputDirectory = resolve(
  process.env.SEEDLANDS_RENDER_CONTENTION_OUTPUT ?? '/tmp/seedlands-web-node-playable/render-contention',
);
const sourceSha = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceTreeStatus = () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
const invocationPath = resolve(outputDirectory, 'invocation.json');
const files = [
  'playwright.config.ts',
  'apps/node-server/dist/node-server.js',
  'changes/2026-09-08-web-node-playable/e2e/remote-playable-node-fixture.ts',
  'changes/2026-09-08-web-node-playable/e2e/render-contention-probe.ts',
  'changes/2026-09-08-web-node-playable/e2e/render-contention.spec.ts',
  'changes/2026-09-08-web-node-playable/e2e/run-render-contention-experiment.mjs',
  'changes/2026-09-08-web-node-playable/render-contention-experiment.json',
];

await mkdir(outputDirectory, { recursive: true });
for (const file of files) if (!existsSync(file)) throw new Error(`Missing frozen experiment input: ${file}`);
if (!selfTest && existsSync(invocationPath))
  throw new Error(`Formal render-contention output already exists: ${invocationPath}`);
const treeStatus = sourceTreeStatus();
if (!selfTest && treeStatus) throw new Error('Formal render-contention sampling requires a clean source tree.');
const sourceInputs = Object.fromEntries(
  files.map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
);
await writeFile(
  invocationPath,
  `${JSON.stringify(
    {
      kind: 'seedlands-render-contention-invocation',
      sourceSha: sourceSha(),
      sourceTreeStatus: treeStatus,
      mode: selfTest ? 'functional-self-test' : 'formal-AAABBA',
      sourceInputs,
      outputDirectory,
    },
    null,
    2,
  )}\n`,
);

const log = createWriteStream(resolve(outputDirectory, 'playwright.log'), { flags: 'w' });
const child = spawn(
  'pnpm',
  ['exec', 'playwright', 'test', 'changes/2026-09-08-web-node-playable/e2e/render-contention.spec.ts'],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SEEDLANDS_RENDER_CONTENTION_EXPERIMENT: '1',
      SEEDLANDS_RENDER_CONTENTION_OUTPUT: outputDirectory,
      ...(selfTest ? { SEEDLANDS_RENDER_CONTENTION_SELF_TEST: '1' } : {}),
    },
  },
);
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
const exitCode = await new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code ?? 1)));
await new Promise((resolveClose) => log.end(resolveClose));
await writeFile(resolve(outputDirectory, 'exit-code.txt'), `${exitCode}\n`);
process.exit(exitCode);
