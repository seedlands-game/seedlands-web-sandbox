import type { Page } from '@playwright/test';

export async function collectEnvironment(page: Page): Promise<object> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return {
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      internalCanvas: canvas ? [canvas.width, canvas.height] : null,
      visibilityState: document.visibilityState,
      focused: document.hasFocus(),
      hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent,
      screen: {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth,
        refreshRate: 'NOT_COLLECTED',
      },
      memory: 'memory' in performance ? (performance as Performance & { memory?: object }).memory : 'UNSUPPORTED',
    };
  });
}

export async function collectResourceManifest(page: Page): Promise<object[]> {
  return page.evaluate(async () => {
    const urls = [location.href, ...performance.getEntriesByType('resource').map((entry) => entry.name)];
    const unique = [...new Set(urls.filter((url) => url.startsWith(location.origin)))];
    const hexadecimal = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const resources = [];
    for (const url of unique) {
      const response = await fetch(url, { cache: 'force-cache' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const hash = hexadecimal(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
      resources.push({
        url: new URL(url).pathname,
        bytes: bytes.byteLength,
        sha256: hash,
        contentType: response.headers.get('content-type'),
      });
    }
    return resources.sort((left, right) => left.url.localeCompare(right.url));
  });
}
