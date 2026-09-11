import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ResidentFactory } from '../../apps/agent-server/src/resident-factory';
import { startHostDatabase } from './resident-host-fixture';
import { baselineObservation, waitCapabilities } from './fixtures';

const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const describePostgres = dockerAvailable ? describe : describe.skip;

function payload() {
  const character = baselineObservation().character;
  return {
    profile: { name: '林岚', personality: '谨慎而好奇', riskTolerance: 0.25 },
    agent: '先观察环境，再采取行动。',
    soul: '珍惜同伴并尊重世界规则。',
    memory: '刚来到这里。',
    goal: character.behaviorTree.goal,
    definition: character.behaviorTree.definition,
  };
}

describePostgres('resident Factory PostgreSQL isolation', () => {
  it('holds no transaction or advisory lock while Pro hangs, then permits a clean retry after abort', async () => {
    const container = `seedlands-resident-factory-isolation-${process.pid}`;
    const database = await startHostDatabase(container, 'fake-factory-isolation-password');
    const factoryUrl = new URL(database.connectionString);
    factoryUrl.searchParams.set('application_name', 'resident_factory_isolation');
    const observer = new Pool({ connectionString: database.connectionString });
    let resolveLate!: (value: ReturnType<typeof payload>) => void;
    let hangingSignal: AbortSignal | undefined;
    let calls = 0;
    const pro = {
      withStructuredOutput: () => ({
        invoke: async (_messages: unknown, options: { signal?: AbortSignal }) => {
          calls++;
          if (calls > 1) return payload();
          hangingSignal = options.signal;
          return await new Promise<ReturnType<typeof payload>>((resolve) => {
            resolveLate = resolve;
          });
        },
      }),
    } as unknown as BaseChatModel;
    const factory = ResidentFactory.open({
      pro,
      connectionString: factoryUrl.toString(),
      schema: 'factory_pg_isolation',
      modelTimeoutMs: 5_000,
    });
    try {
      await factory.setup();
      const caller = new AbortController();
      const generated = factory.generate(
        { worldId: 'pg-world', timelineId: 'pg-timeline', epoch: 'pg-epoch' },
        'pg-hanging-birth',
        ['quiet'],
        waitCapabilities(),
        caller.signal,
      );
      await vi.waitFor(() => expect(hangingSignal).toBeDefined());
      await expect(observer.query('SELECT 1 AS available')).resolves.toMatchObject({ rows: [{ available: 1 }] });
      const activity = await observer.query<{ state: string }>(
        `SELECT state FROM pg_stat_activity WHERE application_name='resident_factory_isolation'`,
      );
      expect(activity.rows.every((row) => row.state !== 'idle in transaction')).toBe(true);
      const locks = await observer.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_locks locks
         JOIN pg_stat_activity activity ON activity.pid=locks.pid
         WHERE activity.application_name='resident_factory_isolation' AND locks.locktype='advisory'`,
      );
      expect(locks.rows[0]?.count).toBe('0');

      caller.abort(new Error('socket disposed'));
      await expect(generated).rejects.toThrow('socket disposed');
      resolveLate(payload());
      await new Promise((resolve) => setTimeout(resolve, 0));
      await expect(
        observer.query(`SELECT count(*)::text AS count FROM factory_pg_isolation.birth_packages`),
      ).resolves.toMatchObject({ rows: [{ count: '0' }] });

      await expect(
        factory.generate(
          { worldId: 'pg-world', timelineId: 'pg-timeline', epoch: 'pg-epoch' },
          'pg-hanging-birth',
          ['quiet'],
          waitCapabilities(),
        ),
      ).resolves.toMatchObject({ birthId: 'pg-hanging-birth' });
      await expect(
        observer.query(`SELECT count(*)::text AS count FROM factory_pg_isolation.birth_packages`),
      ).resolves.toMatchObject({ rows: [{ count: '1' }] });
    } finally {
      await factory.close();
      await observer.end();
      await database.workspace.close();
      spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
    }
  }, 150_000);
});
