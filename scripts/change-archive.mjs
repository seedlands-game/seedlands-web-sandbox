import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const usage = `用法：
  node scripts/change-archive.mjs [--root <仓库>] archive <archives/changes/*.zip> <changes/<change>> [...]
  node scripts/change-archive.mjs [--root <仓库>] verify <archives/changes/*.zip>
  node scripts/change-archive.mjs [--root <仓库>] extract <archives/changes/*.zip> <恢复目录>`;

const fail = (message) => {
  throw new Error(`${message}\n${usage}`);
};

const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const posix = (path) => path.split(sep).join('/');
const unzipOptions = { maxBuffer: 64 * 1024 * 1024 };

const relativeInside = (root, candidate, label) => {
  const path = normalize(candidate).replaceAll('\\', '/');
  if (path.startsWith('../') || path === '..' || path.startsWith('/') || !path.startsWith(`${label}/`))
    fail(`${label} 路径必须位于仓库内：${candidate}`);
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) fail(`拒绝路径越界：${candidate}`);
  return { path, absolute };
};

const directoryInside = (root, candidate) => {
  const path = normalize(candidate).replaceAll('\\', '/');
  if (path.startsWith('../') || path === '..' || path.startsWith('/') || path === '.')
    fail(`恢复目录必须位于仓库内：${candidate}`);
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) fail(`拒绝路径越界：${candidate}`);
  return { path, absolute };
};

const rejectSymlinkAncestors = async (root, target) => {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  let current = rootPath;
  if ((await lstat(current)).isSymbolicLink()) fail('拒绝符号链接仓库根目录。');
  for (const segment of relative(rootPath, targetPath).split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (existsSync(current) && (await lstat(current)).isSymbolicLink())
      fail(`拒绝符号链接路径：${posix(relative(rootPath, current))}`);
  }
};

const filesIn = async (root, directory) => {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const status = await lstat(absolute);
    if (status.isSymbolicLink()) fail(`归档不接受符号链接：${posix(relative(root, absolute))}`);
    if (status.isDirectory()) results.push(...(await filesIn(root, absolute)));
    else if (status.isFile()) results.push(absolute);
    else fail(`归档只接受常规文件：${posix(relative(root, absolute))}`);
  }
  return results.sort();
};

const isDelivered = async (source) => {
  const spec = join(source.absolute, 'spec.md');
  if (!existsSync(spec)) return false;
  return /(?:状态|Status)\s*[:：]?\s*Delivered\b/i.test((await readFile(spec, 'utf8')).replaceAll('*', ''));
};

const protectedFiles = ['package.json', 'playwright.config.ts', 'tsconfig.json', 'tsconfig.test.json'];
const protectedDirectories = ['scripts', 'tests'];

const findReferences = async (root, sourcePath) => {
  const candidates = [
    ...protectedFiles.filter((path) => existsSync(join(root, path))).map((path) => join(root, path)),
    ...(
      await Promise.all(
        protectedDirectories
          .filter((path) => existsSync(join(root, path)))
          .map((path) => filesIn(root, join(root, path))),
      )
    ).flat(),
  ];
  const matches = [];
  for (const file of candidates) {
    if ((await readFile(file, 'utf8')).includes(sourcePath)) matches.push(posix(relative(root, file)));
  }
  return matches;
};

const manifestFor = async (root, sources) => ({
  version: 1,
  createdAt: new Date().toISOString(),
  entries: (
    await Promise.all(
      (
        await Promise.all(
          sources.map(async (source) =>
            (await filesIn(root, source.absolute)).map(async (file) => ({
              path: posix(relative(root, file)),
              sha256: sha256(await readFile(file)),
            })),
          ),
        )
      ).flat(),
    )
  ).sort((left, right) => left.path.localeCompare(right.path)),
});

const readManifest = (archive) => {
  const text = execFileSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8', ...unzipOptions });
  const manifest = JSON.parse(text);
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) fail(`ZIP manifest 格式无效：${archive}`);
  return manifest;
};

