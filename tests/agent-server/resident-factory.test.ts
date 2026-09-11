import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ResidentFactory } from '../../apps/agent-server/src/resident-factory';
import type { ResidentWorldBinding } from '@seedlands/cognition-protocol';

const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const describePostgres = dockerAvailable ? describe : describe.skip;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return typeof address === 'object' && address ? address.port : 0;
}

const world = (timelineId = 'timeline-1'): ResidentWorldBinding => ({
  worldId: 'world-1',
  timelineId,
  epoch: 'epoch-1',
});
const definition = {
  version: 1,
  root: { id: 'root', type: 'action', skill: 'wait', args: { seconds: 1 } },
};

describePostgres('resident birth Factory', () => {
  const containerName = `seedlands-resident-factory-${process.pid}`;
  const password = 'fake-local-factory-password';
  let connectionString = '';
  let factory: ResidentFactory;
  const calls = vi.fn();

  beforeAll(async () => {
    const port = await freePort();
    connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/resident_factory_test`;
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
        'POSTGRES_DB=resident_factory_test',
        '-p',
        `127.0.0.1:${port}:5432`,
        'postgres:16-alpine',
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (started.status !== 0) throw new Error(`owned PostgreSQL failed to start: ${started.stderr}`);
    const pro = {
      withStructuredOutput: () => ({
        invoke: async () => {
          calls();
          return {
            profile: { name: '阿苇', personality: '谨慎、好奇', background: '住在林边', riskTolerance: 0.25 },
            agent: '偏爱在行动前观察天气，并用简短中文表达。',
            soul: '珍惜同伴，也尊重世界规则。',
            memory: '刚来到这里，还没有经历过事件。',
            goal: { description: '在家附近生活并寻找食物' },
            definition,
          };
        },
      }),
    } as unknown as BaseChatModel;
    factory = ResidentFactory.open({ pro, connectionString, schema: 'factory_test' });
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await factory.setup();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error('owned PostgreSQL did not become ready');
  }, 150_000);

  afterAll(async () => {
    await factory?.close();
    spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
  });

  it('serializes concurrent duplicate activation and scopes birth ids to the trusted timeline', async () => {
    const [first, replay] = await Promise.all([
      factory.generate(world(), 'birth-1', ['forager', 'quiet'], [{ name: 'wait' }]),
      factory.generate(world(), 'birth-1', ['forager', 'quiet'], [{ name: 'wait' }]),
    ]);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ birthId: 'birth-1', agent: expect.stringContaining('天气') });
    expect(calls).toHaveBeenCalledTimes(1);
    await expect(factory.generate(world(), 'birth-1', ['different'], [{ name: 'wait' }])).rejects.toThrow(
      'payload conflict',
    );
    expect(calls).toHaveBeenCalledTimes(1);
    await expect(
      factory.generate(world('timeline-2'), 'birth-1', ['forager', 'quiet'], [{ name: 'wait' }]),
    ).resolves.toMatchObject({ birthId: 'birth-1' });
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('enforces the per-timeline budget before invoking Pro', async () => {
    const timeline = world('full-timeline');
    for (let index = 0; index < 64; index++) {
      const birth = await factory.generate(timeline, `reserved-${index}`, ['resident'], [{ name: 'wait' }]);
      expect(birth.birthId).toBe(`reserved-${index}`);
    }
    const before = calls.mock.calls.length;
    await expect(factory.generate(timeline, 'overflow', ['resident'], [{ name: 'wait' }])).rejects.toThrow(
      'budget exceeded',
    );
    expect(calls).toHaveBeenCalledTimes(before);
  }, 30_000);
});
