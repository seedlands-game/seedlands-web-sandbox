import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ResidentBirthPackage, ResidentWorldBinding } from '@seedlands/cognition-protocol';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startResidentServer } from '../../apps/agent-server/src/node/resident-host';
import { validBirth } from '../../apps/agent-server/src/node/resident-host-validation';
import { ResidentFactory } from '../../apps/agent-server/src/resident-factory';
import { WireClient } from './resident-host-fixture';
import { baselineObservation, waitCapabilities } from './fixtures';

const world: ResidentWorldBinding = { worldId: 'isolation-world', timelineId: 'timeline-1', epoch: 'epoch-1' };

function birthPayload(name = '林岚') {
  const character = baselineObservation().character;
  return {
    profile: { name, personality: '谨慎而好奇', riskTolerance: 0.25 },
    agent: '先观察环境，再采取行动。',
    soul: '珍惜同伴并尊重世界规则。',
    memory: '刚来到这里。',
    goal: character.behaviorTree.goal,
    definition: character.behaviorTree.definition,
  };
}

function birthPackage(birthId: string): ResidentBirthPackage {
  return { birthId, ...birthPayload() };
}

type StoredBirth = { tagsHash: string; payload: unknown };
type QueryScope = 'pool' | 'client';

class FakeFactoryPool {
  readonly rows = new Map<string, StoredBirth>();
  connectCount = 0;
  activeTransactions = 0;
  readonly clientQueries: string[] = [];
  queryHook: ((sql: string, scope: QueryScope) => Promise<void>) | undefined;

  private key(parameters: readonly unknown[]): string {
    return JSON.stringify(parameters.slice(0, 3));
  }

  private result<Row extends Record<string, unknown>>(rows: Row[]): QueryResult<Row> {
    return { command: '', rowCount: rows.length, oid: 0, fields: [], rows };
  }

  private async execute<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
    scope: QueryScope,
  ): Promise<QueryResult<Row>> {
    await this.queryHook?.(sql, scope);
    if (sql.includes('SELECT tags_hash,payload')) {
      const stored = this.rows.get(this.key(parameters));
      return this.result(stored ? ([{ tags_hash: stored.tagsHash, payload: stored.payload }] as unknown as Row[]) : []);
    }
    if (sql.includes('SELECT count(*)')) {
      const [worldId, timelineId] = parameters;
      const count = [...this.rows.keys()].filter((key) => {
        const [storedWorld, storedTimeline] = JSON.parse(key) as string[];
        return storedWorld === worldId && storedTimeline === timelineId;
      }).length;
      return this.result([{ count: String(count) }] as unknown as Row[]);
    }
    if (sql.includes('INSERT INTO')) {
      this.rows.set(this.key(parameters), {
        tagsHash: String(parameters[3]),
        payload: JSON.parse(String(parameters[4])),
      });
      return this.result([]);
    }
    return this.result([]);
  }

  readonly query = async <Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>> => this.execute<Row>(sql, parameters, 'pool');

  readonly connect = async (): Promise<PoolClient> => {
    this.connectCount++;
    return {
      query: async <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) => {
        this.clientQueries.push(sql);
        if (sql === 'BEGIN') this.activeTransactions++;
        if (sql === 'COMMIT' || sql === 'ROLLBACK') this.activeTransactions--;
        return this.execute<Row>(sql, parameters, 'client');
      },
      release: () => undefined,
    } as unknown as PoolClient;
  };

  asPool(): Pool {
    return this as unknown as Pool;
  }
}

function model(
  invoke: (options: { signal?: AbortSignal }) => Promise<ReturnType<typeof birthPayload>>,
  onSchema?: (schema: unknown) => void,
): BaseChatModel {
  return {
    withStructuredOutput: (schema: unknown) => {
      onSchema?.(schema);
      return {
        invoke: async (_messages: unknown, options: { signal?: AbortSignal }) => invoke(options),
      };
    },
  } as unknown as BaseChatModel;
}

