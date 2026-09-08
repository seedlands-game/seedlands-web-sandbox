import { describe, expect, it } from 'vitest';
import { RemoteAuthorityClient } from '../../apps/web/src/client/authority/remote-authority-client';

describe('RemoteAuthorityClient boundary', () => {
  it('rejects local administrative mutations instead of forwarding an internal RPC', async () => {
    const client = Object.create(RemoteAuthorityClient.prototype) as RemoteAuthorityClient;
    await expect(client.editWorld('harness', [])).rejects.toThrow(/远端模式不开放/);
    await expect(client.setPlayerPosition([0, 0, 0])).rejects.toThrow(/远端模式不开放/);
    await expect(client.setWorldTime(12)).rejects.toThrow(/远端模式不开放/);
  });
});
