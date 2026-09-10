import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayChatModel } from '../../apps/agent-server/src/gateway-model';
import { createResidentAgent, HumanMessage } from '../../apps/agent-server/src/resident-agent';
import { startResidentServer, type ResidentConnectionLifecycle } from '../../apps/agent-server/src/node/resident-host';
import type { PersistentNpcWorkspace } from '../../apps/agent-server/src/workspace/postgres';
import type { FrameworkPersistence } from '../../apps/agent-server/src/workspace/framework';
import type { WorkspaceBinding } from '../../apps/agent-server/src/workspace/types';
import { baselineObservation, binding, event, waitCapabilities } from './fixtures';
import { WireClient } from './resident-host-fixture';

type Deferred = Readonly<{ promise: Promise<void>; resolve(): void }>;

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function textResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'finalization-fixture',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function model(fetch: typeof globalThis.fetch): BaseChatModel {
  return createGatewayChatModel({
    tier: 'flash',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'fake-local',
    fetch,
  });
}

function finalizationWorkspace(stage: 'input' | 'receipt' | 'watermark' | 'freeze') {
  const observation = baselineObservation();
  const identity: WorkspaceBinding = {
    worldId: 'world-1',
    timelineId: 'timeline-1',
    actorId: observation.character.entityId,
    incarnation: observation.character.incarnation,
  };
  const gate = deferred();
  const entered = deferred();
  const journal: { seq: number; windowId: string; message: unknown }[] = [];
  const receipts = new Map<string, Record<string, unknown>>();
  let receivedThrough = 0;
  let includedThrough = 0;
  let runtimeRevision = 1;
  let compactionFailed = false;
  let pendingEvents: readonly ReturnType<typeof event>[] = [];
  const workspace = {
    async listBindings() {
      return [{ actorId: identity.actorId, incarnation: identity.incarnation }];
    },
    async initializeNpc() {},
    async readFile(_identity: WorkspaceBinding, path: string) {
      return {
        path,
        revision: 1,
        content: path === '/behavior/current.json' ? JSON.stringify(observation.character.behaviorTree) : 'fixture',
      };
    },
    async listFiles() {
      return ['/AGENT.md', '/SOUL.md', '/MEMORY.md', '/behavior/current.json'];
    },
    async getRuntimeMetadata() {
      return { revision: runtimeRevision, logicalRounds: 0, compactions: 0, snapshot: {} };
    },
    async setRuntimeMetadata() {
      runtimeRevision++;
      return { revision: runtimeRevision };
    },
    async receiveEventPage(
      _identity: WorkspaceBinding,
      page: Parameters<PersistentNpcWorkspace['receiveEventPage']>[1],
    ) {
      receivedThrough = Math.max(receivedThrough, page.coverage.returnedThrough);
      pendingEvents = page.events.map((entry) => entry.payload as ReturnType<typeof event>);
      return { receivedThrough, includedThrough, compactedThrough: 0 };
    },
    async projectBehavior() {},
    async getActiveWindow() {
      return { windowId: 'window-1', memoryRevision: 1 };
    },
    async getWatermarks() {
      return { receivedThrough, includedThrough, compactedThrough: 0 };
    },
    async getJournal() {
      return journal;
    },
    restoreMessages(entries: readonly { message: unknown }[]) {
      return entries.map((entry) => entry.message);
    },
    async readRecentEvents(_identity: WorkspaceBinding, input: { after?: number }) {
      const after = input.after ?? 0;
      const events = pendingEvents.filter((entry) => entry.cursor > after);
      return {
        events,
        coverage: [{ requestedAfter: after, through: receivedThrough, returnedThrough: receivedThrough }],
        watermarks: { receivedThrough, includedThrough, compactedThrough: 0 },
        hasMore: false,
      };
    },
    async isCognitionSuspended() {
      return false;
    },
    async getRequestReceipt(_identity: WorkspaceBinding, requestId: string) {
      return receipts.get(requestId) ?? null;
    },
    async appendMessages(_identity: WorkspaceBinding, entries: readonly { message: unknown }[]) {
      const stored = entries.map((entry) => {
        const stored = { seq: journal.length + 1, windowId: 'window-1', message: entry.message };
        journal.push(stored);
        return stored;
      });
      if (stage === 'input') {
        entered.resolve();
        await gate.promise;
      }
      return stored;
    },
    async recordRequestManifest() {},
    async recordRequestReceipt(_identity: WorkspaceBinding, requestId: string, outcome: Record<string, unknown>) {
      receipts.set(requestId, outcome);
      if (stage === 'receipt' && outcome.status === 'completed') {
        entered.resolve();
        await gate.promise;
      }
    },
    async markIncluded(_identity: WorkspaceBinding, through: number) {
      includedThrough = through;
      if (stage === 'watermark') {
        entered.resolve();
        await gate.promise;
      }
      return { receivedThrough, includedThrough, compactedThrough: 0 };
    },
    async freezeForCompaction() {
      const frozen = {
        windowId: 'window-1',
        memoryRevision: 1,
        throughJournalSeq: journal.length,
        throughEventCursor: includedThrough,
        messages: [],
        memory: { content: 'old memory' },
      };
      if (stage === 'freeze') {
        entered.resolve();
        await gate.promise;
      }
      return frozen;
    },
    async publishCompaction() {
      return { commitId: 'commit', memoryRevision: 2, windowId: 'window-2' };
    },
    async markCompactionFailure() {
      compactionFailed = true;
    },
  };
  return {
    workspace: workspace as unknown as PersistentNpcWorkspace,
    identity,
    entered: entered.promise,
    release: gate.resolve,
    receipt: (requestId: string) => receipts.get(requestId),
    completedReceipts: () => [...receipts.values()].filter((outcome) => outcome.status === 'completed'),
    compactionFailed: () => compactionFailed,
    watermarks: () => ({ receivedThrough, includedThrough, compactedThrough: 0 }),
  };
}

