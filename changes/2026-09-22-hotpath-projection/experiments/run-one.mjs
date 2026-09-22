import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [root, run] = process.argv.slice(2);
if (!root || !run) throw new Error('root run required');
const tools = import.meta.dirname,
  out = resolve(process.argv[4] ?? resolve(root, 'harness/results/hotpath-projection'), run);
mkdirSync(out);
mkdirSync(resolve(out, 'source-maps'));
for (const f of readdirSync(resolve(root, 'apps/web/dist/assets')))
  if (f.endsWith('.map')) copyFileSync(resolve(root, 'apps/web/dist/assets', f), resolve(out, 'source-maps', f));
const env = {
  ...process.env,
  HOTPATH_OUT: out,
  HOTPATH_RUN: run,
  SEEDLANDS_RESERVATION_RUN: run,
  SEEDLANDS_RESERVATION_EVIDENCE: `harness/results/${run}/window.json`,
};
const startedAt = new Date().toISOString();
const runResult = spawnSync('node', ['scripts/benchmark-window.mjs', '--', 'node', resolve(tools, 'profile.mjs')], {
  cwd: root,
  env,
  stdio: 'inherit',
});
const analysis = spawnSync('node', ['scripts/benchmark-window.mjs', '--', 'node', resolve(tools, 'analyze.mjs')], {
  cwd: root,
  env: {
    ...env,
    SEEDLANDS_RESERVATION_RUN: `${run}-analysis`,
    SEEDLANDS_RESERVATION_EVIDENCE: `harness/results/${run}/analysis-window.json`,
  },
  encoding: 'utf8',
});
writeFileSync(resolve(out, 'analysis.log'), analysis.stdout + '\n' + analysis.stderr);
for (const f of ['classic.json', 'window.json'])
  try {
    copyFileSync(resolve(root, 'harness/results', run, f), resolve(out, f));
  } catch (error) {
    console.error(`Evidence copy failed for ${f}: ${error.message}`);
  }
writeFileSync(
  resolve(out, 'receipt.json'),
  JSON.stringify(
    { root, run, startedAt, endedAt: new Date().toISOString(), exit: runResult.status, analysis: analysis.status },
    null,
    2,
  ),
);
process.exitCode = runResult.status || analysis.status || 0;
