import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, 'harness/results/rust-build');
const output = resolve(root, 'apps/web/src/generated/wasm');
const hash = (path) =>
  createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex');
if (process.argv.includes('--build')) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/build-simd-experiment.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SEEDLANDS_RUST_OUTPUT: evidence },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const manifest = JSON.parse(readFileSync(resolve(evidence, 'simd-build-manifest.json'), 'utf8'));
  for (const mode of ['scalar', 'simd'])
    copyFileSync(resolve(evidence, `kernels-${mode}.wasm`), resolve(output, `rust-kernels-${mode}.wasm`));
  writeFileSync(resolve(output, 'rust-kernel-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
const manifest = JSON.parse(readFileSync(resolve(output, 'rust-kernel-manifest.json'), 'utf8'));
for (const [path, expected] of Object.entries(manifest.sources))
  if (hash(path) !== expected) throw new Error(`Stale Rust kernel source: ${path}`);
for (const mode of ['scalar', 'simd'])
  if (hash(`apps/web/src/generated/wasm/rust-kernels-${mode}.wasm`) !== manifest[mode].sha256)
    throw new Error(`Rust ${mode} artifact mismatch`);
process.stdout.write('Rust source/artifact fingerprints verified.\n');
