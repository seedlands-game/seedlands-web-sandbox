import { pairedBootstrap } from './combined-statistics';
import type { CombinedVariant } from './combined-support';
export type MetricName =
  | 'readyMs'
  | 'activeCpuMs'
  | 'frameP50Ms'
  | 'frameP95Ms'
  | 'frameP99Ms'
  | 'physicsP95Ms'
  | 'editVisibleP50Ms'
  | 'editVisibleP95Ms'
  | 'editVisibleP99Ms';

export function metricStatistics(
  runs: readonly {
    block: number;
    variant: CombinedVariant;
    status: string;
    metrics: Record<MetricName, number | null>;
  }[],
) {
  const result: Record<string, object> = {};
  const metrics: readonly MetricName[] = [
    'readyMs',
    'activeCpuMs',
    'frameP50Ms',
    'frameP95Ms',
    'frameP99Ms',
    'physicsP95Ms',
    'editVisibleP50Ms',
    'editVisibleP95Ms',
    'editVisibleP99Ms',
  ];
  for (const metric of metrics) {
    const byVariant = (variant: CombinedVariant) =>
      Array.from(
        { length: 10 },
        (_, index) =>
          runs.find((run) => run.block === index + 1 && run.variant === variant && run.status === 'valid')?.metrics[
            metric
          ],
      );
    const a = byVariant('A');
    const aPrime = byVariant('A_PRIME');
    const b = byVariant('B');
    const complete = [...a, ...aPrime, ...b].every((value): value is number => typeof value === 'number');
    const positive = complete && [...a, ...aPrime, ...b].every((value) => typeof value === 'number' && value > 0);
    result[metric] = positive
      ? {
          unit: 'run',
          aVsAPrime: pairedBootstrap(a as number[], aPrime as number[]),
          aPrimeVsB: pairedBootstrap(aPrime as number[], b as number[]),
          aVsB: pairedBootstrap(a as number[], b as number[]),
        }
      : {
          status: complete ? 'BELOW_TIMER_RESOLUTION' : 'INVALID_DUE_TO_RUN_FAILURE',
          unit: 'run',
          values: { A: a, A_PRIME: aPrime, B: b },
        };
  }
  return result;
}
