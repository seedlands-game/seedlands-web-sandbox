import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const cleanRoot = '/private/tmp/seedlands-v2-acceptance-1bbe3a60';
const expected = Object.freeze({
  sourceSha: '1bbe3a60d55ffa5d05e405377624fbbd942e6327',
  artifactReceiptSha256: 'aa4f6d8056335413523964fd1d2d4630c5261fb7ee4477c879a54ad0c145281a',
  packLockSha256: 'fd4054012073c1252f7f8a63d9d9d09ac968620c6859cff9ca78aaebda3d2332',
});
const paths = Object.freeze({
  artifactReceipt: `${cleanRoot}/apps/web/dist/harness-artifact.json`,
  packLock: `${cleanRoot}/apps/web/dist/packs/packs.lock.json`,
  loader: `${cleanRoot}/scripts/pack-integrity.mjs`,
  assembler: `${cleanRoot}/packages/stdlib/src/server/composition/gameplay-composition.ts`,
  canonicalizer: `${cleanRoot}/packages/stdlib/src/server/composition/checkpoint-identity.ts`,
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['-C', cleanRoot, ...args], { encoding: 'utf8' }).trim();
const assertEqual = (actual, wanted, label) => {
  if (actual !== wanted) throw new Error(`${label} mismatch: ${actual}`);
};

const cleanBefore = git('status', '--porcelain=v1');
if (cleanBefore) throw new Error('Acceptance tree is dirty before predecessor capture.');
assertEqual(git('rev-parse', 'HEAD'), expected.sourceSha, 'Acceptance source SHA');

const receiptBytes = await readFile(paths.artifactReceipt);
const lockBytes = await readFile(paths.packLock);
assertEqual(sha256(receiptBytes), expected.artifactReceiptSha256, 'Artifact receipt SHA-256');
assertEqual(sha256(lockBytes), expected.packLockSha256, 'Pack lock SHA-256');
const receipt = JSON.parse(receiptBytes.toString('utf8'));
assertEqual(receipt.sourceSha, expected.sourceSha, 'Artifact receipt source SHA');

const require = createRequire(`${cleanRoot}/package.json`);
const { build } = require('esbuild');
const bridge = await build({
  absWorkingDir: cleanRoot,
  stdin: {
    contents: [
      "export { assembleOverworldPacks } from './packages/stdlib/src/server/composition/gameplay-composition.ts';",
      "export { canonicalCompositionCheckpointIdentity } from './packages/stdlib/src/server/composition/checkpoint-identity.ts';",
    ].join('\n'),
    resolveDir: cleanRoot,
    sourcefile: 'pre-death-v4-capture-bridge.ts',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
});
const bridgeUrl = `data:text/javascript;base64,${Buffer.from(bridge.outputFiles[0].contents).toString('base64')}`;
const [{ loadVerifiedPackArtifacts }, { assembleOverworldPacks, canonicalCompositionCheckpointIdentity }] =
  await Promise.all([import(pathToFileURL(paths.loader)), import(bridgeUrl)]);
const artifacts = await loadVerifiedPackArtifacts(paths.packLock);
const composition = assembleOverworldPacks(artifacts);
const identity = {
  version: 1,
  playbookId: composition.playbookId,
  packLock: composition.packLock,
  definitionMap: composition.definitionMap,
};
const canonicalIdentity = canonicalCompositionCheckpointIdentity(identity);
const cleanAfter = git('status', '--porcelain=v1');
if (cleanAfter) throw new Error('Acceptance tree is dirty after predecessor capture.');

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      stage: 'PREDECESSOR-CAPTURE',
      status: 'PASS',
      capturedAt: new Date().toISOString(),
      argv: process.argv,
      benchmarkWindowId: process.env.SEEDLANDS_PERFORMANCE_WINDOW_ID ?? null,
      source: {
        root: cleanRoot,
        sha: expected.sourceSha,
        tree: git('rev-parse', 'HEAD^{tree}'),
        cleanBefore: cleanBefore === '',
        cleanAfter: cleanAfter === '',
      },
      artifact: {
        receiptPath: paths.artifactReceipt,
        receiptSha256: sha256(receiptBytes),
        sourceDigest: receipt.sourceDigest,
        artifactDigest: receipt.artifactDigest,
        builtAt: receipt.builtAt,
        packLockPath: paths.packLock,
        packLockSha256: sha256(lockBytes),
      },
      runtime: {
        node: process.version,
        loader: paths.loader,
        assembler: paths.assembler,
        canonicalizer: paths.canonicalizer,
        adapter: 'esbuild in-memory ESM bridge; write=false',
      },
      identity: {
        canonicalSha256: sha256(canonicalIdentity),
        canonicalBytes: Buffer.byteLength(canonicalIdentity),
        moduleIds: composition.moduleOrder,
        capabilityIds: composition.definitionMap.capabilities.map(({ id }) => id),
        value: identity,
      },
    },
    null,
    2,
  )}\n`,
);
