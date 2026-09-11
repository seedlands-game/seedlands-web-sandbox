import { afterEach, describe, expect, it } from 'vitest';
import { startResidentServer } from '../src/node/resident-host';
import { actor, WireClient } from './resident-host-fixture';
import { waitCapabilities } from './fixtures';

const origin = 'http://127.0.0.1:5173';
const token = 'breaking-wire-pair';
const handles: Awaited<ReturnType<typeof startResidentServer>>[] = [];

async function server() {
  const handle = await startResidentServer({
    workspace: {} as never,
    framework: {} as never,
    flash: null,
    pro: null,
    allowedOrigins: [origin],
    pairingToken: token,
  });
  handles.push(handle);
  return handle;
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('resident v2 breaking wire boundary', () => {
  it('reports and closes an old hello that presents actor capabilities as world authority', async () => {
    const handle = await server();
    const client = await WireClient.connect(handle.url, origin);
    const closed = new Promise<number>((resolve) => client.socket.once('close', resolve));
    client.socket.send(
      JSON.stringify({
        protocolVersion: 2,
        sequence: 0,
        kind: 'hello',
        pairingToken: token,
        world: { worldId: 'world', timelineId: 'timeline', epoch: 'epoch' },
        capabilities: waitCapabilities(),
      }),
    );
    await expect(client.wait('error')).resolves.toMatchObject({ code: 'BAD_FRAME', message: 'pairing required' });
    await expect(closed).resolves.toBe(1008);
  });

  it('never falls back to authoring capabilities when an old bind omits its actor catalog', async () => {
    const handle = await server();
    const client = await WireClient.connect(handle.url, origin);
    const capabilities = waitCapabilities();
    client.send({
      kind: 'hello',
      pairingToken: token,
      world: { worldId: 'world', timelineId: 'timeline', epoch: 'epoch-1' },
      authoringCapabilities: capabilities,
    });
    await client.wait('ready');
    const current = actor(1);
    const closed = new Promise<number>((resolve) => client.socket.once('close', resolve));
    client.socket.send(
      JSON.stringify({
        protocolVersion: 2,
        sequence: 1,
        kind: 'bind',
        binding: { ...current.binding, worldId: 'world' },
        observation: current.observation,
      }),
    );
    await expect(client.wait('error')).resolves.toMatchObject({
      code: 'BAD_FRAME',
      message: 'invalid resident binding',
    });
    await expect(closed).resolves.toBe(1008);
  });
});
