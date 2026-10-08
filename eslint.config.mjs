import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeedlandsConfig } from '@seedlands/eslint-plugin/config';

export default [
  {
    // Historical manifest-bound bytes remain enforced by check-frozen-evidence.mjs.
    ignores: [
      'changes/2026-09-23-classic-functional-completion/evidence/git-40-canonical-discovery/manifest-closure/strict-manifest.mjs',
    ],
  },
  ...createSeedlandsConfig(dirname(fileURLToPath(import.meta.url))),
];
