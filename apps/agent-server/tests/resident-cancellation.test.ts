import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayChatModel } from '../src/gateway-model';
import { createResidentAgent, HumanMessage } from '../src/resident-agent';
import { ResidentChannel } from '../src/resident-channel';
import { startResidentServer, type ResidentConnectionLifecycle } from '../src/node/resident-host';
import { ResidentChannelRetirement } from '../src/node/resident-channel-retirement';
import { ResidentConnectionLifecycleOwner } from '../src/node/resident-connection-lifecycle';
import type { PersistentNpcWorkspace } from '../src/workspace/postgres';
import type { FrameworkPersistence } from '../src/workspace/framework';
import type { WorkspaceBinding } from '../src/workspace/types';
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
      id: 'cancel-fixture',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function toolResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'cancel-tool-fixture',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'speak-after-observation',
                type: 'function',
                function: {
                  name: 'speak',
                  arguments: JSON.stringify({ requestId: 'cancel-speech', text: 'I am still here.' }),
                },
              },
            ],
          },
        },
      ],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function cancellationWorkspace() {
  const observation = baselineObservation();
  const metadataGate = deferred();
  let blockMetadata = false;
  let metadataEntered: (() => void) | undefined;
  const metadataBlocked = new Promise<void>((resolve) => {
    metadataEntered = resolve;
  });
  const journal: { seq: number; windowId: string; message: unknown }[] = [];
  const workspace = {
    async listBindings() {
      return [{ actorId: observation.character.entityId, incarnation: observation.character.incarnation }];
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
      return { revision: 1, logicalRounds: 0, compactions: 0, snapshot: {} };
    },
    async setRuntimeMetadata() {
      if (blockMetadata) {
        blockMetadata = false;
        metadataEntered?.();
        await metadataGate.promise;
      }
      return { revision: 1 };
    },
    async receiveEventPage() {},
    async projectBehavior() {},
    async getActiveWindow() {
      return { windowId: 'window-1', memoryRevision: 1 };
    },
    async getWatermarks() {
      return { receivedThrough: 0, includedThrough: 0, compactedThrough: 0 };
    },
    async getJournal() {
      return journal;
    },
    restoreMessages(entries: readonly { message: unknown }[]) {
      return entries.map((entry) => entry.message);
    },
    async readRecentEvents() {
      return {
        events: [],
        coverage: [],
        watermarks: { receivedThrough: 0, includedThrough: 0, compactedThrough: 0 },
        hasMore: false,
      };
    },
    async isCognitionSuspended() {
      return false;
    },
    async getRequestReceipt() {
      return null;
    },
    async appendMessages(_identity: WorkspaceBinding, entries: readonly { message: unknown }[]) {
      return entries.map((entry) => {
        const stored = { seq: journal.length + 1, windowId: 'window-1', message: entry.message };
        journal.push(stored);
        return stored;
      });
    },
    async recordRequestManifest() {},
    async recordRequestReceipt() {},
    async markIncluded() {},
  };
  return {
    workspace: workspace as unknown as PersistentNpcWorkspace,
    observation,
    metadataBlocked,
    releaseMetadata: metadataGate.resolve,
    blockNextMetadata: () => {
      blockMetadata = true;
    },
  };
}

function model(fetch: typeof globalThis.fetch): BaseChatModel {
  return createGatewayChatModel({
    tier: 'flash',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'fake-local',
    fetch,
  });
}

const framework = (): FrameworkPersistence =>
  ({ checkpointer: undefined, store: undefined }) as unknown as FrameworkPersistence;

