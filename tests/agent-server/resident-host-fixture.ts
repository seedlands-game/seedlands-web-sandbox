import { spawnSync } from 'node:child_process';
import { PersistentNpcWorkspace } from '../../apps/agent-server/src/workspace';
import { createServer } from 'node:net';
import { ResidentServerWebSocketClient } from '../../apps/agent-server/src/node/resident-host';
import { baselineObservation, binding as makeBinding } from './fixtures';
import type { CharacterObservation, ControlBinding } from '@seedlands/game-core/runtime/character-control-protocol';
import type { ResidentHostMessage } from '@seedlands/cognition-protocol';

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return typeof address === 'object' && address ? address.port : 0;
}

export class WireClient {
  readonly socket: InstanceType<typeof ResidentServerWebSocketClient>;
  private sequence = 0;
  private readonly messages: ResidentHostMessage[] = [];
  private readonly listeners = new Set<() => void>();

  private constructor(socket: InstanceType<typeof ResidentServerWebSocketClient>) {
    this.socket = socket;
    socket.on('message', (raw) => {
      this.messages.push(JSON.parse(raw.toString()) as ResidentHostMessage);
      for (const listener of this.listeners) listener();
    });
  }

  static async connect(url: string, origin: string): Promise<WireClient> {
    const socket = new ResidentServerWebSocketClient(url, { origin });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new WireClient(socket);
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ protocolVersion: 2, sequence: this.sequence++, ...message }));
  }

  async wait(kind: ResidentHostMessage['kind'], predicate: (message: ResidentHostMessage) => boolean = () => true) {
    const take = () => {
      const index = this.messages.findIndex((message) => message.kind === kind && predicate(message));
      return index < 0 ? undefined : this.messages.splice(index, 1)[0];
    };
    const existing = take();
    if (existing) return existing;
    return await new Promise<ResidentHostMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error(`timed out waiting for ${kind}: ${JSON.stringify(this.messages)}`));
      }, 10_000);
      const check = () => {
        const message = take();
        if (!message) return;
        clearTimeout(timeout);
        this.listeners.delete(check);
        resolve(message);
      };
      this.listeners.add(check);
    });
  }

  async close(): Promise<void> {
    if (this.socket.readyState >= this.socket.CLOSING) return;
    const closed = new Promise<void>((resolve) => this.socket.once('close', () => resolve()));
    this.socket.close();
    await closed;
  }
}

export function actor(
  index: number,
  epoch = 'epoch-1',
): { binding: ControlBinding; observation: CharacterObservation } {
  const entityId = `resident-${index}`;
  const incarnation = `life-${index}`;
  const binding = makeBinding({ sessionId: `channel-${index}`, epoch, entityId, incarnation });
  const current = baselineObservation();
  return {
    binding,
    observation: {
      ...current,
      character: {
        ...current.character,
        entityId,
        incarnation,
        profile: { ...current.character.profile, name: `居民${index}` },
      },
    },
  };
}

export async function startHostDatabase(containerName: string, password: string) {
  const port = await freePort();
  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/resident_host_test`;
  const started = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '--name',
      containerName,
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=resident_host_test',
      '-p',
      `127.0.0.1:${port}:5432`,
      'postgres:16-alpine',
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (started.status !== 0) throw new Error(`owned PostgreSQL failed to start: ${started.stderr}`);
  const workspace = PersistentNpcWorkspace.open({ connectionString, schema: 'resident_host_workspace' });
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await workspace.setup();
        break;
      } catch {
        if (attempt === 59) throw new Error('owned PostgreSQL did not become ready');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  } catch (error) {
    await workspace.close().catch(() => undefined);
    throw error;
  }
  return { workspace, connectionString };
}
