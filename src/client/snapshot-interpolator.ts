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

  constructor(private readonly options: Readonly<{ interpolationDelayMs: number; maxExtrapolationMs: number }>) {
    if (
      ![options.interpolationDelayMs, options.maxExtrapolationMs].every((value) => Number.isFinite(value) && value >= 0)
    )
      throw new RangeError('Interpolation timing must be finite and non-negative.');
  }

  push(snapshot: InterpolationSnapshot) {
    if (
      !snapshot.epoch ||
      !Number.isSafeInteger(snapshot.physicsTick) ||
      snapshot.physicsTick < 0 ||
      ![snapshot.integratedPhysicsTimeMs, snapshot.activeTimeMs].every(
        (value) => Number.isFinite(value) && value >= 0,
      ) ||
      ![snapshot.position.x, snapshot.position.y, snapshot.position.z].every(Number.isFinite)
    )
      return false;
    if (!this.epoch) this.epoch = snapshot.epoch;
    if (snapshot.epoch !== this.epoch) return false;
    const latest = this.snapshots.at(-1);
    if (
      latest &&
      (snapshot.physicsTick <= latest.physicsTick || snapshot.integratedPhysicsTimeMs <= latest.integratedPhysicsTimeMs)
    )
      return false;
    this.snapshots.push({ ...snapshot, position: { ...snapshot.position } });
    if (this.snapshots.length > 32) this.snapshots.shift();
    return true;
  }

  reset(epoch: string) {
    if (!epoch) throw new RangeError('Interpolation epoch must not be empty.');
    this.epoch = epoch;
    this.snapshots.length = 0;
  }

  sample(epoch: string, renderIntegratedPhysicsTimeMs: number): InterpolationSample {
    if (epoch !== this.epoch || !this.snapshots.length) throw new RangeError('No snapshots for this epoch.');
    if (!Number.isFinite(renderIntegratedPhysicsTimeMs)) throw new RangeError('Interpolation time must be finite.');
    const targetTime = renderIntegratedPhysicsTimeMs - this.options.interpolationDelayMs;
    const first = this.snapshots[0]!;
    const latest = this.snapshots.at(-1)!;
    if (targetTime <= first.integratedPhysicsTimeMs)
      return { position: { ...first.position }, mode: 'held', physicsTick: first.physicsTick };
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
    if (!previous || extrapolationMs <= 0)
      return { position: { ...latest.position }, mode: 'held', physicsTick: latest.physicsTick };
    const duration = latest.integratedPhysicsTimeMs - previous.integratedPhysicsTimeMs;
    if (duration <= 0) return { position: { ...latest.position }, mode: 'held', physicsTick: latest.physicsTick };
    return {
      position: interpolatePosition(
        previous.position,
        latest.position,
        1 + Math.min(extrapolationMs, this.options.maxExtrapolationMs) / duration,
      ),
      mode: extrapolationMs > this.options.maxExtrapolationMs ? 'held' : 'extrapolated',
      physicsTick: latest.physicsTick,
    };
  }
}
