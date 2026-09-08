const INITIAL_WORLD_READY_TIMEOUT_MS = 30_000;

type InitialWorldReadyDiagnostics = () => Readonly<Record<string, number>>;

export async function waitForInitialWorldReady(
  ready: Promise<void>,
  diagnostics?: InitialWorldReadyDiagnostics,
): Promise<void> {
  let timeout: number | undefined;
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          try {
            if (diagnostics) console.error(JSON.stringify({ kind: 'initial-world-ready-timeout', ...diagnostics() }));
          } catch {
            console.error(JSON.stringify({ kind: 'initial-world-ready-timeout', diagnosticsUnavailable: true }));
          } finally {
            reject(new Error('初始区块加载超时，请重试。'));
          }
        }, INITIAL_WORLD_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}
