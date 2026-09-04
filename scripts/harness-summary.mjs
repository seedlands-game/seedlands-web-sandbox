export const percentile = (values, q) =>
  values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * q) - 1))];

export const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1),
    totalMs: sorted.reduce((sum, value) => sum + value, 0),
  };
};

export const bytes = (value) => new TextEncoder().encode(value).byteLength;
