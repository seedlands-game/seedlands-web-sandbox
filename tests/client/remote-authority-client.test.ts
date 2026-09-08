import { describe, expect, it } from 'vitest';
import { RemoteAuthorityClient } from '../../apps/web/src/client/authority/remote-authority-client';
import { parseLocalPlayableUrl } from '../../apps/web/src/client/authority/remote-authority-projections';

describe('RemoteAuthorityClient boundary', () => {
  it('rejects local administrative mutations instead of forwarding an internal RPC', async () => {
    const client = Object.create(RemoteAuthorityClient.prototype) as RemoteAuthorityClient;
    await expect(client.editWorld()).rejects.toThrow(/远端模式不开放/);
    await expect(client.setPlayerPosition()).rejects.toThrow(/远端模式不开放/);
    await expect(client.setWorldTime()).rejects.toThrow(/远端模式不开放/);
  });

  it('accepts only an exact loopback playable websocket URL', () => {
    expect(parseLocalPlayableUrl('ws://127.0.0.1:8787/seedlands')).toBe('ws://127.0.0.1:8787/seedlands');
    expect(parseLocalPlayableUrl('ws://[::1]:8787/seedlands')).toBe('ws://[::1]:8787/seedlands');
    for (const value of [
      'ws://127.0.0.1:80@example.com/seedlands',
      'ws://example.com/seedlands',
      'wss://127.0.0.1:8787/seedlands',
      'ws://127.0.0.1:8787/other',
      'ws://127.0.0.1:8787/seedlands?key=secret',
      'ws://user:secret@127.0.0.1:8787/seedlands',
    ])
      expect(() => parseLocalPlayableUrl(value)).toThrow(/本机/);
  });
});
