import { rename, writeFile } from 'node:fs/promises';

export function compareNodeMetrics(current, baseline) {
  const verdicts = {};
  for (const [key, value] of Object.entries(current)) {
    const previous = baseline?.metrics?.[key];
    if (typeof value !== 'number' || typeof previous !== 'number' || previous === 0) continue;
    const percent = ((value - previous) / previous) * 100;
    const higherIsBetter = key.includes('Throughput');
    const regressionPercent = higherIsBetter ? -percent : percent;
    verdicts[key] = {
      baseline: previous,
      current: value,
      percent,
      direction: higherIsBetter ? 'higher-is-better' : 'lower-is-better',
      status: regressionPercent > 15 ? 'REGRESSION' : regressionPercent > 5 ? 'WARNING' : 'OK',
    };
  }
  return verdicts;
}

export function compareBrowserProfiles(current, baseline, environmentComparable) {
  if (!current?.profiles || !baseline?.browserProfiles) return {};
  return Object.fromEntries(
    Object.entries(current.profiles).map(([profile, value]) => {
      if (!environmentComparable || value?.status !== 'PASS' || baseline.browserProfiles[profile]?.status !== 'PASS')
        return [profile, { status: 'NOT_COMPARABLE' }];
      const metrics = {};
      for (const [key, currentValue] of Object.entries(value.metrics ?? {})) {
        const previous = baseline.browserProfiles[profile]?.metrics?.[key];
        if (typeof currentValue === 'number' && typeof previous === 'number' && previous !== 0)
          metrics[key] = {
            baseline: previous,
            current: currentValue,
            percent: ((currentValue - previous) / previous) * 100,
          };
      }
      return [profile, { status: 'OBSERVED', metrics }];
    }),
  );
}

export function browserProfileSummaryLines(browserBenchmark, comparison) {
  return [
    `- ${browserBenchmark.status}${browserBenchmark.profiles ? ' — dual browser profiles collected.' : ` — ${browserBenchmark.note}`}`,
    ...Object.entries(comparison).map(
      ([profile, value]) =>
        `- ${profile}: ${value.status}${
          value.metrics
            ? `; ${Object.entries(value.metrics)
                .map(([metric, metricValue]) => `${metric} ${metricValue.percent.toFixed(1)}%`)
                .join(', ')}`
            : ''
        }.`,
    ),
  ];
}

export async function updateBrowserProfileBaseline(path, payload) {
  const valid =
    payload.browserBenchmark.status === 'PASS' &&
    payload.browserBenchmark.profiles &&
    Object.values(payload.browserBenchmark.profiles).every((profile) => profile.status === 'PASS');
  if (!valid) return false;
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        ...(payload.preserved?.bundleBaseline ? { bundleBaseline: payload.preserved.bundleBaseline } : {}),
        schemaVersion: 2,
        createdAt: payload.createdAt,
        sourceSha: payload.sourceSha,
        environment: payload.environment,
        metrics: payload.metrics,
        browserProfiles: payload.browserBenchmark.profiles,
      },
      null,
      2,
    )}\n`,
  );
  await rename(temporaryPath, path);
  return true;
}
