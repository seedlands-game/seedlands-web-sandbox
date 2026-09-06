import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';

import { hashFile, resolveMoonBitToolchain } from './moonbit-toolchain.mjs';
import { checkMoonBit } from './check-wasm.mjs';

const defaultRun = (command, args, options = {}) => {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8' });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 };
};

const isExcludedPackage = (name) =>
  name === 'main' || name === 'test' || name.endsWith('_test') || name.endsWith('-test') || name.startsWith('test-');

export const MOON_WASM_OPT_FLAGS = ['-O3', '--enable-bulk-memory', '--enable-reference-types', '--enable-multivalue'];

export function discoverWasmPackages({ packageDirectories, packageName = basename }) {
  return packageDirectories
    .map((directory) => packageName(directory))
    .filter((name) => name && !isExcludedPackage(name));
}

function discoverPackageDirectories(root) {
  const directories = [];
  const rootEntries = readdirSync(root);
  if (rootEntries.includes('moon.pkg.json') || rootEntries.includes('moon.pkg')) {
    return [root];
  }
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith('.') || entry === '_build' || entry === 'target' || entry === 'node_modules') continue;
      const path = join(directory, entry);
      if (!statSync(path).isDirectory()) continue;
      const entries = readdirSync(path);
      if (entries.includes('moon.pkg.json') || entries.some((name) => name.endsWith('.mbt'))) {
        directories.push(path);
        continue;
      }
      visit(path);
    }
  };
  visit(root);
  return directories;
}

function defaultListFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (path.endsWith('.wasm')) files.push(path);
    }
  };
  visit(root);
  return files;
}

function artifactForPackage(files, packageName, allowSingleArtifact) {
  const exact = files.find((path) => basename(path) === `${packageName}.wasm`);
  if (exact) return exact;
  const stemMatch = files.find((path) => basename(path, '.wasm') === packageName);
  if (stemMatch) return stemMatch;
  return allowSingleArtifact && files.length === 1 ? files[0] : undefined;
}

export function optimizeWasmArtifact(options) {
  if (!options.toolchain?.optimizer) throw new Error('MoonBit Wasm optimizer is unavailable in the fixed toolchain');
  const run = options.run ?? defaultRun;
  const temporary =
    options.temporaryPath?.(options.target) ?? `${options.target}.optimized-${process.pid}-${Date.now()}.tmp`;
  try {
    const result = run(options.toolchain.optimizer, [options.source, ...MOON_WASM_OPT_FLAGS, '-o', temporary], {
      cwd: options.cwd,
      env: options.toolchain.env,
    });
    if (result.status !== 0)
      throw new Error(`MoonBit Wasm optimization failed (exit ${result.status})\n${result.stderr || result.stdout}`);
    (options.rename ?? renameSync)(temporary, options.target);
  } finally {
    (options.remove ?? rmSync)(temporary, { force: true });
  }
}

/** Build all selected kernel packages once, then copy only their artifacts. */
export async function buildWasmPackages(options) {
  const kernelRoot = options.kernelRoot;
  const packages = options.packages;
  if (!kernelRoot || !packages?.length) throw new Error('no MoonBit kernel packages were selected');
  const run = options.run ?? defaultRun;
  const selectors = options.packageSelectors ?? packages;
  const result = await run(options.toolchain.moon, ['build', '--release', '--target', 'wasm', ...selectors], {
    cwd: kernelRoot,
    env: options.toolchain.env,
  });
  if (result.status !== 0) {
    throw new Error(`MoonBit Wasm build failed (exit ${result.status})\n${result.stderr || result.stdout}`);
  }

  const artifactRoot = options.artifactRoot ?? join(kernelRoot, '_build/wasm/release/build');
  const listFiles = options.listFiles ?? (() => defaultListFiles(artifactRoot));
  const files = await listFiles(artifactRoot);
  const mkdir = options.mkdir ?? ((path) => mkdirSync(path, { recursive: true }));
  const copy = options.copy ?? ((source, target) => copyFileSync(source, target));
  mkdir(options.outputRoot);
  const outputs = [];
  for (const packageName of packages) {
    const source = artifactForPackage(files, packageName, packages.length === 1);
    if (!source) throw new Error(`MoonBit Wasm artifact not found for package ${packageName} under ${artifactRoot}`);
    const target = join(options.outputRoot, `${packageName}.wasm`);
    copy(source, target);
    optimizeWasmArtifact({
      source: target,
      target,
      cwd: kernelRoot,
      toolchain: options.toolchain,
      run,
      rename: options.rename,
      remove: options.remove,
      temporaryPath: options.temporaryPath,
    });
    outputs.push({ packageName, source, target, optimizer: options.toolchain.optimizer });
  }
  return outputs;
}

export async function buildWasmFromWorkspace(options = {}) {
  const repoRoot = options.repoRoot ?? resolve(dirname(new URL(import.meta.url).pathname), '..');
  const kernelRoot = options.kernelRoot ?? join(repoRoot, 'wasm/seedlands-kernels');
  const directories = options.packageDirectories ?? discoverPackageDirectories(kernelRoot);
  const packages = options.packages ?? discoverWasmPackages({ packageDirectories: directories });
  const toolchain = options.toolchain ?? (await resolveMoonBitToolchain({ env: options.env }));
  const packageSelectors =
    options.packageSelectors ?? (packages.length === 1 && packages[0] === basename(kernelRoot) ? ['.'] : packages);
  return buildWasmPackages({
    ...options,
    repoRoot,
    kernelRoot,
    packages,
    packageSelectors,
    outputRoot: options.outputRoot ?? join(repoRoot, 'src/generated/wasm'),
    toolchain,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flags = new Set(process.argv.slice(2));
  const toolchainPromise = resolveMoonBitToolchain();
  toolchainPromise
    .then(async (toolchain) => {
      if (flags.has('--check')) {
        const kernelRoot = resolve(dirname(new URL(import.meta.url).pathname), '../wasm/seedlands-kernels');
        await checkMoonBit({ kernelRoot, toolchain });
      }
      return buildWasmFromWorkspace({ toolchain });
    })
    .then((outputs) => {
      for (const output of outputs) {
        const suffix = flags.has('--hash') ? ` sha256=${hashFile(output.target)}` : '';
        process.stdout.write(`${output.packageName}: ${output.target} optimizer=${output.optimizer}${suffix}\n`);
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
