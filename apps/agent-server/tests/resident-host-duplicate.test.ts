import { spawnSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { createGatewayChatModel } from '../src/gateway-model';
import { startResidentServer } from '../src/node/resident-host';
import { ResidentChannel } from '../src/resident-channel';
import { createPostgresFrameworkPersistence } from '../src/workspace';
import { actor, startHostDatabase, WireClient } from './resident-host-fixture';
import { waitCapabilities } from './fixtures';

const dockerAvailable = spawnSync('docker', ['version', '--format', '{{.Server.Version}}']).status === 0;
it.skipIf(!dockerAvailable)(
  'rejects duplicate channel identity and retires its existing resident',
  async () => {
    const container = `seedlands-duplicate-resident-${process.pid}`;
    const { workspace, connectionString } = await startHostDatabase(container, 'fake-test-only');
    const framework = await createPostgresFrameworkPersistence(connectionString, {
      checkpointSchema: 'duplicate_test',
    });
    const shutdown = vi.spyOn(ResidentChannel.prototype, 'shutdown');
    const model = createGatewayChatModel({
      tier: 'flash',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-test-only',
      fetch: async () =>
        new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'wait' } }] })),
    });
    const origin = 'http://127.0.0.1:5173';
    const handle = await startResidentServer({
      workspace,
      framework,
      flash: model,
      pro: model,
      allowedOrigins: [origin],
      pairingToken: 'fake-pair',
    });
    const client = await WireClient.connect(handle.url, origin);
    try {
      const capabilities = waitCapabilities();
      client.send({
        kind: 'hello',
        pairingToken: 'fake-pair',
        world: { worldId: 'world-1', timelineId: 'duplicate-timeline', epoch: 'epoch-1' },
        authoringCapabilities: capabilities,
      });
      await client.wait('ready');
      client.send({ kind: 'bind', ...actor(1), capabilities });
      await client.wait('bound');
      const second = actor(2);
      const closed = new Promise<number>((resolve) => client.socket.once('close', resolve));
      client.send({ kind: 'bind', ...second, binding: { ...second.binding, sessionId: 'channel-1' }, capabilities });
      await expect(client.wait('error')).resolves.toMatchObject({ kind: 'error', code: 'BAD_FRAME' });
      expect(await closed).toBe(1008);
      await handle.close();
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect((await workspace.listBindings('world-1', 'duplicate-timeline')).map((entry) => entry.actorId)).toEqual([
        'resident-1',
      ]);
    } finally {
      await client.close();
      await handle.close();
      shutdown.mockRestore();
      await framework.close();
      await workspace.close();
      spawnSync('docker', ['rm', '-f', container]);
    }
  },
  150_000,
);
