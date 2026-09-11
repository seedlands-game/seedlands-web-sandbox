import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerReceipt } from '@seedlands/stdlib/runtime/character-control-protocol';
import type { ControllerClientMessage, ControllerHostMessage } from '@seedlands/cognition-protocol';
import { ContextSession } from '../src/context-session';
import type { CognitionModel, ModelCompletion, ModelRequest } from '../src/model-types';
import { CognitionRuntime } from '../src/runtime';
import { baselineObservation, binding, event, observation } from './fixtures';

const receiptMessage = (sequence: number, receipt: ControllerReceipt): ControllerClientMessage => ({
  kind: 'receipt',
  protocolVersion: 1,
  binding: binding(),
  sequence,
  receipt,
});

const seedRuntime = (runtime: CognitionRuntime): void => {
  runtime.receive({
    kind: 'observe',
    protocolVersion: 1,
    binding: binding(),
    sequence: 0,
    observation: baselineObservation(),
  });
};

describe('GitHub cognition host correctness fixes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('can retry a hard-cap rotation after pause aborts Pro before a memory request is emitted', async () => {
    const sent: ControllerHostMessage[] = [];
    let proCalls = 0;
    const model: CognitionModel = {
      complete: async (request) => {
        proCalls += 1;
        if (proCalls === 1)
          return await new Promise<ModelCompletion>((_resolve, reject) =>
            request.signal?.addEventListener('abort', () => reject(new Error('paused')), { once: true }),
          );
        return {
          message: { role: 'assistant', content: 'retry-safe memory' },
          finishReason: 'stop',
          usage: null,
          latencyMs: 1,
        };
      },
    };
    const context = new ContextSession([{ role: 'user', content: 'hard-cap context' }], {
      estimateTokens: () => 40,
      softThreshold: 10,
      hardThreshold: 30,
    });
    const runtime = new CognitionRuntime({
      binding: binding(),
      model,
      context,
      send: (message) => sent.push(message),
      requestId: () => 'retry-memory',
    });
    seedRuntime(runtime);
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    runtime.receive({ kind: 'control', protocolVersion: 1, binding: binding(), sequence: 2, command: 'pause' });
    await vi.advanceTimersByTimeAsync(0);
    expect(context.hasPreparedRotation).toBe(false);
    expect(sent.some((message) => message.kind === 'memory')).toBe(false);

    runtime.receive({ kind: 'control', protocolVersion: 1, binding: binding(), sequence: 3, command: 'resume' });
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 4,
      observation: observation({ events: [event(2, 'attacked')], cursor: 2 }),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(proCalls).toBe(2);
    expect(sent).toContainEqual(expect.objectContaining({ kind: 'memory', requestId: 'retry-memory' }));
    runtime.dispose();
  });

  it('waits for a fresh observation before retrying an Authority-rejected stale cursor', async () => {
    const requests: ModelRequest[] = [];
    const sent: ControllerHostMessage[] = [];
    const model: CognitionModel = {
      complete: async (request) => {
        requests.push(request);
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `receipt-tool-${requests.length}`,
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
    const runtime = new CognitionRuntime({ binding: binding(), model, send: (message) => sent.push(message) });
    seedRuntime(runtime);
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    const first = sent.find(
      (message): message is Extract<ControllerHostMessage, { kind: 'intent' }> => message.kind === 'intent',
    );
    expect(first?.observedCursor).toBe(1);
    runtime.receive(
      receiptMessage(2, {
        requestId: first?.requestId ?? '',
        status: 'rejected',
        reason: 'CHARACTER_REVISION_CONFLICT',
        cursor: 1,
        revision: 8,
      }),
    );
    await vi.advanceTimersByTimeAsync(180_000);
    expect(requests).toHaveLength(1);

    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 3,
      observation: observation({ events: [event(2, 'item-picked-up')], cursor: 2 }),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.some((message) => message.content?.includes('"cursor":2'))).toBe(true);
    runtime.dispose();
  });
});
