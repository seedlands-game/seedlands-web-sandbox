export const percentile = (values: readonly number[], quantile: number): number => {
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error('Samples must be finite and non-empty.');
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
};

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** 成对重采样完整运行，不把同一运行的帧或任务当作独立统计样本；改善单位为百分比。 */
export function pairedBootstrap(a: readonly number[], b: readonly number[], iterations = 10000) {
  if (a.length !== b.length || a.length < 2 || [...a, ...b].some((n) => !Number.isFinite(n) || n < 0))
    throw new Error('Bootstrap requires at least two valid paired runs.');
  const baseline = mean(a);
  const candidate = mean(b);
  if (baseline <= 0) throw new Error('Baseline must be positive.');
  let seed = 0x5072026;
  const ratios: number[] = [];
  for (let sample = 0; sample < iterations; sample += 1) {
    let totalA = 0;
    let totalB = 0;
    for (let pair = 0; pair < a.length; pair += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const index = Math.floor((seed / 4294967296) * a.length);
      totalA += a[index];
      totalB += b[index];
    }
    ratios.push((1 - totalB / totalA) * 100);
  }
  return {
    improvement: (1 - candidate / baseline) * 100,
    ci95: [percentile(ratios, 0.025), percentile(ratios, 0.975)] as const,
    baseline,
    candidate,
    pairs: a.length,
    bootstrapSeed: '0x05072026',
    iterations,
  };
}
