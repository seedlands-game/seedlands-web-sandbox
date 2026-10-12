import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const mib = 1024 ** 2;
const evidenceDirectory =
  /^(?:changes\/[^/]+\/evidence\/|reports\/|harness\/results\/|playwright-report\/|test-results\/|midscene_run\/)/;
const traceZip = /(?:^|\/)[^/]*trace[^/]*\.zip(?:$|\.(?:part-[^/]+|\d+)$)/i;
const zipPart = /\.zip\.(?:part-[^/]+|\d+)$/i;
const runtimeArchive = /\.(?:zip|mp4|webm)$/i;

export const evaluateEntries = (entries) => {
  const issues = [];
  for (const { path, size } of entries) {
    if (typeof path !== 'string' || path.length === 0 || !Number.isSafeInteger(size) || size < 0) {
      throw new Error('Invalid Git artifact metadata');
    }
    if (traceZip.test(path) || zipPart.test(path) || (evidenceDirectory.test(path) && runtimeArchive.test(path))) {
      issues.push({
        path,
        size,
        level: 'error',
        reason: '运行产物须保存到 artifact/对象存储，Git 只保留小型报告与 manifest',
      });
    } else if (size > 50 * mib) {
      issues.push({ path, size, level: 'error', reason: 'blob 超过 50 MiB 文件预算' });
    } else if (size > 10 * mib) {
      issues.push({ path, size, level: 'warning', reason: 'blob 超过 10 MiB，请评估 artifact 或 LFS' });
    }
  }
  return issues;
};

const git = (args, input) => {
  const result = spawnSync('git', ['--no-pager', '--no-optional-locks', ...args], {
    input,
    maxBuffer: 64 * 1024 ** 2,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git metadata query failed: ${result.error?.message ?? result.stderr.toString('utf8').trim()}`);
  }
  try {
    return utf8Decoder.decode(result.stdout);
  } catch {
    throw new Error('Git metadata is not valid UTF-8; refusing lossy path comparison');
  }
};

// Raw headers and paths are distinct NUL fields: do not trim or split filenames on whitespace.
const parseRawEntries = (output) => {
  if (output && !output.endsWith('\0')) throw new Error('Git raw diff is not NUL-terminated');
  const fields = output.split('\0');
  const entries = [];
  for (let index = 0; index < fields.length; index += 1) {
    const header = fields[index].replace(/^\n+/, '');
    if (!header) continue;
    const match = /^:\d{6} (\d{6}) [a-f0-9]{40,64} ([a-f0-9]{40,64}) [AMT]$/.exec(header);
    if (!match || !fields[index + 1]) throw new Error('Malformed Git raw artifact metadata');
    const path = fields[++index];
    if (match[1] !== '160000') entries.push({ path, oid: match[2] });
  }
  return entries;
};

const resolveCommit = (ref) => {
  if (!ref || ref.startsWith('-') || !/^[a-zA-Z0-9_./-]+$/.test(ref)) throw new Error('Invalid commit reference');
  return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
};

const baselineEntries = (base) => {
  const entries = new Map();
  for (const row of git(['ls-tree', '-r', '-z', base]).split('\0')) {
    if (!row) continue;
    const separator = row.indexOf('\t');
    const metadata = row.slice(0, separator).split(' ');
    if (separator < 0 || metadata.length !== 3) throw new Error('Malformed baseline tree metadata');
    if (metadata[1] === 'blob') entries.set(row.slice(separator + 1), metadata[2]);
  }
  return entries;
};

const attachSizes = (entries) => {
  const unique = [...new Map(entries.map((entry) => [JSON.stringify([entry.path, entry.oid]), entry])).values()];
  if (unique.length === 0) return [];
  const oids = [...new Set(unique.map(({ oid }) => oid))];
  const sizes = new Map();
  const output = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], `${oids.join('\n')}\n`);
  for (const row of output.trimEnd().split('\n')) {
    const [oid, type, size] = row.split(' ');
    if (type !== 'blob' || !/^\d+$/.test(size)) throw new Error('Missing or invalid artifact blob');
    sizes.set(oid, Number(size));
  }
  return unique.map((entry) => ({ ...entry, size: sizes.get(entry.oid) }));
};

const runCli = () => {
  const args = process.argv.slice(2);
  let entries;
  const diffOptions = [
    '--raw',
    '--no-abbrev',
    '--no-renames',
    '--no-ext-diff',
    '--no-textconv',
    '--diff-filter=AMT',
    '-z',
  ];
  if (args.length === 1 && args[0] === '--staged') {
    if (git(['ls-files', '--unmerged', '-z']))
      throw new Error('Unmerged index: resolve conflicts before artifact checks');
    entries = parseRawEntries(git(['diff', '--cached', ...diffOptions]));
  } else if (
    (args.length === 2 || args.length === 4) &&
    args[0] === '--base' &&
    (args.length === 2 || args[2] === '--head')
  ) {
    const base = resolveCommit(args[1]);
    const head = resolveCommit(args[3] ?? 'HEAD');
    const baseline = baselineEntries(base);
    entries = parseRawEntries(
      git(['log', '--format=', '--root', '-m', ...diffOptions, `${base}..${head}`, '--']),
    ).filter(({ path, oid }) => baseline.get(path) !== oid);
  } else {
    throw new Error('Usage: pnpm check:git-artifacts --staged | --base <commit> [--head <commit>]');
  }
  const issues = evaluateEntries(attachSizes(entries));
  for (const issue of issues) {
    console.error(`${issue.level.toUpperCase()} ${JSON.stringify(issue.path)} (${issue.size} bytes): ${issue.reason}`);
  }
  const errors = issues.filter(({ level }) => level === 'error').length;
  console.log(`Git artifact budget: ${entries.length} metadata entries checked; ${errors} errors`);
  if (errors > 0) process.exitCode = 1;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid Git artifact check');
    process.exitCode = 1;
  }
}
