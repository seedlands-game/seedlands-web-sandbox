import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

import { resolveMoonBitToolchain } from './moonbit-toolchain.mjs';

const defaultRun = (command, args, options = {}) => {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8' });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 };
};

function runChecked(run, command, args, options, label) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(`MoonBit ${label} failed (exit ${result.status})\n${result.stderr || result.stdout}`);
  }
  return result;
}

/** Run the checked commands exposed by the pinned Moon CLI. */
export async function checkMoonBit(options) {
  const run = options.run ?? defaultRun;
  const commandOptions = { cwd: options.kernelRoot, env: options.toolchain.env };
  runChecked(run, options.toolchain.moon, ['check', '--target', 'wasm'], commandOptions, 'check');
  runChecked(run, options.toolchain.moon, ['fmt', '--check'], commandOptions, 'fmt --check');
}

export async function testMoonBit(options) {
  const run = options.run ?? defaultRun;
  const result = runChecked(
    run,
    options.toolchain.moon,
    ['test', '--target', 'wasm'],
    { cwd: options.kernelRoot, env: options.toolchain.env },
    'test --target wasm',
  );
  return result;
}

export async function checkWasmWorkspace(options = {}) {
  const repoRoot = options.repoRoot ?? resolve(dirname(new URL(import.meta.url).pathname), '..');
  const kernelRoot = options.kernelRoot ?? join(repoRoot, 'wasm/seedlands-kernels');
  const toolchain = options.toolchain ?? (await resolveMoonBitToolchain({ env: options.env }));
  const result = await checkMoonBit({ ...options, kernelRoot, toolchain });
  if (options.runTests) await testMoonBit({ ...options, kernelRoot, toolchain });
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flags = new Set(process.argv.slice(2));
  checkWasmWorkspace({ runTests: flags.has('--test') })
    .then(() =>
      process.stdout.write(
        flags.has('--test')
          ? 'MoonBit check, fmt --check, and test --target wasm passed\n'
          : 'MoonBit check and fmt --check passed\n',
      ),
    )
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
