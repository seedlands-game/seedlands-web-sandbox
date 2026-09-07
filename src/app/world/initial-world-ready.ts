const INITIAL_WORLD_READY_TIMEOUT_MS = 30_000;

export async function waitForInitialWorldReady(ready: Promise<void>): Promise<void> {
  let timeout: number | undefined;
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error('初始区块加载超时，请重试。')),
          INITIAL_WORLD_READY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}
