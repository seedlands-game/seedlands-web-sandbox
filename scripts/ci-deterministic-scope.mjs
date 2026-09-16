import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseNulSeparatedPaths } from './ci-change-scope.mjs';

const sharedFiles = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'vitest.config.ts',
  'eslint.config.mjs',
]);
const unrelatedPrefixes = ['apps/', 'archives/', 'changes/', 'docs/', 'harness/', 'playbooks/'];
const unrelatedRootFiles = new Set(['LICENSE', 'NOTICE']);

const all = (reason) => ({ runKernel: true, runStdlib: true, reason });

const isSafePath = (path) =>
  typeof path === 'string' &&
  path.length > 0 &&
  !path.startsWith('/') &&
  !path.includes('\0') &&
  path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

const isSharedPath = (path) =>
  sharedFiles.has(path) ||
  /^tsconfig[^/]*\.json$/.test(path) ||
  path.startsWith('.github/') ||
  path.startsWith('packages/eslint-plugin/') ||
  path.startsWith('scripts/');

const isUnrelatedPath = (path) =>
  unrelatedPrefixes.some((prefix) => path.startsWith(prefix)) ||
  unrelatedRootFiles.has(path) ||
  (!path.includes('/') && path.endsWith('.md'));

export const selectDeterministicScope = (eventName, paths) => {
  if (eventName !== 'pull_request') {
    return all('non-pr-event');
  }
  if (!Array.isArray(paths) || paths.some((path) => !isSafePath(path))) {
    throw new Error('Invalid changed paths');
  }
  if (paths.length === 0) {
    return all('empty-diff');
  }
  if (paths.some(isSharedPath)) {
    return all('shared-change');
  }
  if (paths.some((path) => path.startsWith('packages/kernel/'))) {
    return all('kernel-and-downstream-stdlib');
  }
  if (paths.some((path) => !path.startsWith('packages/stdlib/') && !isUnrelatedPath(path))) {
    return all('unowned-change');
  }
  if (paths.some((path) => path.startsWith('packages/stdlib/'))) {
    return { runKernel: false, runStdlib: true, reason: 'stdlib-change' };
  }
  return { runKernel: false, runStdlib: false, reason: 'no-deterministic-owner-change' };
};

const runCli = () => {
  const eventFlag = process.argv.indexOf('--event');
  const eventName = eventFlag === -1 ? undefined : process.argv[eventFlag + 1];
  if (!eventName) {
    throw new Error('Missing --event');
  }
  const paths = parseNulSeparatedPaths(readFileSync(0));
  const scope = selectDeterministicScope(eventName, paths);
  process.stdout.write(`run_kernel=${scope.runKernel}\nrun_stdlib=${scope.runStdlib}\nreason=${scope.reason}\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid CI scope input');
    process.exitCode = 1;
  }
}
