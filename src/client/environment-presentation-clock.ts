const wrapHour = (hour: number) => (hour >= 0 && hour < 24 ? hour : ((hour % 24) + 24) % 24);

/** 表现时刻只追随权威目标，不反向写入游戏时钟。 */
export class EnvironmentPresentationClock {
  private hour: number;

  constructor(hour: number) {
    if (!Number.isFinite(hour)) throw new RangeError('World hour must be finite.');
    this.hour = wrapHour(hour);
  }

  reset(hour: number): number {
    if (!Number.isFinite(hour)) throw new RangeError('World hour must be finite.');
    this.hour = wrapHour(hour);
    return this.hour;
  }

  advance(authorityHour: number, dt: number, paused = false): number {
    if (!Number.isFinite(authorityHour) || !Number.isFinite(dt) || dt < 0)
      throw new RangeError('World hour and non-negative frame duration must be finite.');
    const target = wrapHour(authorityHour);
    const delta = ((target - this.hour + 36) % 24) - 12;
    // 显式跳时由 reset 处理；运行态延迟快照始终按真实帧间隔连续追随。
    if (paused) return this.reset(target);
    this.hour = wrapHour(this.hour + delta * (1 - Math.exp(-Math.min(dt, 0.1) / 0.05)));
    return this.hour;
  }
}
