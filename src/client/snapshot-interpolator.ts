import type { Vec3 } from '../physics';

export type InterpolationSnapshot = Readonly<{
  epoch: string;
  physicsTick: number;
  integratedPhysicsTimeMs: number;
  activeTimeMs: number;
  position: Vec3;
}>;

export type InterpolationSample = Readonly<{
  position: Vec3;
  mode: 'interpolated' | 'extrapolated' | 'held';
  physicsTick: number;
}>;

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const interpolatePosition = (from: Vec3, to: Vec3, amount: number): Vec3 => ({
  x: lerp(from.x, to.x, amount),
  y: lerp(from.y, to.y, amount),
  z: lerp(from.z, to.z, amount),
});

export class SnapshotInterpolator {
  private readonly snapshots: InterpolationSnapshot[] = [];
  private epoch: string | null = null;

  constructor(private readonly options: Readonly<{ interpolationDelayMs: number; maxExtrapolationMs: number }>) {}

  push(snapshot: InterpolationSnapshot) {
    if (!this.epoch) this.epoch = snapshot.epoch;
    if (snapshot.epoch !== this.epoch) return false;
    const latest = this.snapshots.at(-1);
    if (latest && snapshot.physicsTick <= latest.physicsTick) return false;
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 32) this.snapshots.shift();
    return true;
  }

  reset(epoch: string) {
    this.epoch = epoch;
    this.snapshots.length = 0;
  }

  sample(epoch: string, renderIntegratedPhysicsTimeMs: number): InterpolationSample {
    if (epoch !== this.epoch || !this.snapshots.length) throw new RangeError('No snapshots for this epoch.');
    const targetTime = renderIntegratedPhysicsTimeMs - this.options.interpolationDelayMs;
    const first = this.snapshots[0]!;
    const latest = this.snapshots.at(-1)!;
    if (targetTime <= first.integratedPhysicsTimeMs)
      return { position: first.position, mode: 'held', physicsTick: first.physicsTick };
    for (let index = 1; index < this.snapshots.length; index += 1) {
      const right = this.snapshots[index]!;
      if (targetTime > right.integratedPhysicsTimeMs) continue;
      const left = this.snapshots[index - 1]!;
      const duration = right.integratedPhysicsTimeMs - left.integratedPhysicsTimeMs;
      const amount = duration > 0 ? (targetTime - left.integratedPhysicsTimeMs) / duration : 1;
      return {
        position: interpolatePosition(left.position, right.position, amount),
        mode: 'interpolated',
        physicsTick: right.physicsTick,
      };
    }
    const extrapolationMs = targetTime - latest.integratedPhysicsTimeMs;
    const previous = this.snapshots.at(-2);
    if (!previous || extrapolationMs <= 0 || extrapolationMs > this.options.maxExtrapolationMs)
      return { position: latest.position, mode: 'held', physicsTick: latest.physicsTick };
    const duration = latest.integratedPhysicsTimeMs - previous.integratedPhysicsTimeMs;
    if (duration <= 0) return { position: latest.position, mode: 'held', physicsTick: latest.physicsTick };
    return {
      position: interpolatePosition(previous.position, latest.position, 1 + extrapolationMs / duration),
      mode: 'extrapolated',
      physicsTick: latest.physicsTick,
    };
  }
}
