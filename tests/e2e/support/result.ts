import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

type BrowserEnvironment = {
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  browser: 'chromium';
};

type RunMetadata = {
  runId: string;
  sourceSha: string;
  environment: BrowserEnvironment;
};

function sourceSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
}

function metadata(): RunMetadata {
  return {
    runId: process.env.SEEDLANDS_E2E_RUN_ID ?? randomUUID(),
    sourceSha: process.env.SEEDLANDS_E2E_SOURCE_SHA ?? sourceSha(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      browser: 'chromium',
    },
  };
}

async function writeResult(name: string, result: object): Promise<void> {
  const output = new URL(`../../../harness/results/${name}`, import.meta.url);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 2, ...metadata(), ...result }, null, 2)}\n`);
}

export async function writeBrowserE2EResult(stages: Record<string, 'PASS' | 'FAIL'>): Promise<void> {
  const status = Object.values(stages).every((stage) => stage === 'PASS') ? 'PASS' : 'FAIL';
  await writeResult('browser-e2e.json', { browserE2E: { status, stages } });
}

export async function writeBrowserBenchmarkResult(initialWorldReadyMs: number): Promise<void> {
  await writeResult('browser-benchmark.json', {
    browserBenchmark: { status: 'PASS', initialWorldReadyMs: Math.round(initialWorldReadyMs * 100) / 100 },
  });
}
