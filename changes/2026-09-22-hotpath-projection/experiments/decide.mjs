import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2]),
  { runs } = JSON.parse(readFileSync(resolve(out, 'summary.json')));
const median = (v) => {
  v = [...v].sort((a, b) => a - b);
  return (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2;
};
const aa = [1, 2, 3].map((n) => runs.find((r) => r.name === `hotpath-opt-aa${n}`));
if (aa.some((r) => !r?.valid)) throw new Error('A/A missing or invalid');
const noise = Object.fromEntries(
  Object.keys(aa[0].metrics).map((k) => {
    const v = aa.map((r) => r.metrics[k]);
    return [k, (Math.max(...v) - Math.min(...v)) / median(v)];
  }),
);
const decisions = [];
for (const [axis, primary] of [
  ['c', 'authorityCpu'],
  ['u', 'mainCpu'],
  ['cu', 'totalCpu'],
]) {
  const matrix = ['a1', 'b1', 'b2', 'a2'].map((n) => runs.find((r) => r.name === `hotpath-opt-${axis}-${n}`));
  if (matrix.some((r) => !r)) continue;
  const control = [matrix[0], matrix[3]],
    candidate = [matrix[1], matrix[2]],
    required = Math.max(0.05, 2 * noise[primary]);
  const values = Object.fromEntries(
    Object.keys(noise).map((k) => {
      const a = median(control.map((r) => r.metrics[k])),
        b = median(candidate.map((r) => r.metrics[k]));
      return [k, { a, b, reduction: 1 - b / a }];
    }),
  );
  const veto = [];
  if (matrix.some((r) => !r.valid)) veto.push('invalid-evidence');
  if (noise[primary] > 0.25) veto.push('AA-noise');
  for (const k of ['frameP95', 'chunkP95'])
    if (-values[k].reduction > Math.max(0.15, 2 * noise[k])) veto.push(k + '-regression');
  for (const r of candidate) {
    if (r.delta.failedTasks > 0 || r.delta.staleResults > 0 || r.c4.workers.kernel.failures > 0)
      veto.push(r.name + '-failed-task');
    if (r.c4.workers.kernel.memoryBytes > Math.max(...control.map((x) => x.c4.workers.kernel.memoryBytes)))
      veto.push(r.name + '-kernel-memory');
  }
  decisions.push({
    axis,
    primary,
    required,
    noise: noise[primary],
    values,
    veto,
    status: veto.length === 0 && values[primary].reduction >= required ? 'PASS' : 'REJECT',
  });
}
const result = { noise, aa: aa.map((r) => ({ name: r.name, metrics: r.metrics })), decisions };
writeFileSync(resolve(out, 'decisions.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
