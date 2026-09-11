import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function server(reuse = false, production = false, ci = false) {
  vi.stubEnv('CI', ci ? '1' : '');
  vi.stubEnv('SEEDLANDS_E2E_REUSE_SERVER', reuse ? '1' : '');
  vi.stubEnv('SEEDLANDS_E2E_PRODUCTION', production ? '1' : '');
  vi.resetModules();
  const value = (await import('../../playwright.config')).default.webServer;
  if (!value || Array.isArray(value)) throw new Error('Expected one explicitly owned browser test server');
  return value;
}

it('does not accept an unrelated service on the test port or silently select a different port', async () => {
  const configuration = await server();
  expect(configuration.reuseExistingServer).toBe(false);
  expect(configuration.command).toContain('--strictPort');
});

it('only explicit local reuse is accepted; production and CI always own a fresh server', async () => {
  expect((await server(true)).reuseExistingServer).toBe(true);
  expect((await server(true, true)).reuseExistingServer).toBe(false);
  expect((await server(true, false, true)).reuseExistingServer).toBe(false);
});