describe('resident Factory isolation', () => {
  it('keeps the provider schema, Factory validator, and host validator on the same UTF-8 document boundary', async () => {
    const exact = '😀'.repeat(1024);
    const oversized = '😀'.repeat(1025);
    let capturedSchema: unknown;
    const acceptedPool = new FakeFactoryPool();
    const accepted = new ResidentFactory({
      pro: model(
        async () => ({ ...birthPayload(), agent: exact, soul: exact }),
        (schema) => {
          capturedSchema = schema;
        },
      ),
      pool: acceptedPool.asPool(),
    });
    const acceptedBirth = await accepted.generate(world, 'exact-documents', ['quiet'], waitCapabilities());
    expect(acceptedBirth).toMatchObject({
      birthId: 'exact-documents',
      agent: exact,
      soul: exact,
    });
    expect(validBirth(acceptedBirth)).toBe(true);
    expect(capturedSchema).toMatchObject({
      properties: {
        agent: { maxLength: 1024, pattern: '\\S' },
        soul: { maxLength: 1024, pattern: '\\S' },
        memory: { pattern: '\\S' },
        goal: { properties: { description: { pattern: '\\S' } } },
      },
    });

    for (const field of ['agent', 'soul'] as const) {
      const rejectedPool = new FakeFactoryPool();
      const payload = { ...birthPayload(), [field]: oversized };
      const rejected = new ResidentFactory({
        pro: model(async () => payload),
        pool: rejectedPool.asPool(),
      });
      await expect(rejected.generate(world, `oversized-${field}`, ['quiet'], waitCapabilities())).rejects.toMatchObject(
        {
          name: 'ResidentBirthValidationError',
          field,
          reason: 'utf8-bytes',
          actualBytes: 4100,
          maximumBytes: 4096,
        },
      );
      expect(validBirth({ birthId: `oversized-${field}`, ...payload })).toBe(false);
    }
  });

  it('rejects blank required documents in both the Factory and host without echoing their contents', async () => {
    const cases = [
      { field: 'agent', payload: { ...birthPayload(), agent: '   ' }, maximumBytes: 4096 },
      { field: 'soul', payload: { ...birthPayload(), soul: '   ' }, maximumBytes: 4096 },
      { field: 'memory', payload: { ...birthPayload(), memory: '   ' }, maximumBytes: 16 * 1024 },
      {
        field: 'goal.description',
        payload: { ...birthPayload(), goal: { description: '   ' } },
        maximumBytes: 8 * 1024,
      },
    ];
    for (const entry of cases) {
      const pool = new FakeFactoryPool();
      const factory = new ResidentFactory({
        pro: model(async () => entry.payload),
        pool: pool.asPool(),
      });
      const failure: unknown = await factory
        .generate(world, `blank-${entry.field}`, ['quiet'], waitCapabilities())
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        name: 'ResidentBirthValidationError',
        field: entry.field,
        reason: 'blank',
        actualBytes: 3,
        maximumBytes: entry.maximumBytes,
      });
      expect((failure as Error).message).not.toContain('   ');
      expect(validBirth({ birthId: `blank-${entry.field}`, ...entry.payload })).toBe(false);
    }
  });

  it('does not hold a transaction while Pro hangs and aborts when its caller leaves', async () => {
    const pool = new FakeFactoryPool();
    let modelSignal: AbortSignal | undefined;
    let resolveLate!: (value: ReturnType<typeof birthPayload>) => void;
    const pro = model(
      (options) =>
        new Promise((resolve) => {
          modelSignal = options.signal;
          resolveLate = resolve;
        }),
    );
    const factory = new ResidentFactory({ pro, pool: pool.asPool(), modelTimeoutMs: 1_000 });
    const caller = new AbortController();
    const generated = factory.generate(world, 'hanging-birth', ['quiet'], waitCapabilities(), caller.signal);
    await vi.waitFor(() => expect(modelSignal).toBeDefined());
    expect(pool.connectCount).toBe(0);
    expect(pool.activeTransactions).toBe(0);
    caller.abort(new Error('socket disposed'));
    await expect(generated).rejects.toThrow('socket disposed');
    expect(modelSignal?.aborted).toBe(true);
    resolveLate(birthPayload('迟到居民'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pool.connectCount).toBe(0);
    expect(pool.rows.size).toBe(0);
  });

  it('bounds an uncooperative model and coalesces concurrent idempotent requests', async () => {
    const timedPool = new FakeFactoryPool();
    let resolveLate!: (value: ReturnType<typeof birthPayload>) => void;
    const timed = new ResidentFactory({
      pro: model(
        () =>
          new Promise((resolve) => {
            resolveLate = resolve;
          }),
      ),
      pool: timedPool.asPool(),
      modelTimeoutMs: 10,
    });
    await expect(timed.generate(world, 'timeout', ['quiet'], waitCapabilities())).rejects.toThrow('timed out');
    resolveLate(birthPayload('迟到居民'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timedPool.connectCount).toBe(0);
    expect(timedPool.rows.size).toBe(0);

    const pool = new FakeFactoryPool();
    let calls = 0;
    const factory = new ResidentFactory({
      pro: model(async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return birthPayload();
      }),
      pool: pool.asPool(),
      modelTimeoutMs: 1_000,
    });
    const [first, duplicate] = await Promise.all([
      factory.generate(world, 'same-birth', ['quiet'], waitCapabilities()),
      factory.generate(world, 'same-birth', ['quiet'], waitCapabilities()),
    ]);
    expect(duplicate).toEqual(first);
    expect(calls).toBe(1);
    expect(pool.connectCount).toBe(1);
    expect(pool.activeTransactions).toBe(0);
    await expect(factory.generate(world, 'same-birth', ['different'], waitCapabilities())).rejects.toThrow(
      'payload conflict',
    );
    expect(calls).toBe(1);
  });

  it('claims an identity before asynchronous preflight can outlive a completed duplicate', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array(32).buffer as ArrayBuffer);
    const pool = new FakeFactoryPool();
    let releaseSecondCount!: () => void;
    const secondCountBlocked = new Promise<void>((resolve) => {
      releaseSecondCount = resolve;
    });
    let countQueries = 0;
    pool.queryHook = async (sql, scope) => {
      if (scope !== 'pool' || !sql.includes('SELECT count(*)') || ++countQueries !== 2) return;
      await secondCountBlocked;
    };
    let calls = 0;
    const factory = new ResidentFactory({
      pro: model(async () => {
        calls++;
        return birthPayload();
      }),
      pool: pool.asPool(),
    });
    try {
      const first = factory.generate(world, 'preflight-race', ['quiet'], waitCapabilities());
      const duplicate = factory.generate(world, 'preflight-race', ['quiet'], waitCapabilities());
      await expect(Promise.race([first, duplicate])).resolves.toMatchObject({ birthId: 'preflight-race' });
      releaseSecondCount();
      await expect(Promise.all([first, duplicate])).resolves.toHaveLength(2);
      expect(calls).toBe(1);
      expect(countQueries).toBe(1);
    } finally {
      digest.mockRestore();
    }
  });

  it('rejects an exhausted timeline before calling Pro', async () => {
    const pool = new FakeFactoryPool();
    for (let index = 0; index < 64; index++) {
      pool.rows.set(JSON.stringify([world.worldId, world.timelineId, `existing-${index}`]), {
        tagsHash: `hash-${index}`,
        payload: birthPackage(`existing-${index}`),
      });
    }
    let calls = 0;
    const factory = new ResidentFactory({
      pro: model(async () => {
        calls++;
        return birthPayload();
      }),
      pool: pool.asPool(),
    });
    await expect(factory.generate(world, 'overflow', ['quiet'], waitCapabilities())).rejects.toThrow('budget exceeded');
    expect(calls).toBe(0);
    expect(pool.connectCount).toBe(0);
  });

  it('does not start Pro when close races an unfinished database preflight', async () => {
    const pool = new FakeFactoryPool();
    let releaseRead!: () => void;
    const readBlocked = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let reading = false;
    pool.queryHook = async (sql) => {
      if (!sql.includes('SELECT tags_hash,payload')) return;
      reading = true;
      await readBlocked;
    };
    let calls = 0;
    const factory = new ResidentFactory({
      pro: model(async () => {
        calls++;
        return birthPayload();
      }),
      pool: pool.asPool(),
    });
    const generated = factory.generate(world, 'close-race', ['quiet'], waitCapabilities());
    await vi.waitFor(() => expect(reading).toBe(true));
    const closing = factory.close();
    releaseRead();
    await expect(generated).rejects.toThrow('closed');
    await closing;
    expect(calls).toBe(0);
    expect(pool.connectCount).toBe(0);
  });

  it('rolls back without locking or inserting when close races BEGIN I/O', async () => {
    const pool = new FakeFactoryPool();
    let releaseBegin!: () => void;
    const beginBlocked = new Promise<void>((resolve) => {
      releaseBegin = resolve;
    });
    let began = false;
    pool.queryHook = async (sql) => {
      if (sql !== 'BEGIN') return;
      began = true;
      await beginBlocked;
    };
    const factory = new ResidentFactory({
      pro: model(async () => birthPayload()),
      pool: pool.asPool(),
    });
    const generated = factory.generate(world, 'begin-race', ['quiet'], waitCapabilities());
    await vi.waitFor(() => expect(began).toBe(true));
    expect(pool.activeTransactions).toBe(1);
    const closing = factory.close();
    releaseBegin();
    await expect(generated).rejects.toThrow('closed');
    await closing;
    expect(pool.clientQueries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(pool.activeTransactions).toBe(0);
    expect(pool.rows.size).toBe(0);
  });
});

