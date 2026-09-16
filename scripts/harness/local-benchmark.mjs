import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus, platform, arch } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { sourceIdentity, root } from './artifact.mjs';
import { requirePerformanceWindowContext, writeMeasurementDeclaration } from './performance-window-proof.mjs';
const window = requirePerformanceWindowContext();
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const value = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined);
const owner = value('--owner');
const scenario = value('--scenario') ?? (owner === 'stdlib-server' ? 'world-mutation' : 'mesh');
const profile = {
  'stdlib-server/world-mutation': 'world-mutation',
  'stdlib-world/chunk-codec': 'chunk-snapshot-codec',
}[`${owner}/${scenario}`];
if (profile) {
  const before = sourceIdentity();
  const runId = `${scenario}-${randomUUID()}`;
  const directory = resolve(root, 'harness/results', runId);
  mkdirSync(directory, { recursive: true });
  const sampleStartedAt = new Date().toISOString();
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--config',
      'packages/stdlib/vitest.bench.config.ts',
      `packages/stdlib/benchmarks/${profile}.test.ts`,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${resolve(directory, 'contracts.json')}`,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  const sampleCompletedAt = new Date().toISOString();
  writeFileSync(resolve(directory, 'raw.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  const unchanged = JSON.stringify(before) === JSON.stringify(sourceIdentity());
  const measurement = {
    schemaVersion: 1,
    runId,
    owner,
    scenario,
    windowId: window.windowId,
    evidencePath: window.evidencePath,
    sampleStartedAt,
    sampleCompletedAt,
    ...before,
    status: result.status === 0 && unchanged ? 'PASS' : 'FAIL',
    boundary: 'Existing owner benchmark assertions; raw measurements retained in raw.log. Not a new accepted baseline.',
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown' },
    exitCode: result.status,
    sourceUnchanged: unchanged,
  };
  const measurementPath = resolve(directory, 'local.json');
  writeFileSync(measurementPath, JSON.stringify(measurement, null, 2) + '\n');
  writeMeasurementDeclaration(window, { measurementPath, format: 'local', runId, owner, scenario });
  if (result.error) throw result.error;
  process.exit(unchanged ? (result.status ?? 1) : 1);
}
if (owner !== 'stdlib-world' || scenario !== 'mesh')
  throw new Error(
    'Use --owner stdlib-world [--scenario mesh|chunk-codec], or --owner stdlib-server --scenario world-mutation.',
  );
const before = sourceIdentity();
const compiled = await build({
  absWorkingDir: root,
  entryPoints: ['scripts/harness/local-benchmark-entry.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
});
const bytes = compiled.outputFiles[0].contents;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bytes).toString('base64')}`);
const samples = [];
// A timing sample is not a functional PASS and does not establish an A/B gain.
for (let index = 0; index < 2; index++) runtime.meshSample();
const sampleStartedAt = new Date().toISOString();
for (let index = 0; index < 10; index++) samples.push(runtime.meshSample());
const sampleCompletedAt = new Date().toISOString();
if (JSON.stringify(before) !== JSON.stringify(sourceIdentity())) throw new Error('Source changed during sampling.');
const runId = `mesh-${randomUUID()}`;
const directory = resolve(root, 'harness/results', runId);
mkdirSync(directory, { recursive: true });
const result = {
  schemaVersion: 1,
  runId,
  status: 'MEASURED',
  owner,
  scenario: 'mesh-corpus-v1',
  windowId: window.windowId,
  evidencePath: window.evidencePath,
  sampleStartedAt,
  sampleCompletedAt,
  ...before,
  bundleDigest: createHash('sha256').update(bytes).digest('hex'),
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown' },
  boundary: {
    preparation: '35 deterministic chunks generated in process',
    measured: 'preparation + synchronous chunk mesh computation',
    excludes: ['Worker transfer', 'Wasm ABI', 'GPU rendering', 'browser frame latency'],
  },
  comparison: 'NOT_COMPARABLE_WITH_RUNTIME',
  samples,
};
const measurementPath = resolve(directory, 'local.json');
writeFileSync(measurementPath, JSON.stringify(result, null, 2) + '\n');
writeMeasurementDeclaration(window, {
  measurementPath,
  format: 'local',
  runId,
  owner,
  scenario: result.scenario,
});
process.stdout.write(`MEASURED ${measurementPath}\n`);
