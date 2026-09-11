import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGatewayChatModel } from '../../apps/agent-server/src/gateway-model';
import {
  AIMessage,
  createResidentAgent,
  createResidentAgentDocument,
  HumanMessage,
  ToolMessage,
} from '../../apps/agent-server/src/resident-agent';
import {
  createDeepAgentsStoreBackend,
  createPostgresFrameworkPersistence,
  createWorkspaceNamespace,
  PersistentNpcWorkspace,
  type WorkspaceBinding,
} from '../../apps/agent-server/src/workspace';
import { waitCapabilities } from './fixtures';

const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const describePostgres = dockerAvailable ? describe : describe.skip;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describePostgres('persistent NPC workspace with actual PostgreSQL', () => {
  const containerName = `seedlands-npc-workspace-test-${process.pid}`;
  const password = 'fake-local-workspace-password';
  let connectionString = '';
  let workspace: PersistentNpcWorkspace;
  let framework: Awaited<ReturnType<typeof createPostgresFrameworkPersistence>>;
  const a: WorkspaceBinding = { worldId: 'world', timelineId: 'timeline-1', actorId: 'awei', incarnation: '1' };
  const b: WorkspaceBinding = { worldId: 'world', timelineId: 'timeline-1', actorId: 'bors', incarnation: '1' };

  beforeAll(async () => {
    const port = await freePort();
    connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/workspace_test`;
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
        'POSTGRES_DB=workspace_test',
        '-p',
        `127.0.0.1:${port}:5432`,
        'postgres:16-alpine',
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (started.status !== 0) throw new Error(`owned PostgreSQL failed to start: ${started.stderr}`);
    workspace = PersistentNpcWorkspace.open({ connectionString, schema: 'workspace_test' });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await workspace.pool.query('SELECT 1');
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!ready) throw new Error('owned PostgreSQL did not become ready');
    await workspace.setup();
    framework = await createPostgresFrameworkPersistence(connectionString, { checkpointSchema: 'checkpoint_test' });
  }, 150_000);

  afterAll(async () => {
    await framework?.close();
    await workspace?.close();
    spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
  });

  it('isolates trusted namespaces and hides sessions from residents and Pro', async () => {
    expect(createWorkspaceNamespace(a)).not.toBe(createWorkspaceNamespace(b));
    for (const binding of [a, b]) {
      await workspace.initializeNpc(binding, {
        agent: createResidentAgentDocument(waitCapabilities(), { name: binding.actorId }),
        soul: `soul:${binding.actorId}`,
        memory: `memory:${binding.actorId}`,
        memoryEstimatedTokens: 4,
        behavior: { revision: 1, goal: { kind: 'idle' }, definition: { type: 'wait' } },
        templateVersion: 'fixture-v1',
      });
    }
    expect(await workspace.listBindings('world', 'timeline-1')).toEqual(expect.arrayContaining([a, b]));
    expect(await workspace.listBindings('other-world', 'timeline-1')).toEqual([]);
    expect(await workspace.listBindings('world', 'other-timeline')).toEqual([]);
    expect(await workspace.listFiles(a, 'resident')).toEqual([
      '/AGENT.md',
      '/SOUL.md',
      '/MEMORY.md',
      '/behavior/current.json',
    ]);
    await expect(workspace.readFile(a, '/sessions/private/window-1.jsonl', 'system')).rejects.toThrow('not visible');
    await expect(workspace.readFile(a, '/sessions/private/window-1.jsonl', 'memory-editor')).rejects.toThrow(
      'not visible',
    );
    expect((await workspace.readFile(a, '/SOUL.md', 'resident')).content).toBe('soul:awei');
    expect((await workspace.readFile(b, '/SOUL.md', 'resident')).content).toBe('soul:bors');
    await expect(
      workspace.initializeNpc(a, {
        agent: 'attempted replacement',
        soul: 'soul:awei',
        memory: 'memory:awei',
        memoryEstimatedTokens: 4,
        behavior: { revision: 1, goal: { kind: 'idle' }, definition: { type: 'wait' } },
        templateVersion: 'fixture-v1',
      }),
    ).rejects.toThrow('birth package conflicts');
    await workspace.appendMessages(b, [{ idempotencyKey: 'anonymous-human', message: new HumanMessage('hello') }]);
    expect(workspace.restoreMessages(await workspace.getJournal(b))[0]?.id).toBe('window-1:1');
  });

  it('journals standard messages and opaque fields losslessly from the first message across restart and duplicates', async () => {
    const human = new HumanMessage({ id: 'human-1', content: 'hello' });
    const assistant = new AIMessage({
      id: 'ai-1',
      content: '',
      tool_calls: [{ id: 'call-1', name: 'observe_self', args: {}, type: 'tool_call' }],
      additional_kwargs: { reasoning_content: 'opaque reasoning', gateway_extension: { trace: 'opaque-1' } },
    });
    const result = new ToolMessage({ id: 'tool-1', tool_call_id: 'call-1', content: '{"status":"ok"}' });
    await workspace.appendMessages(a, [
      { idempotencyKey: 'turn-1:human', message: human },
      { idempotencyKey: 'turn-1:ai', message: assistant },
      { idempotencyKey: 'turn-1:tool', message: result },
    ]);
    await workspace.appendMessages(a, [{ idempotencyKey: 'turn-1:human', message: human }]);
    const first = await workspace.getJournal(a);
    expect(first).toHaveLength(3);
    await workspace.recordRequestManifest(a, {
      requestId: 'turn-1',
      logicalModel: 'flash',
      throughJournalSeq: 3,
      requestPayload: { messages: [{ role: 'user', content: 'hello' }] },
      systemPrefix: { revision: 1, content: 'full prefix' },
      toolSchema: [{ name: 'observe_self', full: true }],
      toolSchemaRevision: 'tools-v1',
      modelConfigurationRevision: 'gateway-v1',
      gatewayAuditRef: 'gateway-audit-1',
    });
    await workspace.close();
    workspace = PersistentNpcWorkspace.open({ connectionString, schema: 'workspace_test' });
    const restored = workspace.restoreMessages(await workspace.getJournal(a));
    expect(restored.map((message) => message._getType())).toEqual(['human', 'ai', 'tool']);
    expect(restored[1]?.additional_kwargs).toEqual(
      expect.objectContaining({
        reasoning_content: 'opaque reasoning',
        gateway_extension: { trace: 'opaque-1' },
      }),
    );
    expect((restored[2] as ToolMessage).tool_call_id).toBe('call-1');
    const portable = await workspace.exportPortable(a);
    expect(portable.manifests[0]).toEqual(
      expect.objectContaining({
        prefix_ref: expect.stringMatching(/^sha256:/u),
        tool_schema_ref: expect.stringMatching(/^sha256:/u),
      }),
    );
    expect(portable.blobs).toHaveLength(3);
  });

  it('keeps received, included, and compacted watermarks separate with duplicate pages and a frozen tail', async () => {
    const firstPage = {
      pageId: 'page-1',
      coverage: { requestedAfter: 0, through: 2, returnedThrough: 2, hasMore: false },
      events: [
        { eventId: 'event-1', cursor: 1, payload: { kind: 'noticed' } },
        { eventId: 'event-2', cursor: 2, payload: { kind: 'spoken' } },
      ],
    } as const;
    await workspace.receiveEventPage(a, firstPage);
    await workspace.receiveEventPage(a, firstPage);
    expect(await workspace.markIncluded(a, 2)).toEqual({ receivedThrough: 2, includedThrough: 2, compactedThrough: 0 });
    const frozen = await workspace.freezeForCompaction(a);
    await workspace.receiveEventPage(a, {
      pageId: 'page-2',
      coverage: { requestedAfter: 2, through: 3, returnedThrough: 3, hasMore: false },
      events: [{ eventId: 'event-3', cursor: 3, payload: { kind: 'tail' } }],
    });
    await workspace.receiveEventPage(a, {
      pageId: 'page-empty-gap',
      coverage: {
        requestedAfter: 3,
        through: 5,
        returnedThrough: 3,
        hasMore: true,
        lostRange: { from: 4, to: 5 },
      },
      events: [],
    });
    expect(frozen).toMatchObject({ windowId: 'window-1', throughJournalSeq: 3, throughEventCursor: 2 });
    await expect(
      workspace.publishCompaction(a, {
        expectedMemoryRevision: 1,
        frozenWindowId: 'window-1',
        throughJournalSeq: 3,
        content: 'invalid source',
        estimatedTokens: 3,
        sources: [{ journalSeq: 999, kind: 'observed' }],
      }),
    ).rejects.toThrow('outside the frozen window');
    await expect(
      workspace.publishCompaction(a, {
        expectedMemoryRevision: 1,
        frozenWindowId: 'window-1',
        throughJournalSeq: 3,
        content: 'x'.repeat(16 * 1024 + 1),
        estimatedTokens: 4_001,
        sources: [{ journalSeq: 1, kind: 'observed' }],
      }),
    ).rejects.toThrow('token estimate');
    expect((await workspace.readFile(a, '/MEMORY.md', 'resident')).revision).toBe(1);
    const published = await workspace.publishCompaction(a, {
      expectedMemoryRevision: 1,
      frozenWindowId: 'window-1',
      throughJournalSeq: 3,
      content: 'I remember the observed greeting.',
      estimatedTokens: 8,
      sources: [{ journalSeq: 1, kind: 'observed' }],
    });
    expect(published).toMatchObject({ memoryRevision: 2, windowId: 'window-2' });
    expect(await workspace.getWatermarks(a)).toEqual({ receivedThrough: 5, includedThrough: 2, compactedThrough: 2 });
    expect((await workspace.readRecentEvents(a)).events).toEqual([
      { eventId: 'event-3', cursor: 3, payload: { kind: 'tail' } },
    ]);
    expect(await workspace.readEventCoverage(a, 3)).toContainEqual(
      expect.objectContaining({ returnedThrough: 3, lostRange: { from: 4, to: 5 } }),
    );
    await expect(
      workspace.publishCompaction(a, {
        expectedMemoryRevision: 1,
        frozenWindowId: 'window-1',
        throughJournalSeq: 3,
        content: 'stale',
        estimatedTokens: 1,
        sources: [{ journalSeq: 1, kind: 'observed' }],
      }),
    ).rejects.toThrow('conflict');
  });

  it('persists bounded scheduler metadata with revision CAS', async () => {
    expect(await workspace.getRuntimeMetadata(a)).toMatchObject({ revision: 1, logicalRounds: 0, compactions: 0 });
    const updated = await workspace.setRuntimeMetadata(a, {
      expectedRevision: 1,
      snapshot: { remainingMs: 10, paused: false, blocked: null, inFlight: null, episodes: [], pending: [] },
      logicalRounds: 7,
      compactions: 1,
    });
    expect(updated).toMatchObject({ revision: 2, logicalRounds: 7, compactions: 1 });
    await expect(
      workspace.setRuntimeMetadata(a, {
        expectedRevision: 1,
        snapshot: {},
        logicalRounds: 0,
        compactions: 0,
      }),
    ).rejects.toThrow('revision conflict');
  });

  it('uses actual PostgresStore through Deep Agents StoreBackend without cross-NPC leakage', async () => {
    const backendA = createDeepAgentsStoreBackend(framework.store, a);
    const backendB = createDeepAgentsStoreBackend(framework.store, b);
    expect(await backendA.write('/bounded.txt', 'a-only')).toMatchObject({ path: '/bounded.txt', filesUpdate: null });
    expect(await backendA.read('/bounded.txt')).toMatchObject({ content: 'a-only' });
    expect(await backendB.read('/bounded.txt')).toMatchObject({ error: expect.any(String) });
    await framework.close();
    framework = await createPostgresFrameworkPersistence(connectionString, { checkpointSchema: 'checkpoint_test' });
    expect(await createDeepAgentsStoreBackend(framework.store, a).read('/bounded.txt')).toMatchObject({
      content: 'a-only',
    });
  });

  it('resumes a standard createAgent message thread through the actual PostgresSaver after restart', async () => {
    const requests: { messages?: readonly { content?: unknown }[] }[] = [];
    const model = createGatewayChatModel({
      tier: 'flash',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-local',
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as { messages?: readonly { content?: unknown }[] });
        return new Response(
          JSON.stringify({
            id: `reply-${requests.length}`,
            model: 'mock',
            choices: [
              { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: `reply-${requests.length}` } },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const buildAgent = () =>
      createResidentAgent({
        binding: a,
        flashModel: model,
        proModel: model,
        workspace,
        capabilities: waitCapabilities(),
        world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
        checkpointer: framework.checkpointer,
        store: framework.store,
        toolSchemaRevision: 'tools-v1',
        modelConfigurationRevision: 'models-v1',
      });
    await buildAgent().invokeTurn({
      requestId: 'saved-turn-1',
      message: new HumanMessage({ id: 'saved-input-1', content: 'remember this turn' }),
    });
    const beforeCompaction = await workspace.freezeForCompaction(a);
    await workspace.publishCompaction(a, {
      expectedMemoryRevision: beforeCompaction.memoryRevision,
      frozenWindowId: beforeCompaction.windowId,
      throughJournalSeq: beforeCompaction.throughJournalSeq,
      content: 'bounded memory without old verbatim turn',
      estimatedTokens: 8,
      sources: [{ journalSeq: 0, kind: 'prior-memory' }],
    });
    await workspace.receiveEventPage(a, {
      pageId: 'post-compaction-tail',
      coverage: { requestedAfter: 5, through: 6, returnedThrough: 6, hasMore: false },
      events: [{ eventId: 'event-6', cursor: 6, payload: { kind: 'tail-after-compaction' } }],
    });
    await framework.close();
    framework = await createPostgresFrameworkPersistence(connectionString, { checkpointSchema: 'checkpoint_test' });
    await buildAgent().invokeTurn({
      requestId: 'saved-turn-2',
      message: new HumanMessage({ id: 'saved-input-2', content: 'continue after restart' }),
    });
    const latest = JSON.stringify(requests.at(-1));
    expect(latest).not.toContain('remember this turn');
    expect(latest).toContain('tail-after-compaction');
    expect(latest).toContain('continue after restart');
  });

  it('exports a snapshot to a new timeline without importing future memory', async () => {
    const snapshot = await workspace.exportPortable(a);
    const restored: WorkspaceBinding = { ...a, timelineId: 'restored-timeline' };
    const corrupted = structuredClone(snapshot) as unknown as {
      documents: { content: string }[];
    };
    corrupted.documents[0]!.content = 'corrupted after export';
    const corruptTarget: WorkspaceBinding = { ...a, timelineId: 'corrupt-target' };
    await expect(workspace.importPortable(corruptTarget, corrupted as never)).rejects.toThrow('checksum mismatch');
    await expect(workspace.getRuntimeMetadata(corruptTarget)).rejects.toThrow('does not exist');
    const frozenMemory = snapshot.state.memory_revision as number;
    const frozen = await workspace.freezeForCompaction(a);
    await workspace.publishCompaction(a, {
      expectedMemoryRevision: frozen.memoryRevision,
      frozenWindowId: frozen.windowId,
      throughJournalSeq: frozen.throughJournalSeq,
      content: 'future memory in original timeline',
      estimatedTokens: 8,
      sources: [{ journalSeq: 0, kind: 'prior-memory' }],
    });
    await workspace.importPortable(restored, snapshot);
    expect((await workspace.readFile(restored, '/MEMORY.md', 'resident')).revision).toBe(frozenMemory);
    expect((await workspace.readFile(restored, '/MEMORY.md', 'resident')).content).not.toContain('future memory');
    expect(await workspace.getRuntimeMetadata(restored)).toMatchObject({ logicalRounds: 7, compactions: 1 });
    expect(await workspace.readEventCoverage(restored, 3)).toContainEqual(
      expect.objectContaining({ returnedThrough: 3, lostRange: { from: 4, to: 5 } }),
    );
    expect(createWorkspaceNamespace(restored)).not.toBe(createWorkspaceNamespace(a));
    const restoredRequests: unknown[] = [];
    const restoredModel = createGatewayChatModel({
      tier: 'flash',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-local',
      fetch: async (_url, init) => {
        restoredRequests.push(JSON.parse(String(init?.body)) as unknown);
        return new Response(
          JSON.stringify({
            id: 'restored-reply',
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'restored' } }],
          }),
          { status: 200 },
        );
      },
    });
    await createResidentAgent({
      binding: restored,
      flashModel: restoredModel,
      proModel: restoredModel,
      workspace,
      capabilities: waitCapabilities(),
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      checkpointer: framework.checkpointer,
      store: framework.store,
      toolSchemaRevision: 'tools-v1',
      modelConfigurationRevision: 'models-v1',
    }).invokeTurn({ requestId: 'restored-turn', message: new HumanMessage('new timeline turn') });
    const restoredWire = JSON.stringify(restoredRequests.at(-1));
    expect(restoredWire).toContain('continue after restart');
    expect(restoredWire).not.toContain('future memory in original timeline');
  });
});
