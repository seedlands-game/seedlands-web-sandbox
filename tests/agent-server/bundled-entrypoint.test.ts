import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { startHostDatabase, WireClient } from './resident-host-fixture';

type Ready = Readonly<{ url: string; pairingToken: string; protocolVersion: number; modelAvailability: string }>;

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<Ready> {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timeout = setTimeout(() => finish(new Error('Bundled Agent did not become ready')), 15000);
    const exited = () => finish(new Error('Bundled Agent exited before ready'));
    const finish = (error?: Error, ready?: Ready) => {
      clearTimeout(timeout);
      child.off('exit', exited);
      child.stdout.off('data', read);
      child.off('error', finish);
      if (error) reject(error);
      else resolve(ready!);
    };
    const read = (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      if (buffered.length > 65536) return finish(new Error('Bundled Agent startup output exceeded its limit'));
      const lines = buffered.split('\n');
      buffered = lines.pop()!;
      for (const line of lines) {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof value !== 'object' || value === null) continue;
        const record = value as Record<string, unknown>;
        if (record.kind !== 'resident-server-ready') continue;
        if (
          typeof record.url !== 'string' ||
          typeof record.pairingToken !== 'string' ||
          typeof record.protocolVersion !== 'number' ||
          typeof record.modelAvailability !== 'string'
        )
          return finish(new Error('Bundled Agent returned an invalid ready envelope'));
        finish(undefined, {
          url: record.url,
          pairingToken: record.pairingToken,
          protocolVersion: record.protocolVersion,
          modelAvailability: record.modelAvailability,
        });
        return;
      }
    };
    child.stdout.on('data', read);
    child.once('exit', exited);
    child.once('error', finish);
  });
}

async function portIsClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;

it.skipIf(!dockerAvailable)(
  'production Agent bundle uses real PostgreSQL and WebSocket, then releases its port on SIGTERM',
  async () => {
    const built = spawnSync('pnpm', ['build:agent'], { encoding: 'utf8', timeout: 60000 });
    expect(built.status, 'Production Agent build failed').toBe(0);
    const container = `seedlands-bundled-agent-${process.pid}`;
    let database: Awaited<ReturnType<typeof startHostDatabase>> | undefined;
    let child: ChildProcessWithoutNullStreams | undefined;
    let client: WireClient | undefined;
    try {
      database = await startHostDatabase(container, 'fake-local-bundled-agent');
      const origin = 'http://127.0.0.1:5173';
      child = spawn(process.execPath, [resolve('apps/agent-server/dist/main.js')], {
        // No model/provider credentials enter this no-gateway process.
        env: {
          PATH: process.env.PATH,
          SEEDLANDS_COGNITION_DATABASE_URL: database.connectionString,
          SEEDLANDS_ALLOWED_ORIGINS: origin,
          AGENT_SERVER_PORT: '0',
        },
        stdio: 'pipe',
      });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
        child!.once('exit', (code, signal) => resolve({ code, signal })),
      );
      const ready = await waitForReady(child);
      expect(ready.protocolVersion).toBe(2);
      expect(ready.modelAvailability).toBe('missing-gateway');
      expect(ready.pairingToken.length > 20).toBe(true);
      const endpoint = new URL(ready.url);
      expect(endpoint.hostname).toBe('127.0.0.1');
      client = await WireClient.connect(ready.url, origin);
      client.send({
        kind: 'hello',
        pairingToken: ready.pairingToken,
        world: { worldId: 'bundled-world', epoch: 'bundled-epoch', timelineId: 'bundled-timeline' },
        authoringCapabilities: [],
      });
      expect(await client.wait('ready')).toMatchObject({ kind: 'ready', modelAvailable: false });
      await client.close();
      child.kill('SIGTERM');
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const terminal = await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('SIGTERM did not stop bundled Agent')), 10000);
          }),
        ]);
        expect(terminal).toEqual({ code: 0, signal: null });
      } finally {
        clearTimeout(timeout);
      }
      expect(await portIsClosed(Number(endpoint.port))).toBe(true);
    } finally {
      await client?.close();
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await database?.workspace.close();
      const removed = spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8', timeout: 30000 });
      expect(removed.status, 'Owned bundled Agent PostgreSQL cleanup failed').toBe(0);
    }
  },
  180000,
);
