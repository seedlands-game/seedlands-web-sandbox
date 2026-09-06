import { describe, expect, it, vi } from 'vitest';
import { BrowserLogicClient, type LogicWorkerPort } from '../../src/client/browser-logic-client';
import { LOGIC_PROTOCOL_VERSION, type LogicIntentBatch } from '../../src/server/logic/logic-protocol';
import type { LogicObservation, LogicWorkerResponse } from '../../src/server/logic/logic-protocol';

class FakeWorker implements LogicWorkerPort {
  onmessage: ((event: MessageEvent<LogicWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  terminated = false;
  postMessage(message: unknown) {
    this.posts.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}

describe('BrowserLogicClient', () => {
  it('等待独立 Logic Worker ready 后转发完整 observation 与 intent batch', async () => {
    const worker = new FakeWorker();
    const batches: LogicIntentBatch[] = [];
    const client = new BrowserLogicClient(worker, 'epoch:1', { onIntents: (batch) => batches.push(batch) });
    const starting = client.start(true, 60);
    expect(worker.posts[0]).toEqual({
      kind: 'init-logic',
      protocolVersion: LOGIC_PROTOCOL_VERSION,
      epoch: 'epoch:1',
      harnessEnabled: true,
      physicsHz: 60,
    });
    worker.onmessage?.({
      data: { kind: 'logic-ready', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch: 'epoch:1' },
    } as MessageEvent);
    await starting;

    const batch: LogicIntentBatch = {
      protocolVersion: LOGIC_PROTOCOL_VERSION,
      epoch: 'epoch:1',
      observationSequence: 4,
      expiresAtPhysicsTick: 20,
      intents: [],
    };
    worker.onmessage?.({
      data: { kind: 'logic-intents', protocolVersion: LOGIC_PROTOCOL_VERSION, batch },
    } as MessageEvent);
    expect(batches).toEqual([batch]);
  });

  it('worker忙时只保留最新observation并在回执后继续', async () => {
    const worker = new FakeWorker();
    const client = new BrowserLogicClient(worker, 'epoch:queue');
    const starting = client.start(false, 60);
    worker.onmessage?.({
      data: { kind: 'logic-ready', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch: 'epoch:queue' },
    } as MessageEvent);
    await starting;
    const observation = (sequence: number): LogicObservation => ({
      protocolVersion: LOGIC_PROTOCOL_VERSION,
      epoch: 'epoch:queue',
      observationSequence: sequence,
      physicsTick: sequence,
      activeTimeMs: sequence,
      worldTime: 8,
      entities: [],
      decisionContext: { actors: [], pois: { version: 1, sequence: 0, pois: [] }, terrainWindows: [] },
    });
    client.sendObservation(observation(1));
    client.sendObservation(observation(2));
    client.sendObservation(observation(3));
    expect(worker.posts.filter((post) => (post as { kind?: string }).kind === 'logic-observation')).toHaveLength(1);
    worker.onmessage?.({
      data: {
        kind: 'logic-intents',
        protocolVersion: LOGIC_PROTOCOL_VERSION,
        batch: {
          protocolVersion: LOGIC_PROTOCOL_VERSION,
          epoch: 'epoch:queue',
          observationSequence: 1,
          expiresAtPhysicsTick: 20,
          intents: [],
        },
      },
    } as MessageEvent);
    expect(
      worker.posts
        .filter((post) => (post as { kind?: string }).kind === 'logic-observation')
        .map((post) => (post as { observation: LogicObservation }).observation.observationSequence),
    ).toEqual([1, 3]);
  });

  it('harness阻塞消息只通过显式方法发送，dispose终止worker', async () => {
    const worker = new FakeWorker();
    const fatal = vi.fn();
    const client = new BrowserLogicClient(worker, 'epoch:2', { onFatal: fatal });
    const starting = client.start(true, 30);
    worker.onmessage?.({
      data: { kind: 'logic-ready', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch: 'epoch:2' },
    } as MessageEvent);
    await starting;
    const blocked = client.blockForHarness(500);
    expect(worker.posts.at(-1)).toMatchObject({ kind: 'block-for-test', epoch: 'epoch:2', requestId: 1, ms: 500 });
    worker.onmessage?.({
      data: { kind: 'logic-block-started', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch: 'epoch:2', requestId: 1 },
    } as MessageEvent);
    await blocked;
    expect(client.diagnostics).toEqual({ blockStartedCount: 1, blockCompletedCount: 0 });
    worker.onmessage?.({
      data: { kind: 'logic-block-finished', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch: 'epoch:2', requestId: 1 },
    } as MessageEvent);
    expect(client.diagnostics).toEqual({ blockStartedCount: 1, blockCompletedCount: 1 });
    client.dispose();
    expect(worker.terminated).toBe(true);
    expect(fatal).not.toHaveBeenCalled();
  });
});