describe('resident cancellation boundaries', () => {
  it('does not dispatch a model after channel disposal releases a blocked metadata preflight', async () => {
    const fake = cancellationWorkspace();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => textResponse());
    const channel = new ResidentChannel({
      world: { worldId: 'world-1', timelineId: 'timeline-1', epoch: 'epoch-1' },
      binding: binding(),
      observation: fake.observation,
      capabilities: waitCapabilities(),
      workspace: fake.workspace,
      framework: framework(),
      flash: model(fetch),
      pro: model(fetch),
      worldPort: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      paused: false,
      status: () => undefined,
    });
    await channel.initialize();
    const assessmentEntered = deferred();
    const assessmentGate = deferred();
    const compactMemory = vi.fn(async () => ({ status: 'published' as const }));
    (
      channel as unknown as {
        agent: {
          assessNextTurnBudget(): Promise<{ status: 'compact'; estimatedTotalTokens: number }>;
          compactMemory: typeof compactMemory;
        };
      }
    ).agent = {
      assessNextTurnBudget: async () => {
        assessmentEntered.resolve();
        await assessmentGate.promise;
        return { status: 'compact', estimatedTotalTokens: 10 };
      },
      compactMemory,
    };
    const preflight = (
      channel as unknown as { prepareAdmission(trigger: { kind: 'event'; reasons: readonly string[] }): Promise<void> }
    ).prepareAdmission({ kind: 'event', reasons: ['new dialogue'] });
    await assessmentEntered.promise;
    channel.dispose();
    assessmentGate.resolve();
    await preflight;
    await channel.shutdown();

    expect(compactMemory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not enter an Agent turn after disposal releases its metadata preflight', async () => {
    const fake = cancellationWorkspace();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => textResponse());
    const channel = new ResidentChannel({
      world: { worldId: 'world-1', timelineId: 'timeline-1', epoch: 'epoch-1' },
      binding: binding(),
      observation: fake.observation,
      capabilities: waitCapabilities(),
      workspace: fake.workspace,
      framework: framework(),
      flash: model(fetch),
      pro: model(fetch),
      worldPort: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      paused: false,
      status: () => undefined,
    });
    await channel.initialize();
    const invokeTurn = vi.fn(async () => []);
    (channel as unknown as { agent: { invokeTurn: typeof invokeTurn } }).agent = { invokeTurn };
    fake.blockNextMetadata();
    const run = (
      channel as unknown as { run(trigger: { kind: 'event'; reasons: readonly string[] }): Promise<void> }
    ).run({ kind: 'event', reasons: ['new dialogue'] });
    await fake.metadataBlocked;
    channel.dispose();
    fake.releaseMetadata();
    await run;
    await channel.shutdown();

    expect(invokeTurn).not.toHaveBeenCalled();
  });

  it('does not call the model handler after a manifest write resumes under an aborted signal', async () => {
    const fake = cancellationWorkspace();
    const manifestGate = deferred();
    const manifestEntered = deferred();
    fake.workspace.recordRequestManifest = async () => {
      manifestEntered.resolve();
      await manifestGate.promise;
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => textResponse());
    const agent = createResidentAgent({
      binding: {
        worldId: 'world-1',
        timelineId: 'timeline-1',
        actorId: fake.observation.character.entityId,
        incarnation: fake.observation.character.incarnation,
      },
      flashModel: model(fetch),
      proModel: model(fetch),
      workspace: fake.workspace,
      world: { observe: async () => ({}), proposeBehavior: async () => ({}), speak: async () => ({}) },
      capabilities: waitCapabilities(),
      checkpointer: undefined,
      store: undefined,
      toolSchemaRevision: 'cancel-test',
      modelConfigurationRevision: 'cancel-test',
    });
    const abort = new AbortController();
    const turn = agent.invokeTurn({
      requestId: 'cancelled-turn',
      message: new HumanMessage('think'),
      signal: abort.signal,
    });
    await manifestEntered.promise;
    abort.abort(new Error('channel disposed'));
    manifestGate.resolve();

    await expect(turn).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('disposes a replacement immediately while preserving same-identity shutdown order', async () => {
    const retirement = new ResidentChannelRetirement();
    const firstGate = deferred();
    const order: string[] = [];
    const identity = { worldId: 'world-1', timelineId: 'timeline-1', actorId: 'npc-1', incarnation: 'life-1' };
    const first = {
      identity,
      dispose: vi.fn(() => order.push('dispose-first')),
      shutdown: vi.fn(async () => {
        order.push('shutdown-first');
        await firstGate.promise;
      }),
    } as unknown as ResidentChannel;
    const second = {
      identity,
      dispose: vi.fn(() => order.push('dispose-second')),
      shutdown: vi.fn(async () => {
        order.push('shutdown-second');
      }),
    } as unknown as ResidentChannel;

    const firstCompletion = retirement.retire(first);
    await vi.waitFor(() => expect(first.shutdown).toHaveBeenCalledOnce());
    const secondCompletion = retirement.retire(second);
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(second.shutdown).not.toHaveBeenCalled();
    firstGate.resolve();
    await Promise.all([firstCompletion, secondCompletion]);

    expect(order).toEqual(['dispose-first', 'shutdown-first', 'dispose-second', 'shutdown-second']);
  });

  it('retires a real authenticated socket before a released manifest may dispatch another model step', async () => {
    const fake = cancellationWorkspace();
    const secondManifestEntered = deferred();
    const secondManifestGate = deferred();
    let manifestCount = 0;
    fake.workspace.recordRequestManifest = async () => {
      if (++manifestCount === 2) {
        secondManifestEntered.resolve();
        await secondManifestGate.promise;
      }
    };
    let modelCalls = 0;
    const flash = model(async () => (++modelCalls === 1 ? toolResponse() : textResponse()));
    const lifecycle: ResidentConnectionLifecycle[] = [];
    const host = await startResidentServer({
      workspace: fake.workspace,
      framework: framework(),
      flash,
      pro: flash,
      allowedOrigins: ['http://127.0.0.1:5173'],
      pairingToken: 'cancel-fixture-token',
      onConnectionLifecycle: (entry) => {
        lifecycle.push(entry);
        if (entry.phase === 'closed') throw new Error('diagnostic observer failure');
      },
    });
    const client = await WireClient.connect(host.url, 'http://127.0.0.1:5173');
    try {
      const world = { worldId: 'world-1', timelineId: 'timeline-1', epoch: 'epoch-1' };
      client.send({ kind: 'hello', pairingToken: host.pairingToken, world, authoringCapabilities: waitCapabilities() });
      await client.wait('ready');
      const currentBinding = binding();
      client.send({
        kind: 'bind',
        binding: currentBinding,
        observation: fake.observation,
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
      const speak = await client.wait('speak');
      if (speak.kind !== 'speak') throw new Error('expected resident speech request');
      client.send({
        kind: 'receipt',
        channelId: currentBinding.sessionId,
        requestId: speak.requestId,
        result: { ok: true, value: { eventId: 'speech-1' } },
      });
      await secondManifestEntered.promise;

      await client.close();
      await vi.waitFor(() => expect(lifecycle.some((entry) => entry.phase === 'closed')).toBe(true));
      secondManifestGate.resolve();
      await vi.waitFor(() => expect(lifecycle.some((entry) => entry.phase === 'retired')).toBe(true));

      expect(lifecycle.map((entry) => entry.phase)).toEqual(['authenticated', 'closed', 'retired']);
      expect(new Set(lifecycle.map((entry) => entry.connectionId)).size).toBe(1);
      expect(modelCalls).toBe(1);
    } finally {
      secondManifestGate.resolve();
      await client.close();
      await host.close();
    }
  });

  it('reports retirement failure without exposing its error through the diagnostic callback', async () => {
    const events: ResidentConnectionLifecycle[] = [];
    const lifecycle = new ResidentConnectionLifecycleOwner((event) => events.push(event), 'connection-1');
    const world = { worldId: 'world-1', timelineId: 'timeline-1', epoch: 'epoch-1' };
    lifecycle.authenticated(world);
    lifecycle.track(Promise.reject(new Error('private durable failure')));
    lifecycle.retire(world, Promise.resolve());
    await vi.waitFor(() => expect(events.at(-1)?.phase).toBe('retirement-failed'));

    expect(events).toEqual([
      { phase: 'authenticated', connectionId: 'connection-1', world },
      { phase: 'closed', connectionId: 'connection-1', world },
      { phase: 'retirement-failed', connectionId: 'connection-1', world },
    ]);
  });

  it('does not start a queued import after its authenticated socket closes', async () => {
    const fake = cancellationWorkspace();
    const exportEntered = deferred();
    const exportGate = deferred();
    fake.workspace.listBindings = async () => {
      exportEntered.resolve();
      await exportGate.promise;
      return [];
    };
    const importPortableBatch = vi.fn(async () => undefined);
    fake.workspace.importPortableBatch = importPortableBatch;
    const lifecycle: ResidentConnectionLifecycle[] = [];
    const host = await startResidentServer({
      workspace: fake.workspace,
      framework: framework(),
      flash: null,
      pro: null,
      allowedOrigins: ['http://127.0.0.1:5173'],
      pairingToken: 'queued-inbound-token',
      onConnectionLifecycle: (entry) => lifecycle.push(entry),
    });
    const client = await WireClient.connect(host.url, 'http://127.0.0.1:5173');
    try {
      const world = { worldId: 'world-1', timelineId: 'timeline-1', epoch: 'epoch-1' };
      client.send({ kind: 'hello', pairingToken: host.pairingToken, world, authoringCapabilities: waitCapabilities() });
      await client.wait('ready');
      client.send({ kind: 'clock', paused: true });
      client.send({ kind: 'checkpoint-export', requestId: 'blocked-export' });
      const bytes = Buffer.from(
        JSON.stringify({
          format: 'seedlands-resident-cognition',
          version: 1,
          source: { ...world, timelineId: 'source-timeline', epoch: 'source-epoch' },
          workspaces: [],
        }),
      );
      client.send({
        kind: 'checkpoint-import',
        requestId: 'queued-import',
        transferId: 'queued-import-transfer',
        part: 0,
        parts: 1,
        content: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      const pong = new Promise<void>((resolve) => client.socket.once('pong', () => resolve()));
      client.socket.ping();
      await Promise.all([exportEntered.promise, pong]);

      await client.close();
      await vi.waitFor(() => expect(lifecycle.some((entry) => entry.phase === 'closed')).toBe(true));
      exportGate.resolve();
      await vi.waitFor(() => expect(lifecycle.some((entry) => entry.phase === 'retired')).toBe(true));

      expect(importPortableBatch).not.toHaveBeenCalled();
    } finally {
      exportGate.resolve();
      await client.close();
      await host.close();
    }
  });
});
