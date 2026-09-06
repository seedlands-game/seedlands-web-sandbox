import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error The executable JavaScript CLI helper is exercised through Vitest.
import { verifyArtifact, writeArtifactManifest } from '../../scripts/wasm-artifact.mjs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'seedlands-wasm-manifest-'));
  directories.push(root);
  for (const directory of ['wasm/seedlands-kernels', 'scripts', 'src/generated/wasm'])
    mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, 'wasm/seedlands-kernels/kernel.mbt'), 'fn identity(x : Int) -> Int { x }');
  writeFileSync(join(root, 'wasm/toolchain-lock.json'), '{}');
  for (const name of ['build-wasm.mjs', 'moonbit-toolchain.mjs', 'check-wasm.mjs'])
    writeFileSync(join(root, 'scripts', name), '// fixture');
  writeFileSync(join(root, 'src/generated/wasm/seedlands-kernels.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  return root;
}
it('validates a checked-in artifact without requiring the compiler, rejects changed source and missing manifest', () => {
  const root = fixture();
  expect(() => verifyArtifact(root)).toThrow();
  writeArtifactManifest(root);
  expect(() => verifyArtifact(root)).not.toThrow();
  writeFileSync(join(root, 'wasm/seedlands-kernels/new.mbt'), '// new source');
  expect(() => verifyArtifact(root)).toThrow(/source/i);
});
it('rejects a replaced or corrupt artifact even when sources are unchanged', () => {
  const root = fixture();
  writeArtifactManifest(root);
  const path = join(root, 'src/generated/wasm/seedlands-kernels.wasm');
  const bytes = readFileSync(path);
  bytes[0] = 1;
  writeFileSync(path, bytes);
  expect(() => verifyArtifact(root)).toThrow(/artifact/i);
});
