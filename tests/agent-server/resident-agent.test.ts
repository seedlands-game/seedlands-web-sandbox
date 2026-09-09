import { describe, expect, it, vi } from 'vitest';
import { createGatewayChatModel } from '../../apps/agent-server/src/gateway-model';
import {
  createResidentAgent,
  createResidentAgentDocument,
  HumanMessage,
  RESIDENT_TOOL_REGISTRY,
} from '../../apps/agent-server/src/resident-agent';
import type { PersistentNpcWorkspace } from '../../apps/agent-server/src/workspace/postgres';
import type { WorkspaceBinding } from '../../apps/agent-server/src/workspace/types';

const binding: WorkspaceBinding = { worldId: 'world', timelineId: 'timeline', actorId: 'awei', incarnation: '1' };

function mockModel(toolCall?: Readonly<{ id: string; name: string; args: Record<string, unknown> }>) {
  let call = 0;
  return createGatewayChatModel({
    tier: 'flash',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'fake-local',
    fetch: async () => {
      call += 1;
      const toolCalls =
        call === 1 && toolCall
          ? [
              {
                id: toolCall.id,
                type: 'function',
                function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) },
              },
            ]
          : undefined;
      return new Response(
        JSON.stringify({
          id: `mock-${call}`,
          model: 'mock',
          choices: [
            {
              index: 0,
              finish_reason: toolCalls ? 'tool_calls' : 'stop',
              message: { role: 'assistant', content: toolCalls ? null : 'done', tool_calls: toolCalls },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
}

function fakeWorkspace() {
  const journal: { seq: number; windowId: string; message: unknown }[] = [];
  const manifests: unknown[] = [];
  let suspended = false;
  const workspace = {
    async readFile(_binding: WorkspaceBinding, path: string) {
      return { path, revision: 1, content: `fixture:${path}` };
    },
    async listFiles() {
      return ['/AGENT.md', '/SOUL.md', '/MEMORY.md', '/behavior/current.json'];
    },
    async readRecentEvents() {
      return {
        events: [],
        coverage: [],
        watermarks: { receivedThrough: 0, includedThrough: 0, compactedThrough: 0 },
        hasMore: false,
      };
    },
    async appendMessages(_binding: WorkspaceBinding, entries: readonly { message: unknown }[]) {
      return entries.map((entry) => {
        const item = { seq: journal.length + 1, windowId: 'window-1', message: entry.message };
        journal.push(item);
        return item;
      });
    },
    async getJournal() {
      return journal;
    },
    async getActiveWindow() {
      return { windowId: 'window-1', memoryRevision: 1 };
    },
    async getWatermarks() {
      return { receivedThrough: 0, includedThrough: 0, compactedThrough: 0 };
    },
    async markIncluded() {},
    async recordRequestManifest(_binding: WorkspaceBinding, manifest: unknown) {
      manifests.push(manifest);
    },
    async recordRequestReceipt() {},
    async isCognitionSuspended() {
      return suspended;
    },
    async freezeForCompaction() {
      return {
        windowId: 'window-1',
        memoryRevision: 1,
        throughJournalSeq: journal.length,
        throughEventCursor: 0,
        messages: [],
        memory: { content: 'old memory' },
      };
    },
    restoreMessages(messages: readonly { message: unknown }[]) {
      return messages.map((entry) => entry.message);
    },
    async publishCompaction() {
      return { commitId: 'commit', memoryRevision: 2, windowId: 'window-2' };
    },
    async markCompactionFailure(_binding: WorkspaceBinding, hard: boolean) {
      suspended = hard;
    },
  };
  return {
    workspace: workspace as unknown as PersistentNpcWorkspace,
    journal,
    manifests,
    isSuspended: () => suspended,
  };
}

describe('standard resident Agent', () => {
  it('uses LangChain createAgent with only bounded domain tools and sends speech through Authority', async () => {
    const fake = fakeWorkspace();
    const speak = vi.fn(async () => ({ status: 'accepted', eventId: 'speech-1' }));
    const proposeBehavior = vi.fn(async () => ({ status: 'installed', revision: 2 }));
    const flash = mockModel({ id: 'speak-1', name: 'speak', args: { requestId: 'speech-request-1', text: 'Hello.' } });
    const agent = createResidentAgent({
      binding,
      flashModel: flash,
      proModel: mockModel(),
      workspace: fake.workspace,
      world: { observe: async () => ({ self: true }), proposeBehavior, speak },
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'tools-v1',
      modelConfigurationRevision: 'models-v1',
    });
    const output = await agent.invokeTurn({
      requestId: 'turn-1',
      message: new HumanMessage({ id: 'input-1', content: 'Say hello.' }),
    });
    expect(speak).toHaveBeenCalledWith({ requestId: 'speech-request-1', text: 'Hello.' });
    expect(proposeBehavior).not.toHaveBeenCalled();
    expect(output.map((message) => message._getType())).toContain('tool');
    expect(fake.journal.length).toBeGreaterThanOrEqual(4);
    expect(fake.manifests).toHaveLength(2);
    expect(fake.manifests).toEqual([
      expect.objectContaining({ requestId: 'turn-1:model:1', requestPayload: expect.any(Object) }),
      expect.objectContaining({ requestId: 'turn-1:model:2', requestPayload: expect.any(Object) }),
    ]);
  });

  it('assigns a stable input id and generates protected AGENT tool docs from the public registry', async () => {
    const fake = fakeWorkspace();
    const agent = createResidentAgent({
      binding,
      flashModel: mockModel(),
      proModel: mockModel(),
      workspace: fake.workspace,
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'tools-v1',
      modelConfigurationRevision: 'models-v1',
    });
    const output = await agent.invokeTurn({ requestId: 'stable-turn', message: new HumanMessage('hello') });
    expect(output.map((entry) => entry._getType())).toEqual(['ai']);
    const document = createResidentAgentDocument({ speak: true }, { factoryAgentSlot: 'likes lanterns' });
    for (const definition of RESIDENT_TOOL_REGISTRY) expect(document).toContain(`- ${definition.name}:`);
    expect(document).toContain('protected data slot');
    expect(document).toContain('likes lanterns');
  });

  it('does not install unrestricted Deep Agent filesystem or subagent tools', async () => {
    const fake = fakeWorkspace();
    const flash = mockModel({ id: 'forbidden-1', name: 'write_file', args: { path: '/MEMORY.md', content: 'bypass' } });
    const agent = createResidentAgent({
      binding,
      flashModel: flash,
      proModel: mockModel(),
      workspace: fake.workspace,
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'tools-v1',
      modelConfigurationRevision: 'models-v1',
    });
    const output = await agent.invokeTurn({
      requestId: 'turn-forbidden',
      message: new HumanMessage({ id: 'input-forbidden', content: 'try' }),
    });
    expect(
      output.some((message) => message._getType() === 'tool' && String(message.content).includes('not a valid tool')),
    ).toBe(true);
    expect((await fake.workspace.readFile(binding, '/MEMORY.md', 'resident')).content).toBe('fixture:/MEMORY.md');
  });

  it('retains old memory and suspends cognition after Pro failure at the hard limit', async () => {
    const fake = fakeWorkspace();
    const agent = createResidentAgent({
      binding,
      flashModel: mockModel(),
      proModel: mockModel(),
      workspace: fake.workspace,
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'tools-v1',
      modelConfigurationRevision: 'models-v1',
    });
    await expect(agent.compactMemory({ requestId: 'compact-failure', hardLimitReached: true })).resolves.toMatchObject({
      status: 'failed',
    });
    expect(fake.isSuspended()).toBe(true);
    expect((await fake.workspace.readFile(binding, '/MEMORY.md', 'resident')).content).toBe('fixture:/MEMORY.md');
    await expect(agent.invokeTurn({ message: new HumanMessage('later') })).rejects.toThrow('suspended');
  });

  it('publishes memory only through the Pro-only validated tool', async () => {
    const fake = fakeWorkspace();
    const agent = createResidentAgent({
      binding,
      flashModel: mockModel(),
      proModel: mockModel({
        id: 'memory-call',
        name: 'propose_memory_update',
        args: {
          expectedMemoryRevision: 1,
          frozenWindowId: 'window-1',
          throughJournalSeq: 0,
          content: 'bounded memory',
          estimatedTokens: 3,
          sources: [{ journalSeq: 0, kind: 'prior-memory' }],
        },
      }),
      workspace: fake.workspace,
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'tools-v1',
      modelConfigurationRevision: 'models-v1',
    });
    await expect(agent.compactMemory({ requestId: 'compact-success', hardLimitReached: false })).resolves.toEqual({
      status: 'published',
    });
    expect(fake.manifests).toHaveLength(2);
    expect(fake.manifests).toEqual([
      expect.objectContaining({ requestId: 'compact-success:model:1', logicalModel: 'pro' }),
      expect.objectContaining({ requestId: 'compact-success:model:2', logicalModel: 'pro' }),
    ]);
  });
});

describe('resident round budgets and partial journal', () => {
  function setup(fetch: typeof globalThis.fetch) {
    const fake = fakeWorkspace();
    const world = {
      observe: vi.fn(async () => ({ actual: true })),
      proposeBehavior: vi.fn(async () => ({ status: 'installed' })),
      speak: vi.fn(async () => ({ status: 'accepted' })),
    };
    const agent = createResidentAgent({
      binding,
      workspace: fake.workspace,
      world,
      flashModel: createGatewayChatModel({
        tier: 'flash',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'fake-local',
        fetch,
      }),
      proModel: mockModel(),
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'test',
      modelConfigurationRevision: 'test',
    });
    return { fake, world, agent };
  }
  function response(id: string, name = 'observe_self', args: Record<string, unknown> = {}) {
    return new Response(
      JSON.stringify({
        id,
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: `tool-${id}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
            },
          },
        ],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }
  it('limits a nonterminating tool loop to eight provider calls and persists each receipt', async () => {
    let calls = 0;
    const { agent, fake, world } = setup(async () => response(String(++calls)));
    await expect(agent.invokeTurn({ requestId: 'bounded', message: new HumanMessage('continue') })).rejects.toThrow(
      'model step budget exhausted',
    );
    expect(calls).toBe(8);
    expect(world.observe).toHaveBeenCalledTimes(8);
    const messages = fake.journal.map((entry) => entry.message as { _getType(): string });
    expect(messages.filter((entry) => entry._getType() === 'ai')).toHaveLength(8);
    expect(messages.filter((entry) => entry._getType() === 'tool')).toHaveLength(8);
    expect(messages.filter((entry) => entry._getType() === 'human')).toHaveLength(1);
  });
  it('keeps actual tool effects and their receipts when a later provider request fails', async () => {
    let calls = 0;
    const { agent, fake, world } = setup(async () =>
      ++calls === 1
        ? response('speak', 'speak', { requestId: 'said-once', text: '我会继续巡逻。' })
        : new Response('', { status: 503 }),
    );
    await expect(agent.invokeTurn({ requestId: 'partial', message: new HumanMessage('hello') })).rejects.toThrow();
    expect(world.speak).toHaveBeenCalledOnce();
    expect(calls).toBe(2);
    const messages = fake.journal.map((entry) => entry.message as { _getType(): string; content: unknown });
    expect(messages.map((entry) => entry._getType())).toEqual(['human', 'ai', 'tool']);
    expect(messages.at(-1)?.content).toContain('accepted');
  });
  it('excludes sealed history from pre-admission and checks a large new tool/environment payload before a call', async () => {
    const fetch = vi.fn(async () => response('unexpected'));
    const { agent, fake } = setup(fetch);
    fake.journal.push({ seq: 1, windowId: 'sealed-window', message: new HumanMessage('z'.repeat(200000)) });
    expect((await agent.assessNextTurnBudget(new HumanMessage('small'))).status).toBe('ready');
    const message = new HumanMessage('z'.repeat(128000));
    expect((await agent.assessNextTurnBudget(message)).status).toBe('suspend');
    await expect(agent.invokeTurn({ requestId: 'oversize', message })).rejects.toThrow('context budget');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('admits at most three behavior proposals even when the model keeps submitting', async () => {
    let calls = 0;
    const { agent, world } = setup(async () =>
      response(String(++calls), 'propose_behavior_update', { expectedBehaviorRevision: 1, goal: {}, definition: {} }),
    );
    await expect(agent.invokeTurn({ requestId: 'proposals', message: new HumanMessage('plan') })).rejects.toThrow();
    expect(world.proposeBehavior).toHaveBeenCalledTimes(3);
    expect(calls).toBeLessThanOrEqual(8);
  });
});
