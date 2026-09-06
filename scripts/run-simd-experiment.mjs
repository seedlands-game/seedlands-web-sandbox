import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/@playwright/test/cli.js'),
    'test',
    'changes/2026-09-06-data-plane-simd-policy/e2e/simd-ab.spec.ts',
    '--workers=1',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SEEDLANDS_E2E_PORT: process.env.SEEDLANDS_E2E_PORT ?? '4192', SEEDLANDS_SIMD_AB: '1' },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
