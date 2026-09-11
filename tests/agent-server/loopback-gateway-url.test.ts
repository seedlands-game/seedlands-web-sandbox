import { describe, expect, it } from 'vitest';
import { readLoopbackGatewayUrl } from '../../apps/agent-server/src/node/loopback-gateway-url';

describe('loopback model gateway URL', () => {
  it.each([
    ['http://[::1]:4000/v1/', 'http://[::1]:4000/v1'],
    ['http://127.0.0.1:4000/v1/', 'http://127.0.0.1:4000/v1'],
    ['https://localhost:4000/v1/', 'https://localhost:4000/v1'],
  ])('accepts exact loopback gateway URL %s', (value, expected) => {
    expect(readLoopbackGatewayUrl(value)).toBe(expected);
  });

  it.each([
    'http://[::2]:4000/v1',
    'http://user@127.0.0.1:4000/v1',
    'http://127.0.0.1:4000/v1?tenant=other',
    'ws://127.0.0.1:4000/v1',
  ])('rejects non-exact loopback gateway URL %s', (value) => {
    expect(() => readLoopbackGatewayUrl(value)).toThrow(/exact loopback gateway URL/);
  });
});
