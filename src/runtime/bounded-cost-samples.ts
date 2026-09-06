export type CostSampleWindow = Readonly<{ count: number; capacity: number; samplesMs: number[] }>;

/** 计时结果只用于诊断，环形窗口不参与调度与物理积分。 */
export class BoundedCostSamples {
  private readonly values: Float64Array;
  private count = 0;

  constructor(private readonly capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError('采样容量必须为正整数。');
    this.values = new Float64Array(capacity);
  }

  record(costMs: number): void {
    if (!Number.isFinite(costMs) || costMs < 0) throw new RangeError('执行成本必须为非负有限毫秒数。');
    this.values[this.count % this.capacity] = costMs;
    this.count += 1;
  }

  snapshot(): CostSampleWindow {
    const start = Math.max(0, this.count - this.capacity);
    return {
      count: this.count,
      capacity: this.capacity,
      samplesMs: Array.from({ length: this.count - start }, (_, index) => this.values[(start + index) % this.capacity]),
    };
  }
}
