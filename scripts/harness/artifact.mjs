import { existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readWorkingSnapshot } from './repository-snapshot.mjs';

export const root = resolve(import.meta.dirname, '../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function sourceIdentity(directory = root) {
  const snapshot = readWorkingSnapshot(directory);
  const relevant = Object.entries(snapshot.files).filter(
    ([path]) =>
      !/(?:^|\/)(?:dist|node_modules|coverage|test-results|playwright-report)\//.test(path) &&
      /^(?:(?:apps|packages|playbooks)\/|crates\/|wasm\/|scripts\/|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig)/.test(
        path,
      ),
  );
  return {
    sourceSha: snapshot.sha,
    sourceDigest: hash(
      relevant
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path]) => `${path}\0${hash(readFileSync(resolve(directory, path)))}`)
        .join('\0'),
    ),
    lockDigest: hash(readFileSync(resolve(directory, 'pnpm-lock.yaml'))),
  };
}
export function distFiles(directory) {
  const files = {};
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const absolute = resolve(path, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name !== 'harness-artifact.json')
        files[relative(directory, absolute).replaceAll('\\', '/')] = hash(readFileSync(absolute));
      else if (!entry.isFile()) throw new Error('Production artifacts must not contain symlinks.');
    }
  }
  visit(directory);
  if (
    !files['index.html'] ||
    !Object.keys(files).some((path) => path.endsWith('.wasm')) ||
    !files['packs/packs.lock.json']
  )
    throw new Error('Incomplete production artifact: HTML, Wasm and Pack lock are required.');
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
export function verifyArtifact(directory = root) {
  const dist = resolve(directory, 'apps/web/dist');
  const artifact = JSON.parse(readFileSync(resolve(dist, 'harness-artifact.json'), 'utf8'));
  const identity = sourceIdentity(directory);
  for (const key of ['sourceSha', 'sourceDigest', 'lockDigest'])
    if (artifact[key] !== identity[key]) throw new Error(`Stale production identity: ${key}`);
  const files = distFiles(dist);
  if (JSON.stringify(files) !== JSON.stringify(artifact.files)) throw new Error('Production artifact bytes changed.');
  if (hash(JSON.stringify(files)) !== artifact.artifactDigest) throw new Error('Invalid production artifact digest.');
  return artifact;
}
export function buildArtifact(directory = root) {
  const before = sourceIdentity(directory);
  for (const script of ['build:web', 'build:agent']) {
    const result = spawnSync('pnpm', [script], { cwd: directory, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script} failed: ${result.status}`);
  }
  const after = sourceIdentity(directory);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Source changed while building; artifact not accepted.');
  const dist = resolve(directory, 'apps/web/dist');
  const files = distFiles(dist);
  const artifact = {
    schemaVersion: 1,
    ...after,
    artifactDigest: hash(JSON.stringify(files)),
    files,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(resolve(dist, 'harness-artifact.json'), JSON.stringify(artifact, null, 2) + '\n');
  return verifyArtifact(directory);
}
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes('--help')) {
    process.stdout.write('artifact [--build]\n');
    process.exit(0);
  }
  try {
    const artifact = process.argv.includes('--build') ? buildArtifact() : verifyArtifact();
    process.stdout.write(
      JSON.stringify({ status: 'PASS', ...artifact, files: Object.keys(artifact.files).length }) + '\n',
    );
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  }
}
