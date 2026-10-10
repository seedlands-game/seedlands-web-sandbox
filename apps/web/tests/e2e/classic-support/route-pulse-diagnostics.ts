import type { ClassicSnapshot } from './harness-snapshot';
import type { RoutePoint } from './scenario';
import type { Page } from '@playwright/test';
import { walkTo } from './harness';
import type { RouteDirection } from './route-progress';

function motion(value: ClassicSnapshot) {
  return {
    player: value.player,
    authorityPosition: value.serverPlayerPosition,
    velocity: value.serverPlayerVelocity,
    onGround: value.onGround,
    colliding: value.colliding,
    physicsTick: value.authority.physicsTick,
    acknowledgedInputSequence: value.authority.acknowledgedInputSequence,
  };
}

type Observation = ReturnType<typeof motion> & { elapsedMs: number };
type Pulse = {
  index: number;
  startedAtMs: number;
  before: Observation;
  beforeInput?: Observation;
  requestedDelayMs?: number;
  key?: string;
  inputStartedAtMs?: number;
  inputFinishedAtMs?: number;
  keyboardWallMs?: number;
  inputOutcome?: 'returned' | 'threw';
  polls: number;
  firstFreshAck?: Observation;
  firstSettled?: Observation;
  lastObservation?: Observation;
};

/** Node-side diagnostic reuses observations already required by walkTo. */
export class RoutePulseDiagnostics {
  private readonly startedAt = Date.now();
  private readonly pulses: Pulse[] = [];
  private current: Pulse | undefined;
  private pulseCount = 0;

  constructor(
    private readonly label: string,
    private readonly target: RoutePoint,
    private readonly timeoutMs: number,
  ) {}

  begin(value: ClassicSnapshot): void {
    this.pulseCount += 1;
    this.current = undefined;
    if (this.pulses.length >= 512) return;
    const elapsedMs = Date.now() - this.startedAt;
    this.current = {
      index: this.pulseCount,
      startedAtMs: elapsedMs,
      before: { ...motion(value), elapsedMs },
      polls: 0,
    };
    this.pulses.push(this.current);
  }

  beforeInput(value: ClassicSnapshot, delayMs: number, key: string): void {
    if (!this.current) return;
    const elapsedMs = Date.now() - this.startedAt;
    this.current.beforeInput = { ...motion(value), elapsedMs };
    this.current.requestedDelayMs = delayMs;
    this.current.key = key;
    this.current.inputStartedAtMs = elapsedMs;
  }

  inputFinished(outcome: 'returned' | 'threw'): void {
    if (!this.current || this.current.inputStartedAtMs === undefined) return;
    this.current.inputFinishedAtMs = Date.now() - this.startedAt;
    this.current.keyboardWallMs = this.current.inputFinishedAtMs - this.current.inputStartedAtMs;
    this.current.inputOutcome = outcome;
  }

  observe(value: ClassicSnapshot, settled: boolean): void {
    if (!this.current) return;
    const observed = { ...motion(value), elapsedMs: Date.now() - this.startedAt };
    this.current.polls += 1;
    this.current.lastObservation = observed;
    const beforeAck = this.current.beforeInput?.acknowledgedInputSequence;
    if (beforeAck !== undefined && value.authority.acknowledgedInputSequence > beforeAck)
      this.current.firstFreshAck ??= observed;
    if (settled) this.current.firstSettled ??= observed;
  }

  report(status: 'returned' | 'threw'): void {
    const elapsedMs = Date.now() - this.startedAt;
    console.info(
      'Classic C4 route pulse diagnostic:',
      JSON.stringify({
        diagnosticOnly: true,
        eligible: false,
        observationTiming: 'First matching existing post-release settle poll; not actual server ACK time.',
        label: this.label,
        target: this.target,
        timeoutMs: this.timeoutMs,
        status,
        elapsedMs,
        remainingMs: this.timeoutMs - elapsedMs,
        pulseCount: this.pulseCount,
        truncated: this.pulseCount > this.pulses.length,
        pulses: this.pulses,
      }),
    );
  }
}

async function withRoutePulseDiagnostics<T>(
  label: string,
  target: RoutePoint,
  timeoutMs: number,
  run: (diagnostics?: RoutePulseDiagnostics) => Promise<T>,
): Promise<T> {
  if (process.env.SEEDLANDS_CLASSIC_BENCHMARK === '1') return run();
  const diagnostics = new RoutePulseDiagnostics(label, target, timeoutMs);
  let status: 'returned' | 'threw' = 'threw';
  try {
    const result = await run(diagnostics);
    status = 'returned';
    return result;
  } finally {
    diagnostics.report(status);
  }
}

/** Original C4 options remain fixed; the wrapper only records existing observations. */
export function walkC4Route(page: Page, target: RoutePoint, key: RouteDirection = 'KeyW'): Promise<ClassicSnapshot> {
  return withRoutePulseDiagnostics(key === 'KeyW' ? 'C4-outbound' : 'C4-return', target, 90_000, (diagnostics) =>
    walkTo(page, target, { key, jump: true, timeout: 90_000, diagnostics }),
  );
}