describe('resident host birth isolation', () => {
  const handles: Awaited<ReturnType<typeof startResidentServer>>[] = [];
  const origin = 'http://127.0.0.1:5173';

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  it('keeps ordinary messages and another birth moving, then aborts the hanging birth on socket close', async () => {
    const hangingSignals = new Map<string, AbortSignal | undefined>();
    const calls = new Map<string, number>();
    const factory = {
      generate: async (
        _world: ResidentWorldBinding,
        birthId: string,
        _tags: readonly string[],
        _capabilities: unknown,
        signal?: AbortSignal,
      ) => {
        calls.set(birthId, (calls.get(birthId) ?? 0) + 1);
        if (!birthId.startsWith('hanging')) return birthPackage(birthId);
        return await new Promise<ResidentBirthPackage>((_resolve, reject) => {
          hangingSignals.set(birthId, signal);
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    } as ResidentFactory;
    const handle = await startResidentServer({
      workspace: {} as never,
      framework: {} as never,
      flash: null,
      pro: null,
      factory,
      allowedOrigins: [origin],
      pairingToken: 'factory-isolation-token',
    });
    handles.push(handle);
    const client = await WireClient.connect(handle.url, origin);
    client.send({
      kind: 'hello',
      pairingToken: handle.pairingToken,
      world,
      authoringCapabilities: waitCapabilities(),
    });
    await client.wait('ready');
    client.send({ kind: 'birth', requestId: 'hanging', tags: ['quiet'] });
    await vi.waitFor(() => expect(hangingSignals.get('hanging')).toBeDefined());
    client.send({ kind: 'birth', requestId: 'hanging', tags: ['quiet'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.get('hanging')).toBe(1);
    client.send({ kind: 'checkpoint-read', requestId: 'independent', transferId: 'missing', part: 0 });
    await expect(client.wait('error')).resolves.toMatchObject({
      code: 'CHECKPOINT_UNAVAILABLE',
      requestId: 'independent',
    });
    client.send({ kind: 'birth', requestId: 'other-resident', tags: ['forager'] });
    await expect(client.wait('birth-package')).resolves.toMatchObject({
      requestId: 'other-resident',
      birth: { birthId: 'other-resident' },
    });
    client.send({ kind: 'birth', requestId: 'hanging-2', tags: ['builder'] });
    client.send({ kind: 'birth', requestId: 'hanging-3', tags: ['scout'] });
    await vi.waitFor(() => expect(hangingSignals.size).toBe(3));
    client.send({ kind: 'birth', requestId: 'overflow', tags: ['farmer'] });
    await expect(client.wait('error')).resolves.toMatchObject({
      code: 'FACTORY_UNAVAILABLE',
      requestId: 'overflow',
    });
    await client.close();
    await vi.waitFor(() => expect([...hangingSignals.values()].every((signal) => signal?.aborted)).toBe(true));
  });
});
