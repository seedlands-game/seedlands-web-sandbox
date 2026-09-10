import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createGatewayChatModel } from '../../../apps/agent-server/src/gateway-model';
import { ResidentFactory } from '../../../apps/agent-server/src/resident-factory';
import { startResidentServer } from '../../../apps/agent-server/src/node/resident-host';
import { PersistentNpcWorkspace, createPostgresFrameworkPersistence } from '../../../apps/agent-server/src/workspace';
import type { CharacterObservation } from '@seedlands/game-core/runtime/character-control-protocol';

export async function startBrowserResidentFixture(origin: string, real = false, maximumFlashCalls = 6) {
  if (![6, 18].includes(maximumFlashCalls)) throw new Error('Unapproved real-model fixture budget');
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('port unavailable');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const container = `seedlands-resident-browser-${process.pid}`;
  const started = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '--name',
      container,
      '-e',
      'POSTGRES_PASSWORD=local-browser-fixture',
      '-e',
      'POSTGRES_DB=resident',
      '-p',
      `127.0.0.1:${port}:5432`,
      'postgres:16-alpine',
    ],
    { encoding: 'utf8', timeout: 120000 },
  );
  if (started.status !== 0) throw new Error('Browser fixture PostgreSQL failed to start');
  const resources: (() => Promise<void>)[] = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    for (const release of resources.reverse()) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    const removed = spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8', timeout: 30000 });
    if (removed.status !== 0) failures.push(new Error('Browser fixture PostgreSQL cleanup failed'));
    if (failures.length) throw new AggregateError(failures, 'Browser resident fixture cleanup failed');
  };
  try {
    const connectionString = `postgresql://postgres:local-browser-fixture@127.0.0.1:${port}/resident`;
    const workspace = PersistentNpcWorkspace.open({ connectionString });
    resources.push(() => workspace.close());
    for (let attempt = 0; ; attempt++) {
      try {
        await workspace.pool.query('SELECT 1');
        break;
      } catch (error) {
        if (attempt >= 60) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    await workspace.setup();
    const framework = await createPostgresFrameworkPersistence(connectionString);
    resources.push(() => framework.close());
    const calls: { actorId: string; startedAt: number; finishedAt?: number; kind: string; request: unknown }[] = [];
    const flash = createGatewayChatModel({
      tier: 'flash',
      baseUrl: real ? process.env.SEEDLANDS_MODEL_GATEWAY_URL! : 'http://127.0.0.1:9/v1',
      apiKey: real ? process.env.SEEDLANDS_MODEL_GATEWAY_TOKEN! : 'fake-fixture',
      timeoutMs: 65000,
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
        const last = request.messages.at(-1);
        const observation = request.messages
          .filter((entry) => entry.role === 'user')
          .map((entry) => {
            try {
              return (JSON.parse(entry.content) as { observation?: CharacterObservation }).observation;
            } catch {
              return undefined;
            }
          })
          .filter(Boolean)
          .at(-1)!;
        if (!observation) throw new Error('Model did not receive a complete current observation');
        const actorId = observation.character.entityId;
        const call = {
          actorId,
          startedAt: Date.now(),
          finishedAt: undefined as number | undefined,
          kind: last?.role === 'tool' ? 'complete' : 'decision',
          request,
        };
        if (real && calls.length >= maximumFlashCalls) throw new Error('Real Flash validation budget exhausted');
        calls.push(call);
        if (real) {
          const result = await globalThis.fetch(_url, init);
          call.finishedAt = Date.now();
          return result;
        }
        const identity = `${actorId}-${calls.length}`;
        const tree = observation.character.behaviorTree;
        const toolCalls =
          last?.role === 'tool'
            ? undefined
            : [
                {
                  id: `say-${identity}`,
                  type: 'function',
                  function: {
                    name: 'speak',
                    arguments: JSON.stringify({
                      requestId: `speech-${identity}`,
                      text: `${observation.character.profile.name}：我会照看营地，饿了先去找吃的。`,
                    }),
                  },
                },
                {
                  id: `plan-${identity}`,
                  type: 'function',
                  function: {
                    name: 'propose_behavior_update',
                    arguments: JSON.stringify({
                      expectedBehaviorRevision: tree.revision,
                      goal: { ...tree.goal, description: `${observation.character.profile.name}照看营地并保持补给` },
                      definition: tree.definition,
                    }),
                  },
                },
              ];
        await new Promise((resolve) => setTimeout(resolve, actorId === calls[0]?.actorId ? 600 : 30));
        call.finishedAt = Date.now();
        return new Response(
          JSON.stringify({
            id: identity,
            model: 'deterministic-browser-fixture',
            choices: [
              {
                index: 0,
                finish_reason: toolCalls ? 'tool_calls' : 'stop',
                message: { role: 'assistant', content: toolCalls ? '' : '继续执行当前计划。', tool_calls: toolCalls },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const proCalls: Record<string, unknown>[] = [];
    const pro = createGatewayChatModel({
      tier: 'pro',
      baseUrl: real ? process.env.SEEDLANDS_MODEL_GATEWAY_URL! : 'http://127.0.0.1:9/v1',
      apiKey: real ? process.env.SEEDLANDS_MODEL_GATEWAY_TOKEN! : 'fake-fixture',
      timeoutMs: 305000,
      fetch: async (url, init) => {
        if (!real) throw new Error('Mock fixture does not authorize Pro compaction');
        if (proCalls.length >= 4) throw new Error('Real Pro validation budget exhausted');
        const record: Record<string, unknown> = { request: JSON.parse(String(init?.body)) };
        proCalls.push(record);
        const response = await globalThis.fetch(url, init);
        const output = await response.clone().json();
        record.response = {
          status: response.status,
          usage: output.usage,
          finishReason: output.choices?.[0]?.finish_reason,
          toolCount: output.choices?.[0]?.message?.tool_calls?.length ?? 0,
          contentLength: output.choices?.[0]?.message?.content?.length ?? 0,
          reasoningLength: output.choices?.[0]?.message?.reasoning_content?.length ?? 0,
        };
        return response;
      },
    });
    const factory = ResidentFactory.open({ pro, connectionString });
    resources.push(() => factory.close());
    await factory.setup();
    const host = await startResidentServer({
      workspace,
      framework,
      flash,
      pro,
      factory,
      allowedOrigins: [origin],
      port: 0,
    });
    resources.push(() => host.close());
    return {
      host,
      workspace,
      calls,
      proCalls,
      pro,
      flash,
      factory,
      framework,
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Browser resident fixture setup and cleanup failed', {
        cause: cleanupError,
      });
    }
    throw error;
  }
}
