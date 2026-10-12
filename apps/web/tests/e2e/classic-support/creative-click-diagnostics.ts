import type { CDPSession, Page, TestInfo } from '@playwright/test';

const observation = `(() => {
  const filter = document.querySelector('#creative-item-filter');
  const catalog = document.querySelector('#creative-catalog');
  const button = [...(catalog?.querySelectorAll('button') ?? [])]
    .find(node => (node.getAttribute('aria-label') ?? '').startsWith('将木锄放入创造快捷栏 '));
  const rect = button?.getBoundingClientRect();
  const style = button && getComputedStyle(button);
  const probe = globalThis.__seedlandsCreativeClickProbe;
  return { now: performance.now(), filterValue: filter?.value ?? null,
    button: button ? { connected: button.isConnected, disabled: button.disabled,
      width: rect.width, height: rect.height, display: style.display, visibility: style.visibility,
      centerTag: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.tagName ?? null } : null,
    tasks: probe?.tasks ?? [] };
})()`;

/** Correctness diagnostics only: observes the original click without replacing its input or deadline. */
export async function observeCreativeClick(page: Page, info: TestInfo, click: () => Promise<void>): Promise<void> {
  if (process.env.CI || process.env.SEEDLANDS_CLASSIC_BENCHMARK === '1')
    throw new Error('Creative click diagnostics cannot run in CI or a performance window.');
  const session = await page.context().newCDPSession(page);
  const records: unknown[] = [];
  const bounded = async (phase: string, method: string, params?: Record<string, unknown>) => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        session.send(method as Parameters<CDPSession['send']>[0], params),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('diagnostic read exceeded 750ms')), 750);
        }),
      ]);
      records.push({ phase, method, startedAt, endedAt: Date.now(), status: 'replied', value });
    } catch (error) {
      records.push({
        phase,
        method,
        startedAt,
        endedAt: Date.now(),
        status: 'unavailable',
        error: String(error).slice(0, 240),
      });
    } finally {
      clearTimeout(timer);
    }
  };
  await bounded('setup', 'Runtime.evaluate', {
    expression: `(() => {
      const probe = { tasks: [] };
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (probe.tasks.length === 64) probe.tasks.shift();
          probe.tasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ type: 'longtask', buffered: false });
      globalThis.__seedlandsCreativeClickProbe = probe;
      globalThis.__seedlandsCreativeClickProbeObserver = observer;
      return { installedAt: performance.now() };
    })()`,
    returnByValue: true,
    timeout: 500,
  });
  await bounded('setup', 'Performance.enable');
  const sample = (phase: string) =>
    Promise.allSettled([
      bounded(phase, 'Runtime.evaluate', { expression: observation, returnByValue: true, timeout: 500 }),
      bounded(phase, 'Performance.getMetrics'),
    ]);
  await sample('before-click');
  let during: Promise<unknown> | undefined;
  const timer = setTimeout(() => {
    during = sample('during-click');
  }, 250);
  const startedAt = Date.now();
  let status = 'PASS';
  try {
    await click();
  } catch (error) {
    status = 'FAIL';
    throw error;
  } finally {
    const endedAt = Date.now();
    clearTimeout(timer);
    await during;
    await sample('after-click');
    await bounded('cleanup', 'Runtime.evaluate', {
      expression: 'globalThis.__seedlandsCreativeClickProbeObserver?.disconnect()',
      timeout: 500,
    });
    await info.attach('creative-click-protocol-diagnostic.json', {
      body: JSON.stringify({
        scope: 'READ_ONLY_DIAGNOSTIC',
        performanceClaim: false,
        status,
        startedAt,
        endedAt,
        records,
      }),
      contentType: 'application/json',
    });
    await session.detach().catch(() => undefined);
  }
}
