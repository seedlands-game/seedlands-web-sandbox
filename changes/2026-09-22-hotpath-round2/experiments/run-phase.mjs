import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [manifestPath, phase] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!['aa', 'm', 'p', 'c', 'combined'].includes(phase)) throw new Error('Unknown phase');
const directory = resolve(manifest.output);
const tools = import.meta.dirname;
const execute = (script, args) => {
  const result = spawnSync(process.execPath, [resolve(tools, script), ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${script} failed: ${result.status}`);
};
if (phase !== 'aa') {
  const decision = JSON.parse(readFileSync(resolve(directory, 'decisions.json'), 'utf8'));
  if (['mainCpu', 'authorityCpu', 'totalCpu'].some((key) => decision.noise[key] > 0.2))
    throw new Error('A/A exceeds preregistered noise stop line');
}
const cells = phase === 'aa' ? ['4', '5', '6'] : ['a1', 'b1', 'b2', 'a2'];
for (const cell of cells) {
  const root = phase === 'aa' || cell.startsWith('a') ? manifest.control : manifest[phase];
  const run = `hotpath-r2v2-${phase}${phase === 'aa' ? '' : '-'}${cell}`;
  console.log(`START ${run}`);
  execute('run-one.mjs', [root, run, directory]);
  console.log(`END ${run}`);
}
execute('summarize.mjs', [directory]);
execute('audit.mjs', [directory]);
execute('decide.mjs', [directory]);
