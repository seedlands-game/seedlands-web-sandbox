const HELD_ATTACK_INTERVAL_MS = 200;

/** Render and pointer-held timers share one deadline; delayed work never catches up. */
export class HeldPointerAttackCadence {
  private active = false;
  private nextAttackAtMs = Number.POSITIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly attack: () => void) {}

  start(): void {
    this.stop();
    this.active = true;
    this.nextAttackAtMs = performance.now();
  }

  attempt(): void {
    if (!this.active) return;
    const now = performance.now();
    if (now >= this.nextAttackAtMs) {
      this.nextAttackAtMs = now + HELD_ATTACK_INTERVAL_MS;
      this.attack();
    }
    this.schedule();
  }

  stop(): void {
    this.active = false;
    this.nextAttackAtMs = Number.POSITIVE_INFINITY;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.active || this.timer !== null) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.attempt();
      },
      Math.max(0, this.nextAttackAtMs - performance.now()),
    );
  }
}
