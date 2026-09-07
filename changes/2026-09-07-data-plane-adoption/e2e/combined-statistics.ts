export const percentile = (values: readonly number[], quantile: number): number => {
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error('分位数样本必须为非空有限数值。');
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const low = Math.floor(position);
  return sorted[low]! + (sorted[Math.ceil(position)]! - sorted[low]!) * (position - low);
};

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** 以完整 block 为配对重采样单位，不把同一运行中的帧或编辑样本伪装成独立样本。 */
export function pairedBootstrap(baseline: readonly number[], candidate: readonly number[], iterations = 10_000) {
  if (
    baseline.length !== candidate.length ||
    baseline.length < 2 ||
    [...baseline, ...candidate].some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error('Bootstrap 至少需要两个完整、非负的配对 block。');
  const baselineMean = mean(baseline);
  const candidateMean = mean(candidate);
  if (baselineMean <= 0) throw new Error('基线均值必须为正数。');
  let seed = 0x7092026;
  const improvements: number[] = [];
  for (let sample = 0; sample < iterations; sample += 1) {
    let baselineTotal = 0;
    let candidateTotal = 0;
    for (let pair = 0; pair < baseline.length; pair += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const index = Math.floor((seed / 4_294_967_296) * baseline.length);
      baselineTotal += baseline[index]!;
      candidateTotal += candidate[index]!;
    }
    improvements.push((1 - candidateTotal / baselineTotal) * 100);
  }
  return {
    improvementPercent: (1 - candidateMean / baselineMean) * 100,
    absoluteDelta: candidateMean - baselineMean,
    ci95Percent: [percentile(improvements, 0.025), percentile(improvements, 0.975)] as const,
    baselineMean,
    candidateMean,
    pairs: baseline.length,
    bootstrapSeed: '0x07092026',
    iterations,
  };
}
