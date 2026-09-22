import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const base = resolve(process.argv[2]),
  read = (p) => JSON.parse(readFileSync(p));
const runs = [];
for (const name of readdirSync(base).filter((n) => n.startsWith('hotpath-opt-'))) {
  const dir = resolve(base, name);
  if (!existsSync(resolve(dir, 'classic.json'))) continue;
  const c = read(resolve(dir, 'classic.json')),
    w = read(resolve(dir, 'window.json')),
    p = read(resolve(dir, 'profile-summary.json'));
  const m = c.attempts?.[0]?.benchmark?.measurement;
  const valid =
    c.status === 'PASS' &&
    c.attempts.length === 1 &&
    w.status === 'PASS' &&
    m?.status === 'MEASURED' &&
    w.measurement?.status === 'RECORDED' &&
    createHash('sha256').update(JSON.stringify(m)).digest('hex') === w.measurement.digest;
  const c0 = m?.samples?.find((s) => s.stage === 'C0'),
    c4 = m?.samples?.find((s) => s.stage === 'C4');
  const targets = p.targets
    .filter((t) => t.gameplay.segments > 0)
    .map((t) => ({
      role: t.type === 'page' ? 'main' : t.url.includes('/authority-worker-') ? 'authority' : 'other',
      segments: t.gameplay.segments,
      cpuMsPerSecond: (1000 * t.gameplay.activeSampledMs) / t.gameplay.totalProfiledMs,
      gcMsPerSecond: (1000 * t.gameplay.gcMs) / t.gameplay.totalProfiledMs,
      allocatedMiBPerSecond: t.gameplayHeapDelta
        ? t.gameplayHeapDelta.estimatedAllocatedBytes / 1048576 / t.gameplayHeapDelta.seconds
        : null,
      groups: t.gameplay.groups,
    }));
  const main = targets.find((t) => t.role === 'main'),
    authority = targets.find((t) => t.role === 'authority');
  runs.push({
    name,
    valid: valid && !!main && !!authority,
    identity: {
      source: m?.sourceSha,
      sourceDigest: m?.sourceDigest,
      artifactDigest: m?.artifactDigest,
      lockDigest: m?.lockDigest,
    },
    scenario: m?.scenario,
    environment: m?.environment,
    targets,
    metrics: {
      mainCpu: main?.cpuMsPerSecond,
      authorityCpu: authority?.cpuMsPerSecond,
      totalCpu: (main?.cpuMsPerSecond ?? NaN) + (authority?.cpuMsPerSecond ?? NaN),
      frameP95: c4?.frame.p95Ms,
      frameP99: c4?.frame.p99Ms,
      chunkP95: c4?.streaming.chunkVisible.p95Ms,
    },
    c4,
    delta:
      c4 &&
      Object.fromEntries(
        ['submittedTasks', 'completedTasks', 'submittedBytes', 'failedTasks', 'staleResults'].map((k) => [
          k,
          c4.workers[k] - c0.workers[k],
        ]),
      ),
  });
}
writeFileSync(resolve(base, 'summary.json'), JSON.stringify({ runs }, null, 2));
console.log(
  JSON.stringify(
    runs.map(({ name, valid, metrics }) => ({ name, valid, ...metrics })),
    null,
    2,
  ),
);
