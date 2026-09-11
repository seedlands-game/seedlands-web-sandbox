import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';

const textual = (path) => /\.(?:[cm]?[jt]sx?|svelte|json|ya?ml|md|css|html|toml|rs)$/.test(path);
const safePath = (path) =>
  !path.split('/').some((part) => part === '.env' || part.startsWith('.env.') || part === 'node_modules');
const registryPath = 'harness/contracts.json';
export const git = (root, args, options = {}) =>
  execFileSync('git', args, { cwd: root, maxBuffer: 96 * 1024 * 1024, ...options });

function registryFrom(files) {
  if (!files[registryPath]) return null;
  try {
    return JSON.parse(files[registryPath]);
  } catch {
    return { schemaVersion: 0, owners: [] };
  }
}

export function readCommitSnapshot(root, ref) {
  if (!ref || !/^[0-9a-f]{7,40}$/i.test(ref)) throw new TypeError('Use an exact Git commit SHA for a snapshot.');
  const sha = git(root, ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  const paths = git(root, ['ls-tree', '-r', '--name-only', '-z', sha], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => path && safePath(path));
  const files = Object.fromEntries(paths.map((path) => [path, '']));
  const texts = paths.filter(textual);
  const output = git(root, ['cat-file', '--batch'], { input: texts.map((path) => `${sha}:${path}\n`).join('') });
  let offset = 0;
  for (const path of texts) {
    const end = output.indexOf(10, offset);
    if (end < 0) throw new Error('Truncated Git object batch.');
    const [, type, length] = output.subarray(offset, end).toString('utf8').split(' ');
    const size = Number(length);
    if (type !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid Git source blob: ${path}`);
    offset = end + 1;
    files[path] = output.subarray(offset, offset + size).toString('utf8');
    offset += size + 1;
  }
  return { sha, files, registry: registryFrom(files) };
}

export function readWorkingSnapshot(root) {
  const sha = git(root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const paths = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(
      (path) => path && safePath(path) && existsSync(resolve(root, path)) && lstatSync(resolve(root, path)).isFile(),
    );
  const files = Object.fromEntries(
    paths.map((path) => [path, textual(path) ? readFileSync(resolve(root, path), 'utf8') : '']),
  );
  const contentHash = createHash('sha256');
  for (const path of paths.sort()) {
    contentHash.update(path);
    contentHash.update('\0');
    contentHash.update(readFileSync(resolve(root, path)));
  }
  return { sha, files, registry: registryFrom(files), worktreeDigest: contentHash.digest('hex') };
}

export function changedPathsBetween(root, baseSha, headSha) {
  if (!baseSha || !/^[0-9a-f]{7,40}$/i.test(baseSha))
    throw new TypeError('An exact base commit SHA is required to compute a diff.');
  // --no-renames exposes both the deleted and added paths; neither side loses its owner.
  const args = ['diff', '--no-renames', '--name-only', '-z', baseSha];
  if (headSha) args.push(headSha);
  const paths = git(root, args, { encoding: 'utf8' }).split('\0').filter(Boolean);
  if (!headSha)
    paths.push(
      ...git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
    );
  return [...new Set(paths.filter(safePath))].sort();
}
