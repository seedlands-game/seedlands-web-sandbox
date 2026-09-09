import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage } from '../../apps/agent-server/src/resident-agent';
import { createGatewayChatModel } from '../../apps/agent-server/src/gateway-model';
import { startResidentServer } from '../../apps/agent-server/src/node/resident-host';
import { ResidentFactory } from '../../apps/agent-server/src/resident-factory';
import {
  createPostgresFrameworkPersistence,
  PersistentNpcWorkspace,
  type WorkspaceBinding,
} from '../../apps/agent-server/src/workspace';
import { baselineObservation, event } from './fixtures';
import { actor, startHostDatabase, WireClient } from './resident-host-fixture';
import type { ResidentHostMessage, ResidentWorldBinding } from '@seedlands/cognition-protocol';

const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const describePostgres = dockerAvailable ? describe : describe.skip;

describePostgres('resident v2 host with actual WebSocket and PostgreSQL', () => {
  const containerName = `seedlands-resident-host-${process.pid}`;
  const password = 'fake-local-resident-password';
  const origin = 'http://127.0.0.1:5173';
  const token = 'fake-local-pairing-token';
  let workspace: PersistentNpcWorkspace;
  let framework: Awaited<ReturnType<typeof createPostgresFrameworkPersistence>>;
  let handle: Awaited<ReturnType<typeof startResidentServer>>;
  let factory: ResidentFactory;
  let connectionString = '';
  let client: WireClient | null = null;
  let modelCalls = 0;
  let birthCalls = 0;
  let blockNextModel = false;
  let blockedMessages: unknown[] = [];
  let modelAbortCount = 0;

  beforeAll(async () => {
    ({ workspace, connectionString } = await startHostDatabase(containerName, password));
    framework = await createPostgresFrameworkPersistence(connectionString, {
      checkpointSchema: 'resident_host_checkpoint',
    });
    const model = createGatewayChatModel({
      tier: 'flash',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-local',
      fetch: async (_input, init) => {
        modelCalls++;
        if (blockNextModel) {
          blockedMessages = JSON.parse(String(init?.body)).messages;
          blockNextModel = false;
          await new Promise<never>((_resolve, reject) => {
            const abort = () => {
              modelAbortCount++;
              reject(new Error('fixture model aborted'));
            };
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener('abort', abort, { once: true });
          });
        }
        return new Response(
          JSON.stringify({
            id: `host-fake-${modelCalls}`,
            model: 'flash',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '继续生活。' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const birthModel = {
      withStructuredOutput: () => ({
        invoke: async () => {
          birthCalls++;
          const current = baselineObservation().character;
          return {
            profile: { name: '新居民', personality: '稳重好奇', riskTolerance: 0.3 },
            agent: '喜欢先观察再行动。',
            soul: '尊重同伴。',
            memory: '刚来到世界。',
            goal: current.behaviorTree.goal,
            definition: current.behaviorTree.definition,
          };
        },
      }),
    } as unknown as BaseChatModel;
    factory = ResidentFactory.open({ pro: birthModel, connectionString, schema: 'resident_host_factory' });
    await factory.setup();
    handle = await startResidentServer({
      workspace,
      framework,
      flash: model,
      pro: model,
      factory,
      allowedOrigins: [origin],
      pairingToken: token,
      transferTtlMs: 30_000,
    });
  }, 150_000);

  afterAll(async () => {
    await client?.close();
    await handle?.close();
    await factory?.close();
    await framework?.close();
    await workspace?.close();
    spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
  });

  it('isolates three channels, survives a bad actor frame, and restores portable cognition into a new timeline', async () => {
    const source: ResidentWorldBinding = { worldId: 'world-1', timelineId: 'timeline-1', epoch: 'epoch-1' };
    client = await WireClient.connect(handle.url, origin);
    const capabilities = [{ kind: 'skill', name: 'wait', description: 'Wait in place.', arguments: {} }] as const;
    client.send({ kind: 'hello', pairingToken: token, world: source, capabilities });
    await expect(client.wait('ready')).resolves.toMatchObject({ kind: 'ready', world: source, modelAvailable: true });
    client.send({ kind: 'birth', requestId: 'birth-before-actor', tags: ['forager'] });
    await expect(client.wait('birth-package')).resolves.toMatchObject({
      kind: 'birth-package',
      requestId: 'birth-before-actor',
      birth: { birthId: 'birth-before-actor' },
    });
    client.send({ kind: 'birth', requestId: 'birth-before-actor', tags: ['forager'] });
    await client.wait('birth-package');
    expect(birthCalls).toBe(1);
    const actors = [actor(1), actor(2), actor(3)];
    for (const current of actors) {
      client.send({ kind: 'bind', ...current, capabilities });
      await expect(
        client.wait('bound', (message) => 'channelId' in message && message.channelId === current.binding.sessionId),
      ).resolves.toMatchObject({ kind: 'bound', channelId: current.binding.sessionId });
    }
    for (const current of actors) {
      const identity: WorkspaceBinding = {
        worldId: source.worldId,
        timelineId: source.timelineId,
        actorId: current.binding.entityId,
        incarnation: current.binding.incarnation,
      };
      const agent = await workspace.readFile(identity, '/AGENT.md', 'resident');
      expect(agent.content).toContain('Wait in place.');
      expect(agent.content).toContain(current.observation.character.profile.name);
    }

    const invalid = actor(1).observation;
    client.send({
      kind: 'observe',
      channelId: 'channel-1',
      observation: {
        ...invalid,
        character: { ...invalid.character, entityId: 'resident-2' },
      },
    });
    await expect(client.wait('error')).resolves.toMatchObject({
      kind: 'error',
      code: 'BAD_CHANNEL_FRAME',
      channelId: 'channel-1',
    });
    client.send({ kind: 'workspace-read', channelId: 'channel-2', requestId: 'read-b', path: '/SOUL.md' });
    await expect(client.wait('workspace-result')).resolves.toMatchObject({
      kind: 'workspace-result',
      channelId: 'channel-2',
      requestId: 'read-b',
    });
    client.send({ kind: 'receipt', channelId: 'channel-3', requestId: 'not-pending', result: { ok: true, value: {} } });
    await expect(client.wait('error')).resolves.toMatchObject({
      kind: 'error',
      code: 'STALE_RECEIPT',
      channelId: 'channel-3',
    });
    const changed = actors[1]!.observation;
    client.send({
      kind: 'observe',
      channelId: 'channel-2',
      observation: {
        ...changed,
        character: { ...changed.character, eventCursor: 1 },
        events: [{ ...event(1, 'rejudge-requested'), nodeId: 'dialogue-monitor', episode: 1, reason: 'new dialogue' }],
        cursor: 1,
        eventCoverage: { requestedAfter: 0, through: 1, returnedThrough: 1, hasMore: false },
      },
    });
    await expect(
      client.wait(
        'status',
        (message) =>
          message.kind === 'status' && message.channelId === 'channel-2' && message.status.logicalRounds >= 1,
      ),
    ).resolves.toMatchObject({ kind: 'status', channelId: 'channel-2' });
    await client.wait(
      'status',
      (message) =>
        message.kind === 'status' &&
        message.channelId === 'channel-2' &&
        message.status.logicalRounds === 1 &&
        message.status.phase === 'living',
    );
    expect(modelCalls).toBeGreaterThanOrEqual(1);

    client.send({ kind: 'clock', paused: true });
    client.send({ kind: 'checkpoint-export', requestId: 'export-1' });
    const ready = (await client.wait('checkpoint-ready')) as Extract<ResidentHostMessage, { kind: 'checkpoint-ready' }>;
    const chunks: string[] = [];
    for (let part = 0; part < ready.parts; part++) {
      client.send({ kind: 'checkpoint-read', requestId: `read-${part}`, transferId: ready.transferId, part });
      const item = (await client.wait('checkpoint-part')) as Extract<ResidentHostMessage, { kind: 'checkpoint-part' }>;
      chunks[part] = item.content;
    }
    const portableBytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, 'base64')));
    expect(portableBytes.byteLength).toBe(ready.byteLength);
    expect(createHash('sha256').update(portableBytes).digest('hex')).toBe(ready.sha256);
    expect((JSON.parse(portableBytes.toString('utf8')) as { workspaces: unknown[] }).workspaces).toHaveLength(3);
    const sourceIdentity: WorkspaceBinding = {
      worldId: source.worldId,
      timelineId: source.timelineId,
      actorId: actors[1]!.binding.entityId,
      incarnation: actors[1]!.binding.incarnation,
    };
    await workspace.appendMessages(sourceIdentity, [
      { idempotencyKey: 'future-after-export', message: new HumanMessage('future') },
    ]);
    await client.close();
    client = null;

    const target: ResidentWorldBinding = { worldId: source.worldId, timelineId: 'timeline-2', epoch: 'epoch-2' };
    client = await WireClient.connect(handle.url, origin);
    client.send({ kind: 'hello', pairingToken: token, world: target, capabilities });
    await client.wait('ready');
    client.send({ kind: 'clock', paused: true });
    const importId = 'import-1';
    for (let part = 0; part < chunks.length; part++) {
      client.send({
        kind: 'checkpoint-import',
        requestId: `import-${part}`,
        transferId: importId,
        part,
        parts: chunks.length,
        content: chunks[part],
        sha256: ready.sha256,
      });
      const imported = (await client.wait('checkpoint-imported')) as Extract<
        ResidentHostMessage,
        { kind: 'checkpoint-imported' }
      >;
      expect(imported.complete).toBe(part === chunks.length - 1);
    }
    const targetIdentity: WorkspaceBinding = { ...sourceIdentity, timelineId: target.timelineId };
    const targetJournal = await workspace.getJournal(targetIdentity);
    expect(targetJournal.some((entry) => JSON.stringify(entry).includes('future-after-export'))).toBe(false);
    expect(targetJournal.some((entry) => JSON.stringify(entry).includes('future'))).toBe(false);
    await expect(workspace.readFile(targetIdentity, '/AGENT.md', 'resident')).resolves.toMatchObject({
      content: expect.stringContaining('居民2'),
    });
    await expect(workspace.getRuntimeMetadata(targetIdentity)).resolves.toMatchObject({ logicalRounds: 1 });
  }, 30_000);

  it('closes a malformed sequence and permits a clean reconnect without exposing another timeline', async () => {
    await client?.close();
    client = await WireClient.connect(handle.url, origin);
    const capabilities = [{ kind: 'skill', name: 'wait', description: 'Wait in place.', arguments: {} }] as const;
    client.send({
      kind: 'hello',
      pairingToken: token,
      world: { worldId: 'world-1', timelineId: 'timeline-3', epoch: 'epoch-3' },
      capabilities,
    });
    await client.wait('ready');
    const closed = new Promise<number>((resolve) => client!.socket.once('close', (code) => resolve(code)));
    client.socket.send(JSON.stringify({ protocolVersion: 2, sequence: 0, kind: 'clock', paused: false }));
    await expect(closed).resolves.toBe(1008);
    client = null;
    const reconnected = await WireClient.connect(handle.url, origin);
    reconnected.send({
      kind: 'hello',
      pairingToken: token,
      world: { worldId: 'world-1', timelineId: 'timeline-4', epoch: 'epoch-4' },
      capabilities,
    });
    await expect(reconnected.wait('ready')).resolves.toMatchObject({ kind: 'ready' });
    const oversized = new Promise<number>((resolve) => reconnected.socket.once('close', (code) => resolve(code)));
    reconnected.socket.send('x'.repeat(128 * 1024 + 1));
    await expect(oversized).resolves.toBe(1009);
  });

  it('round-trips empty cognition and rejects a checksum-valid manifest with malformed UTF-8', async () => {
    await client?.close();
    const capabilities = [{ kind: 'skill', name: 'wait', description: 'Wait in place.', arguments: {} }] as const;
    const source = { worldId: 'empty-world', timelineId: 'empty-source', epoch: 'empty-epoch' };
    client = await WireClient.connect(handle.url, origin);
    client.send({ kind: 'hello', pairingToken: token, world: source, capabilities });
    await client.wait('ready');
    client.send({ kind: 'clock', paused: true });
    client.send({ kind: 'checkpoint-export', requestId: 'empty-export' });
    const ready = (await client.wait('checkpoint-ready')) as Extract<ResidentHostMessage, { kind: 'checkpoint-ready' }>;
    client.send({ kind: 'checkpoint-read', requestId: 'empty-read', transferId: ready.transferId, part: 0 });
    const part = (await client.wait('checkpoint-part')) as Extract<ResidentHostMessage, { kind: 'checkpoint-part' }>;
    const bytes = Buffer.from(part.content, 'base64');
    expect((JSON.parse(bytes.toString('utf8')) as { workspaces: unknown[] }).workspaces).toEqual([]);
    await client.close();

    const target = { worldId: source.worldId, timelineId: 'empty-target', epoch: 'empty-target-epoch' };
    client = await WireClient.connect(handle.url, origin);
    client.send({ kind: 'hello', pairingToken: token, world: target, capabilities });
    await client.wait('ready');
    client.send({ kind: 'clock', paused: true });
    client.send({
      kind: 'checkpoint-import',
      requestId: 'empty-import',
      transferId: 'empty-transfer',
      part: 0,
      parts: 1,
      content: part.content,
      sha256: ready.sha256,
    });
    await expect(client.wait('checkpoint-imported')).resolves.toMatchObject({ complete: true });
    expect(await workspace.listBindings(target.worldId, target.timelineId)).toEqual([]);

    await client.close();
    const malformedTarget = { worldId: 'utf8-world', timelineId: 'utf8-target', epoch: 'utf8-epoch' };
    client = await WireClient.connect(handle.url, origin);
    client.send({ kind: 'hello', pairingToken: token, world: malformedTarget, capabilities });
    await client.wait('ready');
    client.send({ kind: 'clock', paused: true });
    const prefix = Buffer.from(
      '{"format":"seedlands-resident-cognition","version":1,"source":{"worldId":"utf8-world","timelineId":"utf8-source","epoch":"old"},"workspaces":[],"note":"',
    );
    const malformed = Buffer.concat([prefix, Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
    client.send({
      kind: 'checkpoint-import',
      requestId: 'bad-utf8',
      transferId: 'bad-utf8-transfer',
      part: 0,
      parts: 1,
      content: malformed.toString('base64'),
      sha256: createHash('sha256').update(malformed).digest('hex'),
    });
    await expect(client.wait('error')).resolves.toMatchObject({ code: 'CHECKPOINT_IMPORT_REJECTED' });
  });

  it('exports and restores more historical residents than may be live at once', async () => {
    await client?.close();
    const source = { worldId: 'history-world', timelineId: 'history-source', epoch: 'history-epoch' };
    const behavior = baselineObservation().character.behaviorTree;
    for (let index = 0; index < 5; index++) {
      await workspace.initializeNpc(
        { worldId: source.worldId, timelineId: source.timelineId, actorId: `history-${index}`, incarnation: 'life-1' },
        {
          agent: `agent-${index}`,
          soul: `soul-${index}`,
          memory: `memory-${index}`,
          memoryEstimatedTokens: 4,
          behavior,
          templateVersion: 'history-fixture-v1',
        },
      );
    }
    const capabilities = [{ kind: 'skill', name: 'wait', description: 'Wait in place.', arguments: {} }] as const;
    client = await WireClient.connect(handle.url, origin);
    client.send({ kind: 'hello', pairingToken: token, world: source, capabilities });
    await client.wait('ready');
    client.send({ kind: 'clock', paused: true });
    client.send({ kind: 'checkpoint-export', requestId: 'history-export' });
    const ready = (await client.wait('checkpoint-ready')) as Extract<ResidentHostMessage, { kind: 'checkpoint-ready' }>;
    const chunks: string[] = [];
    for (let index = 0; index < ready.parts; index++) {
      client.send({
        kind: 'checkpoint-read',
        requestId: `history-read-${index}`,
        transferId: ready.transferId,
        part: index,
      });
      const part = (await client.wait('checkpoint-part')) as Extract<ResidentHostMessage, { kind: 'checkpoint-part' }>;
      chunks[index] = part.content;
    }
    expect(
      (
        JSON.parse(Buffer.concat(chunks.map((entry) => Buffer.from(entry, 'base64'))).toString('utf8')) as {
          workspaces: unknown[];
        }
      ).workspaces,
    ).toHaveLength(5);
    await client.close();

    const target = { worldId: source.worldId, timelineId: 'history-target', epoch: 'history-target-epoch' };
    client = await WireClient.connect(handle.url, origin);
    client.send({ kind: 'hello', pairingToken: token, world: target, capabilities });
    await client.wait('ready');
    client.send({ kind: 'clock', paused: true });
    for (let index = 0; index < chunks.length; index++) {
      client.send({
        kind: 'checkpoint-import',
        requestId: `history-import-${index}`,
        transferId: 'history-transfer',
        part: index,
        parts: chunks.length,
        content: chunks[index],
        sha256: ready.sha256,
      });
      await client.wait('checkpoint-imported');
    }
    expect(await workspace.listBindings(target.worldId, target.timelineId)).toHaveLength(5);
  }, 30_000);

  it('recovers an interrupted scheduler before admission and drains the old channel before rebinding', async () => {
    await client?.close();
    const world = { worldId: 'recovery-world', timelineId: 'recovery-timeline', epoch: 'recovery-epoch-1' };
    const fixture = actor(9, world.epoch);
    const current = { ...fixture, binding: { ...fixture.binding, worldId: world.worldId } };
    const identity: WorkspaceBinding = {
      worldId: world.worldId,
      timelineId: world.timelineId,
      actorId: current.binding.entityId,
      incarnation: current.binding.incarnation,
    };
    await workspace.initializeNpc(identity, {
      agent: 'recovery agent',
      soul: 'recovery soul',
      memory: 'recovery memory',
      memoryEstimatedTokens: 4,
      behavior: current.observation.character.behaviorTree,
      templateVersion: 'recovery-v1',
    });
    await workspace.appendMessages(identity, [
      {
        idempotencyKey: 'interrupted-ai',
        message: new AIMessage({
          id: 'interrupted-ai',
          content: '',
          tool_calls: [
            {
              id: 'open-tool-call',
              name: 'speak',
              args: { requestId: 'speech-1', text: 'hello' },
              type: 'tool_call',
            },
          ],
        }),
      },
    ]);
    await workspace.setRuntimeMetadata(identity, {
      expectedRevision: 1,
      snapshot: {
        version: 1,
        scheduler: {
          version: 1,
          fallbackSeconds: 60,
          remainingMs: 0,
          paused: false,
          blocked: false,
          inFlight: true,
          pendingReasons: ['interrupted dialogue'],
          episodes: [['dialogue', 1]],
        },
      },
      logicalRounds: 7,
      compactions: 0,
    });
    const capabilities = [{ kind: 'skill', name: 'wait', description: 'Wait in place.', arguments: {} }] as const;
    blockNextModel = true;
    client = await WireClient.connect(handle.url, origin);
    client.send({ kind: 'hello', pairingToken: token, world, capabilities });
    await client.wait('ready');
    client.send({ kind: 'bind', ...current, capabilities });
    await expect(client.wait('bound')).resolves.toMatchObject({ channelId: current.binding.sessionId });
    const recovered = workspace.restoreMessages(await workspace.getJournal(identity));
    expect(recovered).toContainEqual(
      expect.objectContaining({
        id: 'interrupted:open-tool-call',
        tool_call_id: 'open-tool-call',
        content: expect.stringContaining('unknown'),
      }),
    );
    await expect(
      client.wait(
        'status',
        (message) =>
          message.kind === 'status' &&
          message.channelId === current.binding.sessionId &&
          message.status.logicalRounds === 8,
      ),
    ).resolves.toMatchObject({ kind: 'status' });
    await expect.poll(() => blockNextModel, { timeout: 5_000 }).toBe(false);
    expect(blockedMessages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'open-tool-call',
        content: expect.stringContaining('unknown'),
      }),
    );
    await expect(workspace.getRuntimeMetadata(identity)).resolves.toMatchObject({
      logicalRounds: 8,
      snapshot: { scheduler: { inFlight: true, blocked: false } },
    });

    client.send({ kind: 'configure', channelId: current.binding.sessionId, fallbackSeconds: 120 });
    await client.close();
    client = await WireClient.connect(handle.url, origin);
    const nextWorld = { ...world, epoch: 'recovery-epoch-2' };
    const reboundFixture = actor(9, nextWorld.epoch);
    const rebound = { ...reboundFixture, binding: { ...reboundFixture.binding, worldId: nextWorld.worldId } };
    client.send({ kind: 'hello', pairingToken: token, world: nextWorld, capabilities });
    await client.wait('ready');
    client.send({ kind: 'bind', ...rebound, capabilities });
    await expect(client.wait('bound')).resolves.toMatchObject({ channelId: rebound.binding.sessionId });
    expect(modelAbortCount).toBe(1);
    const afterRebind = workspace.restoreMessages(await workspace.getJournal(identity));
    expect(afterRebind.filter((message) => message.id === 'interrupted:open-tool-call')).toHaveLength(1);
  }, 30_000);
});
