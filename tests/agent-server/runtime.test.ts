import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ControllerClientMessage,
  ControllerHostMessage,
  ControllerReceipt,
} from '@seedlands/game-core/runtime/character-control-protocol';
import { CognitionRuntime } from '../../apps/agent-server/src/runtime';
import type { CognitionModel, ModelCompletion, ModelRequest } from '../../apps/agent-server/src/model-types';
import { ContextSession } from '../../apps/agent-server/src/context-session';
import { FLASH_MODEL, PRO_MODEL } from '../../apps/agent-server/src/config';
import { binding, event, observation } from './fixtures';

const receiptMessage = (sequence: number, receipt: ControllerReceipt): ControllerClientMessage => ({
  kind: 'receipt',
  protocolVersion: 1,
  binding: binding(),
  sequence,
  receipt,
});

describe('CognitionRuntime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('closes the tool pair on accepted and lets a later dialogue start a new decision', async () => {
    const requests: ModelRequest[] = [];
    const sent: ControllerHostMessage[] = [];
    const model: CognitionModel = {
      async complete(request) {
        requests.push(request);
        return {
          message: {
            role: 'assistant',
            content: null,
            reasoning_content: `private-${requests.length}`,
            tool_calls: [
              {
                id: `tool-${requests.length}`,
                type: 'function',
                function: { name: 'propose_intent', arguments: '{"goal":{"kind":"forage"}}' },
              },
            ],
          },
          finishReason: 'tool_calls',
          usage: { inputTokens: 10, cacheHitTokens: 0, outputTokens: 5, totalTokens: 15 },
          latencyMs: 1,
        };
      },
    };
    let nextId = 1;
    const runtime = new CognitionRuntime({
      binding: binding(),
      model,
      send: (message) => sent.push(message),
      requestId: () => `request-${nextId++}`,
    });
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    const firstIntent = sent.find(
      (message): message is Extract<ControllerHostMessage, { kind: 'intent' }> => message.kind === 'intent',
    );
    expect(firstIntent?.requestId).toBe('request-1');

    runtime.receive(
      receiptMessage(2, {
        requestId: 'request-1',
        actionId: 'goal-1',
        status: 'accepted',
        cursor: 1,
        revision: 9,
      }),
    );
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 3,
      observation: observation({ events: [event(2)], cursor: 2 }),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'tool-1', content: expect.stringContaining('accepted') }),
    );
    const intents = sent.filter(
      (message): message is Extract<ControllerHostMessage, { kind: 'intent' }> => message.kind === 'intent',
    );
    expect(intents[1]?.requestId).toBe('request-2');

    runtime.receive(
      receiptMessage(4, {
        requestId: 'request-1',
        actionId: 'goal-1',
        status: 'succeeded',
        cursor: 3,
        revision: 10,
      }),
    );
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 5,
      observation: observation({ events: [event(3)], cursor: 3 }),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toHaveLength(2);

    runtime.receive(
      receiptMessage(6, {
        requestId: 'request-2',
        actionId: 'goal-2',
        status: 'accepted',
        cursor: 3,
        revision: 10,
      }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toHaveLength(3);
    runtime.dispose();
  });

  it('preserves a higher-cursor event that arrives during Flash with the same character revision', async () => {
    const requests: ModelRequest[] = [];
    const sent: ControllerHostMessage[] = [];
    let resolveFirst!: (completion: ModelCompletion) => void;
    const intentCompletion = (id: string): ModelCompletion => ({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id,
            type: 'function',
            function: { name: 'propose_intent', arguments: '{"goal":{"kind":"forage"}}' },
          },
        ],
      },
      finishReason: 'tool_calls',
      usage: null,
      latencyMs: 1,
    });
    const model: CognitionModel = {
      complete: async (request) => {
        requests.push(request);
        if (requests.length === 1) return await new Promise<ModelCompletion>((resolve) => (resolveFirst = resolve));
        return intentCompletion(`tail-tool-${requests.length}`);
      },
    };
    let nextId = 1;
    const runtime = new CognitionRuntime({
      binding: binding(),
      model,
      send: (message) => sent.push(message),
      requestId: () => `tail-request-${nextId++}`,
    });
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toHaveLength(1);

    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 2,
      observation: observation({ events: [event(2)], cursor: 2 }),
    });
    resolveFirst(intentCompletion('tail-tool-1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toContainEqual(expect.objectContaining({ kind: 'intent', requestId: 'tail-request-1' }));

    runtime.receive(
      receiptMessage(3, {
        requestId: 'tail-request-1',
        actionId: 'tail-action-1',
        status: 'accepted',
        cursor: 2,
        revision: 8,
      }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'tail-tool-1' }),
    );
    expect(requests[1]?.messages.some((message) => message.content?.includes('"cursor":2'))).toBe(true);
    runtime.dispose();
  });

  it('waits for Authority memory ACK before spending the next Flash request', async () => {
    const models: string[] = [];
    const sent: ControllerHostMessage[] = [];
    const model: CognitionModel = {
      complete: async (request) => {
        models.push(request.model);
        if (request.model === PRO_MODEL)
          return {
            message: { role: 'assistant', content: 'compressed public memory' },
            finishReason: 'stop',
            usage: null,
            latencyMs: 1,
          };
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'post-compression-intent',
                type: 'function',
                function: { name: 'propose_intent', arguments: '{"goal":{"kind":"idle"}}' },
              },
            ],
          },
          finishReason: 'tool_calls',
          usage: null,
          latencyMs: 1,
        };
      },
    };
    const context = new ContextSession([{ role: 'user', content: 'old public context' }], {
      estimateTokens: (messages) =>
        messages.some((message) => message.content?.includes('confirmed-memory')) ? 0 : 20,
      softThreshold: 10,
      hardThreshold: 30,
    });
    let nextId = 1;
    const runtime = new CognitionRuntime({
      binding: binding(),
      model,
      context,
      send: (message) => sent.push(message),
      requestId: () => `compression-request-${nextId++}`,
    });
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(models).toEqual([PRO_MODEL]);
    expect(sent).toContainEqual(expect.objectContaining({ kind: 'memory', requestId: 'compression-request-1' }));

    runtime.receive(
      receiptMessage(2, {
        requestId: 'compression-request-1',
        status: 'accepted',
        cursor: 1,
        revision: 8,
      }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(models).toEqual([PRO_MODEL, FLASH_MODEL]);
    expect(sent).toContainEqual(expect.objectContaining({ kind: 'intent', requestId: 'compression-request-2' }));
    runtime.dispose();
  });

  it('aborts an in-flight model request and releases timers when disposed', async () => {
    let signal: AbortSignal | undefined;
    let rejectCompletion!: (error: Error) => void;
    const model: CognitionModel = {
      complete: async (request) => {
        signal = request.signal;
        return await new Promise<ModelCompletion>((_resolve, reject) => {
          rejectCompletion = reject;
          request.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    };
    const sent: ControllerHostMessage[] = [];
    const runtime = new CognitionRuntime({ binding: binding(), model, send: (message) => sent.push(message) });
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(signal?.aborted).toBe(false);
    runtime.dispose();
    expect(signal?.aborted).toBe(true);
    rejectCompletion(new Error('late provider failure'));
    await vi.runAllTimersAsync();
    expect(sent.some((message) => message.kind === 'intent')).toBe(false);
  });

  it('treats a deceased observation as terminal and clears an accepted-intent wait', async () => {
    const sent: ControllerHostMessage[] = [];
    let calls = 0;
    const model: CognitionModel = {
      complete: async () => {
        calls += 1;
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `terminal-tool-${calls}`,
                type: 'function',
                function: { name: 'propose_intent', arguments: '{"goal":{"kind":"forage"}}' },
              },
            ],
          },
          finishReason: 'tool_calls',
          usage: null,
          latencyMs: 1,
        };
      },
    };
    const runtime = new CognitionRuntime({
      binding: binding(),
      model,
      send: (message) => sent.push(message),
      requestId: () => 'terminal-request',
    });
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(sent.some((message) => message.kind === 'intent')).toBe(true);

    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 2,
      observation: observation({
        character: {
          ...observation().character,
          lifecycle: 'deceased',
          policyRevision: 4,
          revision: 9,
        },
        events: [event(2, 'attacked')],
        cursor: 2,
      }),
    });
    expect(sent.at(-1)).toMatchObject({ kind: 'status', state: 'fallback', reason: 'stale' });

    runtime.receive(
      receiptMessage(3, {
        requestId: 'terminal-request',
        status: 'accepted',
        cursor: 2,
        revision: 9,
      }),
    );
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 4,
      observation: observation({ events: [event(3)], cursor: 3 }),
    });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls).toBe(1);
    runtime.dispose();
  });

  it('aborts an in-flight decision when the controlled incarnation becomes deceased', async () => {
    let signal: AbortSignal | undefined;
    const sent: ControllerHostMessage[] = [];
    const model: CognitionModel = {
      complete: async (request) => {
        signal = request.signal;
        return await new Promise<ModelCompletion>((_resolve, reject) =>
          request.signal?.addEventListener('abort', () => reject(new Error('terminal')), { once: true }),
        );
      },
    };
    const runtime = new CognitionRuntime({ binding: binding(), model, send: (message) => sent.push(message) });
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(signal?.aborted).toBe(false);
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 2,
      observation: observation({
        character: { ...observation().character, lifecycle: 'deceased', policyRevision: 4 },
        events: [event(2, 'attacked')],
        cursor: 2,
      }),
    });
    expect(signal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    expect(sent.at(-1)).toMatchObject({ kind: 'status', state: 'fallback', reason: 'stale' });
    expect(sent.some((message) => message.kind === 'intent')).toBe(false);
    runtime.dispose();
  });

  it('reports missing credentials without creating synthetic model output', () => {
    const sent: ControllerHostMessage[] = [];
    const runtime = new CognitionRuntime({ binding: binding(), model: null, send: (message) => sent.push(message) });
    runtime.ready();
    runtime.receive({
      kind: 'configure',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      fallbackSeconds: 120,
      contextLimit: 256_000,
    });
    runtime.receive({
      kind: 'control',
      protocolVersion: 1,
      binding: binding(),
      sequence: 2,
      command: 'pause',
    });
    runtime.receive({
      kind: 'control',
      protocolVersion: 1,
      binding: binding(),
      sequence: 3,
      command: 'resume',
    });
    expect(sent.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: 'ready', modelAvailability: 'missing-key' }),
      expect.objectContaining({ kind: 'status', state: 'fallback', reason: 'missing-key' }),
    ]);
    expect(sent[2]).toMatchObject({ kind: 'status', state: 'fallback', reason: 'missing-key' });
    expect(sent.at(-1)).toMatchObject({ kind: 'status', state: 'fallback', reason: 'missing-key' });
    runtime.dispose();
  });
});
