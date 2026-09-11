import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, process.env.SEEDLANDS_RUST_OUTPUT ?? 'harness/results/rust-build');
mkdirSync(output, { recursive: true });
const sources = {};
for (const relative of [
  'scripts/build-simd-experiment.mjs',
  'scripts/link-wasm-kernels.mjs',
  ...readdirSync(resolve(root, 'crates'), { recursive: true })
    .filter((p) => /\.(rs|toml|lock)$/.test(p) && !p.startsWith('target/'))
    .map((p) => `crates/${p}`),
].sort())
  sources[relative] = createHash('sha256')
    .update(readFileSync(resolve(root, relative)))
    .digest('hex');
const version = spawnSync('rustc', ['--version'], { cwd: resolve(root, 'crates'), encoding: 'utf8' });
if (version.status !== 0) throw new Error('rustc unavailable');
const sysroot = spawnSync('rustc', ['--print', 'sysroot'], {
  cwd: resolve(root, 'crates'),
  encoding: 'utf8',
}).stdout.trim();
const verbose = spawnSync('rustc', ['-vV'], { cwd: resolve(root, 'crates'), encoding: 'utf8' }).stdout;
const host = verbose.match(/^host: (.+)$/m)?.[1];
if (!sysroot || !host) throw new Error('Cannot locate pinned Rust linker');
const linker = resolve(sysroot, 'lib/rustlib', host, 'bin/rust-lld');
const manifest = { toolchain: version.stdout.trim(), sources };
for (const mode of ['scalar', 'simd']) {
  const target = `/tmp/seedlands-data-plane-rust-${mode}`;
  // Reserve [0,16MiB) below global-base for the ABI arena. Static data and
  // a separate1MiB stack follow it; do not use stack-first. Memory max is32MiB.
  const flags = `-C linker=${resolve(root, 'scripts/link-wasm-kernels.mjs')} -C linker-flavor=wasm-ld -C target-feature=${mode === 'simd' ? '+' : '-'}simd128,-relaxed-simd -C no-vectorize-loops -C no-vectorize-slp -C link-arg=--global-base=16777216 -C link-arg=--export=__data_end -C link-arg=--export=__heap_base -C link-arg=--export=__stack_pointer -C link-arg=-z -C link-arg=stack-size=1048576 -C link-arg=--initial-memory=18874368 -C link-arg=--max-memory=33554432`;
  const args = [
    'build',
    '--locked',
    '--release',
    '-p',
    'world-kernels-wasm',
    '--target',
    'wasm32-unknown-unknown',
    '--target-dir',
    target,
  ];
  if (mode === 'simd') args.push('--features', 'simd');
  const result = spawnSync('cargo', args, {
    cwd: resolve(root, 'crates'),
    env: { ...process.env, RUSTFLAGS: flags, SEEDLANDS_KERNEL_LINKER: linker },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const destination = resolve(output, `kernels-${mode}.wasm`);
  copyFileSync(resolve(target, 'wasm32-unknown-unknown/release/world_kernels_wasm.wasm'), destination);
  const bytes = readFileSync(destination);
  manifest[mode] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), flags };
}
writeFileSync(resolve(output, 'simd-build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
