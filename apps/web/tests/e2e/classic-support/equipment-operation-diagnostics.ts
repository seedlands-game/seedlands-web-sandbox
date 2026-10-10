import type { Point } from './scenario';

/** Node-side operation timing; no browser query, input, frame wait or performance claim. */
export async function observeEquipmentOperation<T>(phase: string, target: Point, run: () => Promise<T>): Promise<T> {
  if (process.env.SEEDLANDS_CLASSIC_BENCHMARK === '1') return run();
  const startedAtMs = Date.now();
  let outcome: 'returned' | 'threw' = 'threw';
  try {
    const value = await run();
    outcome = 'returned';
    return value;
  } finally {
    console.info(
      'Classic V2 resource operation diagnostic:',
      JSON.stringify({
        diagnosticOnly: true,
        eligible: false,
        phase,
        target,
        elapsedMs: Date.now() - startedAtMs,
        outcome,
      }),
    );
  }
}