const verify = (archive) => {
  if (!existsSync(archive)) fail(`找不到 ZIP：${archive}`);
  const manifest = readManifest(archive);
  const entries = new Set(
    execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', ...unzipOptions })
      .trim()
      .split('\n'),
  );
  for (const entry of manifest.entries) {
    if (typeof entry.path !== 'string' || !entry.path.startsWith('changes/') || entry.path.includes('../'))
      fail(`ZIP manifest 含不安全路径：${entry.path}`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !entries.has(entry.path)) fail(`ZIP manifest 条目无效：${entry.path}`);
    const content = execFileSync('unzip', ['-p', archive, entry.path], unzipOptions);
    if (sha256(content) !== entry.sha256) fail(`ZIP 内容校验失败：${entry.path}`);
  }
  if (
    entries.size !== manifest.entries.length + 1 ||
    [...entries].some((entry) => entry !== 'manifest.json' && !entry.startsWith('changes/'))
  )
    fail(`ZIP 含不在 manifest 中的文件：${archive}`);
  return manifest;
};

const extract = async (root, archive, destination) => {
  const manifest = verify(archive);
  if (existsSync(destination.absolute)) fail(`拒绝覆盖已存在的恢复目录：${destination.path}`);
  await rejectSymlinkAncestors(root, destination.absolute);
  await mkdir(destination.absolute, { recursive: true });
  try {
    execFileSync('unzip', ['-q', archive, '-d', destination.absolute]);
    for (const entry of manifest.entries) {
      const content = await readFile(join(destination.absolute, entry.path));
      if (sha256(content) !== entry.sha256) fail(`恢复内容校验失败：${entry.path}`);
    }
    return destination.path;
  } catch (error) {
    await rm(destination.absolute, { recursive: true, force: true });
    throw error;
  }
};

const archive = async (root, archiveArg, sourceArgs) => {
  if (sourceArgs.length === 0) fail('至少指定一个 change。');
  const target = relativeInside(root, archiveArg, 'archives');
  if (!target.path.startsWith('archives/changes/') || !target.path.endsWith('.zip'))
    fail(`归档目标必须是 archives/changes 下的 ZIP：${archiveArg}`);
  if (existsSync(target.absolute)) fail(`拒绝覆盖已存在的 ZIP：${target.path}`);
  const sources = sourceArgs.map((arg) => relativeInside(root, arg, 'changes'));
  if (new Set(sources.map((source) => source.path)).size !== sources.length) fail('归档 change 不能重复。');
  for (const source of sources) {
    if (!existsSync(source.absolute)) fail(`找不到 change：${source.path}`);
    await rejectSymlinkAncestors(root, source.absolute);
    if ((await lstat(source.absolute)).isSymbolicLink()) fail(`归档不接受符号链接：${source.path}`);
    if (!(await isDelivered(source))) fail(`只可归档明确 Delivered 的 change：${source.path}`);
    const references = await findReferences(root, source.path);
    if (references.length > 0) fail(`运行入口仍引用 ${source.path}：${references.join(', ')}`);
  }

  await rejectSymlinkAncestors(root, target.absolute);
  await mkdir(resolve(target.absolute, '..'), { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), 'seedlands-change-archive-'));
  let verifiedArchive = false;
  try {
    const manifestPath = join(temporary, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(await manifestFor(root, sources), null, 2)}\n`);
    execFileSync('zip', ['-q', '-j', target.absolute, manifestPath]);
    execFileSync('zip', ['-q', '-r', '-D', target.absolute, ...sources.map((source) => source.path)], { cwd: root });
    verify(target.absolute);
    verifiedArchive = true;
    for (const source of sources) await rm(source.absolute, { recursive: true });
    return target.path;
  } catch (error) {
    if (!verifiedArchive) await rm(target.absolute, { force: true });
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  let root = resolve(import.meta.dirname, '..');
  if (args[0] === '--root') {
    if (!args[1]) fail('--root 缺少路径。');
    root = resolve(args[1]);
    args.splice(0, 2);
  }
  const [command, archiveArg, ...sources] = args;
  if (command === 'archive' && archiveArg) {
    process.stdout.write(`${await archive(root, archiveArg, sources)}\n`);
    return;
  }
  if (command === 'verify' && archiveArg && sources.length === 0) {
    const target = relativeInside(root, archiveArg, 'archives');
    const manifest = verify(target.absolute);
    process.stdout.write(`${manifest.entries.map((entry) => entry.path).join('\n')}\n`);
    return;
  }
  if (command === 'extract' && archiveArg && sources.length === 1) {
    const target = relativeInside(root, archiveArg, 'archives');
    const destination = directoryInside(root, sources[0]);
    process.stdout.write(`${await extract(root, target.absolute, destination)}\n`);
    return;
  }
  fail('参数不完整。');
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
