import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactPath = 'src/generated/wasm/seedlands-kernels.wasm';
const manifestPath = 'src/generated/wasm/manifest.json';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function sourceFiles(root) {
  const paths = [
    'wasm/toolchain-lock.json',
    'scripts/build-wasm.mjs',
    'scripts/moonbit-toolchain.mjs',
    'scripts/check-wasm.mjs',
  ];
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '_build' || entry.name === 'target') continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.(mbt|mod|pkg|json)$/.test(entry.name)) paths.push(path);
    }
  }
  visit('wasm/seedlands-kernels');
  return Object.fromEntries(paths.sort().map((path) => [path, hash(readFileSync(join(root, path)))]));
}
export function writeArtifactManifest(root) {
  const bytes = readFileSync(join(root, artifactPath));
  if (!WebAssembly.validate(bytes)) throw new Error('invalid Wasm artifact');
  const manifest = {
    schemaVersion: 1,
    artifactPath,
    artifactSha256: hash(bytes),
    artifactBytes: bytes.length,
    sources: sourceFiles(root),
  };
  writeFileSync(join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
export function verifyArtifact(root) {
  const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
  const bytes = readFileSync(join(root, artifactPath));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.artifactPath !== artifactPath ||
    hash(bytes) !== manifest.artifactSha256 ||
    !WebAssembly.validate(bytes)
  )
    throw new Error('Wasm artifact differs from manifest; rebuild with the pinned toolchain');
  if (JSON.stringify(sourceFiles(root)) !== JSON.stringify(manifest.sources))
    throw new Error('Wasm sources differ from manifest; rebuild with the pinned toolchain');
  return manifest;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const result = process.argv.includes('--write') ? writeArtifactManifest(root) : verifyArtifact(root);
    process.stdout.write(`Wasm artifact verified: ${result.artifactBytes} bytes, ${result.artifactSha256}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
