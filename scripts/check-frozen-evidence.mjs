import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exact historical bytes, recorded before adding their narrow Prettier exceptions.
export const frozenEvidence = {
  'changes/2026-09-23-classic-functional-completion/evidence/v1-browser20-route-aim-contract-map-01/delivery-validation.json':
    '852f5fac254fd209235eec0813613d241ba1226b45da560aed72cd13be9a2d45',
  'changes/2026-09-23-classic-functional-completion/evidence/v1-browser20-route-aim-contract-map-01/diagnosis.json':
    '8800d6fdcba5a07f2b36137bdf714721e782e4dee4a95d3dd94f51288dd8841b',
  'changes/2026-09-23-classic-functional-completion/evidence/v1-browser20-route-aim-contract-map-01/README.md':
    '1b591fa9f2541a7e2927652b7179249017cd6e581fd3d30f52c8961e97a90c20',
  'changes/2026-09-23-classic-functional-completion/evidence/v2-death-mixed-series-01/pre-death-v4-identity.json':
    'ebad22c315758e0b9e305aaff6ba7c0c4adc7026ac506fb6dfe4b82abd1db405',
  'changes/2026-09-23-classic-functional-completion/evidence/git-40-canonical-discovery/manifest-closure/strict-manifest.mjs':
    'fd4b7d0939a8cbd278418d7f24633841ebd90cbb72dd804bfde0fd6fe5b0b412',
};

export function checkFrozenEvidence(root) {
  for (const [path, expected] of Object.entries(frozenEvidence)) {
    const absolute = resolve(root, path);
    let bytes;
    const status = lstatSync(absolute, { throwIfNoEntry: false });
    if (status) {
      if (!status.isFile()) throw new Error(`Frozen evidence is not a regular file: ${path}`);
      bytes = readFileSync(absolute);
    } else {
      const flags = execFileSync('git', ['ls-files', '-v', '--', path], { cwd: root, encoding: 'utf8' });
      if (flags !== `S ${path}\n`) throw new Error(`Frozen evidence is missing: ${path}`);
      bytes = execFileSync('git', ['show', `HEAD:${path}`], { cwd: root });
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) throw new Error(`Frozen evidence bytes changed: ${path}`);
  }
  return Object.keys(frozenEvidence).length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = checkFrozenEvidence(resolve(import.meta.dirname, '..'));
  process.stdout.write(`Frozen evidence: ${count}/${count} exact byte identities verified.\n`);
}
