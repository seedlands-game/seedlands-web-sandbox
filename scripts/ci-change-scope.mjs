import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const documentationDirectories = ['.agents/', 'changes/', 'docs/'];
const documentationExtensions = new Set(['.gif', '.jpeg', '.jpg', '.md', '.png', '.svg', '.webp']);
const documentationRootFiles = new Set(['LICENSE', 'NOTICE']);
const fullCiDocumentationFiles = new Set(['AGENTS.md', 'docs/development-governance.md']);

const extensionOf = (path) => {
  const filename = path.slice(path.lastIndexOf('/') + 1);
  const dot = filename.lastIndexOf('.');
  return dot <= 0 ? '' : filename.slice(dot).toLowerCase();
};

const isSafeRepositoryPath = (path) => {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\0')) {
    return false;
  }

  const segments = path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
};

export const isDocumentationOnlyPath = (path) => {
  if (!isSafeRepositoryPath(path) || fullCiDocumentationFiles.has(path)) {
    return false;
  }

  if (!path.includes('/')) {
    return documentationRootFiles.has(path) || extensionOf(path) === '.md';
  }

  return (
    documentationDirectories.some((directory) => path.startsWith(directory)) &&
    documentationExtensions.has(extensionOf(path))
  );
};

export const classifyChangedPaths = (paths) => {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { runFull: true, reason: 'no-changes' };
  }

  return paths.every(isDocumentationOnlyPath)
    ? { runFull: false, reason: 'docs-only' }
    : { runFull: true, reason: 'non-documentation' };
};

export const selectCiScope = (eventName, paths) => {
  if (eventName === 'pull_request') {
    return classifyChangedPaths(paths);
  }
  if (eventName === 'push') {
    return { runFull: true, reason: 'main-push' };
  }
  return { runFull: true, reason: 'unsupported-event' };
};

export const parseNulSeparatedPaths = (input) => {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.length === 0) {
    return [];
  }
  if (bytes[bytes.length - 1] !== 0) {
    throw new Error('Changed path input must be NUL-terminated');
  }

  return bytes.subarray(0, -1).toString('utf8').split('\0');
};

const printGitHubOutputs = ({ runFull, reason }) => {
  process.stdout.write(`run_full=${runFull}\nreason=${reason}\n`);
};

const runCli = () => {
  try {
    const eventFlag = process.argv.indexOf('--event');
    const eventName = eventFlag === -1 ? undefined : process.argv[eventFlag + 1];
    if (!eventName) {
      throw new Error('Missing --event');
    }
    const input = readFileSync(0);
    printGitHubOutputs(selectCiScope(eventName, parseNulSeparatedPaths(input)));
  } catch {
    printGitHubOutputs({ runFull: true, reason: 'invalid-input' });
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli();
}
