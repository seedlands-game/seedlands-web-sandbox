import { describe, expect, it } from 'vitest';
import { parseNodeServerOptions } from '../../apps/node-server/src/node/server/node-server-options';

describe('Node playable network options', () => {
  it('keeps network disabled unless every explicit option is present', () => {
    expect(parseNodeServerOptions(['--data-directory', '/tmp/world']).network).toBeNull();
    expect(() =>
      parseNodeServerOptions([
        '--data-directory',
        '/tmp/world',
        '--listen',
        '127.0.0.1:8787',
        '--origin',
        'http://127.0.0.1:4173',
      ]),
    ).toThrow(/access-key-file/);
  });

  it('rejects non-loopback listeners and non-http origins', () => {
    expect(() =>
      parseNodeServerOptions([
        '--data-directory',
        '/tmp/world',
        '--listen',
        '0.0.0.0:8787',
        '--origin',
        'http://127.0.0.1:4173',
        '--access-key-file',
        '/tmp/key',
      ]),
    ).toThrow(/loopback/);
    expect(() =>
      parseNodeServerOptions([
        '--data-directory',
        '/tmp/world',
        '--listen',
        '127.0.0.1:8787',
        '--origin',
        'file:///tmp/index.html',
        '--access-key-file',
        '/tmp/key',
      ]),
    ).toThrow(/Origin/);
  });
});
