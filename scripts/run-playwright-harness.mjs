import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const sourceSha = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
};

const runId = randomUUID();
const sharedEnvironment = {
  ...process.env,
  SEEDLANDS_E2E_RUN_ID: runId,
  SEEDLANDS_E2E_SOURCE_SHA: sourceSha(),
};
const playwright = spawn('pnpm', ['exec', 'playwright', 'test'], { stdio: 'inherit', env: sharedEnvironment });
const exitCode = await new Promise((resolve) => playwright.once('exit', (code) => resolve(code ?? 1)));
if (exitCode !== 0) process.exit(exitCode);

if (process.argv.includes('--aggregate')) {
  const harness = spawn(process.execPath, ['scripts/run-harness.mjs'], {
    stdio: 'inherit',
    env: { ...sharedEnvironment, SEEDLANDS_HARNESS_RUN_ID: runId },
  });
  const harnessExitCode = await new Promise((resolve) => harness.once('exit', (code) => resolve(code ?? 1)));
  process.exit(harnessExitCode);
}