const framework = (): FrameworkPersistence =>
  ({ checkpointer: undefined, store: undefined }) as unknown as FrameworkPersistence;

describe('resident terminal finalization after cancellation', () => {
  it('records a failed turn without dispatching a model when cancellation follows the committed input', async () => {
    const fake = finalizationWorkspace('input');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => textResponse());
    const flash = model(fetch);
    const agent = createResidentAgent({
      binding: fake.identity,
      flashModel: flash,
      proModel: flash,
      workspace: fake.workspace,
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      capabilities: waitCapabilities(),
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'test',
      modelConfigurationRevision: 'test',
    });
    const abort = new AbortController();
    const turn = agent.invokeTurn({
      requestId: 'final-input',
      message: new HumanMessage('continue'),
      signal: abort.signal,
    });
    await fake.entered;
    abort.abort();
    fake.release();

    await expect(turn).rejects.toThrow();
    expect(fake.receipt('final-input')).toMatchObject({ status: 'failed' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets a real socket retirement wait for a committed receipt and its event watermark', async () => {
    const fake = finalizationWorkspace('receipt');
    let modelCalls = 0;
    const flash = model(async () => {
      modelCalls++;
      return textResponse();
    });
    const lifecycle: ResidentConnectionLifecycle[] = [];
    const host = await startResidentServer({
      workspace: fake.workspace,
      framework: framework(),
      flash,
      pro: flash,
      allowedOrigins: ['http://127.0.0.1:5173'],
      pairingToken: 'finalization-token',
      onConnectionLifecycle: (entry) => lifecycle.push(entry),
    });
    const client = await WireClient.connect(host.url, 'http://127.0.0.1:5173');
    try {
      const world = { worldId: 'world-1', timelineId: 'timeline-1', epoch: 'epoch-1' };
      const currentBinding = binding();
      client.send({ kind: 'hello', pairingToken: host.pairingToken, world, authoringCapabilities: waitCapabilities() });
      await client.wait('ready');
      client.send({
        kind: 'bind',
        binding: currentBinding,
        observation: baselineObservation(),
        capabilities: waitCapabilities(),
      });
      await client.wait('bound');
      const current = baselineObservation();
      client.send({
        kind: 'observe',
        channelId: currentBinding.sessionId,
        observation: {
          ...current,
          character: { ...current.character, eventCursor: 1 },
          events: [{ ...event(1, 'rejudge-requested'), nodeId: 'dialogue', episode: 1 }],
          cursor: 1,
          eventCoverage: { requestedAfter: 0, through: 1, returnedThrough: 1, hasMore: false },
        },
      });
      await fake.entered;
      expect(modelCalls).toBe(1);

      await client.close();
      await vi.waitFor(() => expect(lifecycle.some((entry) => entry.phase === 'closed')).toBe(true));
      expect(lifecycle.some((entry) => entry.phase === 'retired')).toBe(false);
      fake.release();
      await vi.waitFor(() => expect(lifecycle.some((entry) => entry.phase === 'retired')).toBe(true));

      expect(fake.completedReceipts()).toHaveLength(1);
      expect(fake.watermarks()).toEqual({ receivedThrough: 1, includedThrough: 1, compactedThrough: 0 });
      expect(modelCalls).toBe(1);
    } finally {
      fake.release();
      await client.close();
      await host.close();
    }
  });

  it('resolves a successful turn after cancellation while its committed watermark is returning', async () => {
    const fake = finalizationWorkspace('watermark');
    await fake.workspace.receiveEventPage(fake.identity, {
      pageId: 'fixture-page',
      coverage: { requestedAfter: 0, through: 1, returnedThrough: 1, hasMore: false },
      events: [{ eventId: 'world:1', cursor: 1, payload: event(1, 'rejudge-requested') }],
    });
    let modelCalls = 0;
    const flash = model(async () => {
      modelCalls++;
      return textResponse();
    });
    const agent = createResidentAgent({
      binding: fake.identity,
      flashModel: flash,
      proModel: flash,
      workspace: fake.workspace,
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      capabilities: waitCapabilities(),
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'test',
      modelConfigurationRevision: 'test',
    });
    const abort = new AbortController();
    const turn = agent.invokeTurn({
      requestId: 'final-watermark',
      message: new HumanMessage('continue'),
      signal: abort.signal,
    });
    await fake.entered;
    abort.abort();
    fake.release();

    await expect(turn).resolves.toHaveLength(1);
    expect(fake.receipt('final-watermark')).toMatchObject({ status: 'completed' });
    expect(fake.watermarks()).toEqual({ receivedThrough: 1, includedThrough: 1, compactedThrough: 0 });
    expect(modelCalls).toBe(1);
  });

  it('settles a frozen compaction window when cancellation follows the freeze commit', async () => {
    const fake = finalizationWorkspace('freeze');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => textResponse());
    const flash = model(fetch);
    const agent = createResidentAgent({
      binding: fake.identity,
      flashModel: flash,
      proModel: flash,
      workspace: fake.workspace,
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      capabilities: waitCapabilities(),
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'test',
      modelConfigurationRevision: 'test',
    });
    const abort = new AbortController();
    const compaction = agent.compactMemory({
      requestId: 'final-freeze',
      hardLimitReached: false,
      signal: abort.signal,
    });
    await fake.entered;
    abort.abort();
    fake.release();

    await expect(compaction).resolves.toMatchObject({ status: 'failed' });
    expect(fake.compactionFailed()).toBe(true);
    expect(fake.receipt('final-freeze')).toMatchObject({ status: 'failed' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
