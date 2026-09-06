import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const defaultLockPath = resolve(dirname(new URL(import.meta.url).pathname), '../wasm/toolchain-lock.json');

export class ToolchainResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolchainResolutionError';
  }
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

function defaultHashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function loadLock(lockPath, readText) {
  let parsed;
  try {
    parsed = JSON.parse(await readText(lockPath, 'utf8'));
  } catch (error) {
    throw new ToolchainResolutionError(`cannot read toolchain lock: ${lockPath}: ${error.message}`);
  }
  if (parsed?.schemaVersion !== 1 || !parsed.toolchain) {
    throw new ToolchainResolutionError(`invalid toolchain lock: ${lockPath}`);
  }
  return parsed;
}

function versionFromMoon(output) {
  const match = output.match(/(?:^|\n)moon\s+([^\s]+)/);
  return match?.[1] ?? null;
}

function versionFromMoonc(output) {
  const match = output.match(/(?:^|\n)v([^\s]+)/);
  return match?.[1] ?? null;
}

function versionFromCore(manifest) {
  return manifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

function versionFromMoonWasmOpt(output) {
  return output.match(/wasm-opt\s+version\s+([^\s]+)/i)?.[1] ?? null;
}

function candidateRoots({ env, homeDirectory, cacheKey }) {
  const roots = [];
  const add = (value) => {
    if (value && !roots.includes(value)) roots.push(value);
  };

  add(env.SEEDLANDS_MOONBIT_CACHE && join(env.SEEDLANDS_MOONBIT_CACHE, cacheKey));
  add(join(homeDirectory, '.cache/seedlands-moonbit', cacheKey));
  add(join(homeDirectory, 'Library/Caches/seedlands-moonbit', cacheKey));
  if (env.XDG_CACHE_HOME) add(join(env.XDG_CACHE_HOME, 'seedlands-moonbit', cacheKey));
  return roots;
}

/**
 * Locate a previously downloaded, content-addressed MoonBit distribution.
 * This function intentionally has no download path: an absent or mismatched
 * toolchain is an actionable error for callers and CI.
 */
export async function resolveMoonBitToolchain(options = {}) {
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const exists = options.exists ?? existsSync;
  const readText = options.readText ?? readFile;
  const run = options.run ?? defaultRun;
  const hash = options.hashFile ?? defaultHashFile;
  const lock = await loadLock(options.lockPath ?? defaultLockPath, readText);
  const expected = lock.toolchain;
  const explicitRoot = env.SEEDLANDS_MOON_HOME;
  const roots = explicitRoot ? [explicitRoot] : candidateRoots({ env, homeDirectory, cacheKey: expected.cacheKey });

  if (roots.length === 0) {
    throw new ToolchainResolutionError(
      'MoonBit toolchain unavailable: set SEEDLANDS_MOON_HOME to a fixed installation; downloads are disabled',
    );
  }

  const failures = [];
  for (const root of roots) {
    const moon = join(root, 'bin/moon');
    const moonc = join(root, 'bin/moonc');
    const optimizer = join(root, 'bin/moon-wasm-opt');
    const coreManifest = join(root, 'lib/core/moon.mod');
    if (!exists(moon) || !exists(moonc) || !exists(optimizer) || !exists(coreManifest)) {
      failures.push(`${root}: missing bin/moon, bin/moonc, bin/moon-wasm-opt, or lib/core/moon.mod`);
      continue;
    }

    const commandEnv = { ...env, MOON_HOME: root };
    const moonResult = run(moon, ['version'], { env: commandEnv });
    const moonVersion = versionFromMoon(`${moonResult.stdout}\n${moonResult.stderr}`);
    if (moonResult.status !== 0 || moonVersion !== expected.moonVersion) {
      failures.push(
        `${root}: moon version mismatch (expected ${expected.moonVersion}, got ${moonVersion ?? 'unavailable'})`,
      );
      continue;
    }

    const mooncResult = run(moonc, ['-v'], { env: commandEnv });
    const mooncVersion = versionFromMoonc(`${mooncResult.stdout}\n${mooncResult.stderr}`);
    if (mooncResult.status !== 0 || mooncVersion !== expected.mooncVersion) {
      failures.push(
        `${root}: moonc version mismatch (expected ${expected.mooncVersion}, got ${mooncVersion ?? 'unavailable'})`,
      );
      continue;
    }

    if (expected.moonBinarySha256 && hash(moon) !== expected.moonBinarySha256) {
      failures.push(`${root}: moon binary hash mismatch (expected ${expected.moonBinarySha256})`);
      continue;
    }
    if (expected.mooncBinarySha256 && hash(moonc) !== expected.mooncBinarySha256) {
      failures.push(`${root}: moonc binary hash mismatch (expected ${expected.mooncBinarySha256})`);
      continue;
    }

    const optimizerResult = run(optimizer, ['--version'], { env: commandEnv });
    const optimizerVersion = versionFromMoonWasmOpt(`${optimizerResult.stdout}\n${optimizerResult.stderr}`);
    if (optimizerResult.status !== 0 || optimizerVersion !== expected.moonWasmOptVersion) {
      failures.push(
        `${root}: moon-wasm-opt version mismatch (expected ${expected.moonWasmOptVersion}, got ${optimizerVersion ?? 'unavailable'})`,
      );
      continue;
    }
    if (expected.moonWasmOptBinarySha256 && hash(optimizer) !== expected.moonWasmOptBinarySha256) {
      failures.push(`${root}: moon-wasm-opt binary hash mismatch (expected ${expected.moonWasmOptBinarySha256})`);
      continue;
    }

    let coreVersion;
    try {
      coreVersion = versionFromCore(await readText(coreManifest, 'utf8'));
    } catch (error) {
      failures.push(`${root}: cannot read core manifest: ${error.message}`);
      continue;
    }
    if (coreVersion !== expected.coreVersion) {
      failures.push(
        `${root}: core version mismatch (expected ${expected.coreVersion}, got ${coreVersion ?? 'unavailable'})`,
      );
      continue;
    }

    return {
      root,
      moon,
      moonc,
      optimizer,
      env: commandEnv,
      lock,
      versions: { moon: moonVersion, moonc: mooncVersion, moonWasmOpt: optimizerVersion, core: coreVersion },
    };
  }

  const prefix = explicitRoot
    ? `MoonBit toolchain at SEEDLANDS_MOON_HOME=${explicitRoot} is invalid`
    : 'MoonBit toolchain unavailable in the fixed local cache';
  throw new ToolchainResolutionError(
    `${prefix}; ${failures.join('; ') || 'no candidate paths found'}; downloads are disabled`,
  );
}

export function hashFile(path) {
  return defaultHashFile(path);
}

export function toolchainEnvironment(toolchain, baseEnv = process.env) {
  return { ...baseEnv, ...toolchain.env, MOON_HOME: toolchain.root };
}

export async function resolveToolchainForCli(options = {}) {
  return resolveMoonBitToolchain(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resolveToolchainForCli()
    .then((toolchain) => {
      process.stdout.write(
        `${JSON.stringify({ root: toolchain.root, optimizer: toolchain.optimizer, versions: toolchain.versions })}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
