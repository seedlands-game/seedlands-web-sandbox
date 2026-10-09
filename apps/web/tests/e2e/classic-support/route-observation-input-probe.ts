import type { Page } from '@playwright/test';

type InputProbe = Readonly<{ id: string; eventCount: number; dispose: () => void }>;
export type RouteInputProbeWindow = Window & { __seedlandsRouteObservationInputProbe?: InputProbe };

export async function installRouteInputProbe(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const host = window as RouteInputProbeWindow;
    if (host.__seedlandsRouteObservationInputProbe) throw new Error('Route input observer already exists.');
    let eventCount = 0;
    const observe = () => {
      eventCount += 1;
    };
    const listeners: Array<Readonly<{ target: EventTarget; type: string }>> = [];
    const probe = Object.freeze({
      id,
      get eventCount() {
        return eventCount;
      },
      dispose() {
        for (const { target, type } of listeners) target.removeEventListener(type, observe, { capture: true });
        if (host.__seedlandsRouteObservationInputProbe !== probe)
          throw new Error('Route input observer ownership changed.');
        delete host.__seedlandsRouteObservationInputProbe;
      },
    });
    host.__seedlandsRouteObservationInputProbe = probe;
    try {
      for (const type of [
        'keydown',
        'keyup',
        'pointerdown',
        'pointerup',
        'pointermove',
        'mousemove',
        'wheel',
        'blur',
        'focus',
      ]) {
        window.addEventListener(type, observe, { capture: true, passive: true });
        listeners.push({ target: window, type });
      }
      document.addEventListener('pointerlockchange', observe, { capture: true, passive: true });
      listeners.push({ target: document, type: 'pointerlockchange' });
    } catch (error) {
      probe.dispose();
      throw error;
    }
  }, id);
}

export async function disposeRouteInputProbe(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const probe = (window as RouteInputProbeWindow).__seedlandsRouteObservationInputProbe;
    if (!probe || probe.id !== id) throw new Error('Route input observer ownership changed during cleanup.');
    probe.dispose();
  }, id);
}
