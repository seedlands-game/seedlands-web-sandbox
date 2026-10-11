import { bodyConfigFor } from '@seedlands/stdlib/physics';
import type { Point, RoutePoint } from './scenario';

/** Functional steering uses settled progress, never diagnostic body/contact data. */
export class RouteCrowdRecovery {
  private slowPulses = 0;
  private attempts = 0;
  private remainingPulses = 0;
  private waypoint: RoutePoint | undefined;

  constructor(private readonly goal: RoutePoint) {}

  aimTarget(position: Point): RoutePoint {
    if (
      this.waypoint &&
      (this.remainingPulses === 0 || Math.hypot(position[0] - this.waypoint[0], position[2] - this.waypoint[1]) < 0.65)
    ) {
      this.waypoint = undefined;
      this.slowPulses = 0;
    }
    return this.waypoint ?? this.goal;
  }

  observe(before: Point, after: Point, pulseMs: number): void {
    if (this.waypoint) {
      this.remainingPulses--;
      return;
    }
    const dx = this.goal[0] - before[0],
      dz = this.goal[1] - before[2];
    const distance = Math.hypot(dx, dz);
    const expected = (pulseMs / 1000) * bodyConfigFor('player').maxHorizontalSpeed!;
    const progress = distance > 0 ? ((after[0] - before[0]) * dx + (after[2] - before[2]) * dz) / distance : 0;
    if (pulseMs < 200 || distance < 3 || progress >= expected * 0.75) {
      this.slowPulses = 0;
      return;
    }
    if (++this.slowPulses < 2 || this.attempts >= 3) return;
    const side = this.attempts++ % 2 === 0 ? 1 : -1;
    this.waypoint = [
      after[0] + (2.5 * dx) / distance - (side * 1.25 * dz) / distance,
      after[2] + (2.5 * dz) / distance + (side * 1.25 * dx) / distance,
    ];
    this.remainingPulses = 4;
    this.slowPulses = 0;
  }
}
