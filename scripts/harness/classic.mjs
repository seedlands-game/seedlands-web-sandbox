import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { verifyArtifact, root } from './artifact.mjs';

const artifact = verifyArtifact();
const runId = process.env.SEEDLANDS_HARNESS_RUN_ID ?? randomUUID();
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    SEEDLANDS_HARNESS_RUN_ID: runId,
    SEEDLANDS_SOURCE_SHA: artifact.sourceSha,
    SEEDLANDS_CLASSIC_RESULT: resolve(root, 'harness/results', runId, 'classic.json'),
  },
});
if (result.error) throw result.error;
verifyArtifact();
process.exitCode = result.status ?? 1;
