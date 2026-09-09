import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerClientMessage, ControllerHostMessage } from '@seedlands/cognition-protocol';
import { CognitionRuntime } from '../../apps/agent-server/src/runtime';
import type { CognitionModel, ModelRequest } from '../../apps/agent-server/src/model-types';
import { baselineObservation, binding, event, observation } from './fixtures';

const observe = (sequence: number, value = observation()): ControllerClientMessage => ({
  kind: 'observe',
  protocolVersion: 1,
  binding: binding(),
  sequence,
  observation: value,
});

const intentModel = (requests: ModelRequest[]): CognitionModel => ({
  complete: async (request) => {
    requests.push(request);
    return {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `reconnect-tool-${requests.length}`,
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
});

describe('reconnect event history baseline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not replay retained dialogue but wakes once for the next new dialogue', async () => {
    const firstRequests: ModelRequest[] = [];
    const firstSent: ControllerHostMessage[] = [];
    const first = new CognitionRuntime({
      binding: binding(),
      model: intentModel(firstRequests),
      send: (message) => firstSent.push(message),
      requestId: () => 'first-request',
      fallbackSeconds: 60,
    });
    first.receive(observe(1, baselineObservation()));
    first.receive(observe(2));
    await vi.advanceTimersByTimeAsync(250);
    expect(firstRequests).toHaveLength(1);
    first.receive({
      kind: 'receipt',
      protocolVersion: 1,
      binding: binding(),
      sequence: 3,
      receipt: { requestId: 'first-request', status: 'accepted', actionId: 'first-action', cursor: 1, revision: 9 },
    });
    first.dispose();

    const reconnectedRequests: ModelRequest[] = [];
    const reconnectedSent: ControllerHostMessage[] = [];
    const reconnected = new CognitionRuntime({
      binding: binding(),
      model: intentModel(reconnectedRequests),
      send: (message) => reconnectedSent.push(message),
      requestId: () => 'reconnected-request',
      fallbackSeconds: 60,
    });
    reconnected.receive(observe(1));
    await vi.advanceTimersByTimeAsync(60_250);
    expect(reconnectedRequests).toHaveLength(0);
    expect(reconnectedSent.some((message) => message.kind === 'intent')).toBe(false);

    const retained = observation();
    reconnected.receive(
      observe(
        2,
        observation({
          character: { ...retained.character, eventCursor: 2 },
          events: [event(2)],
          cursor: 2,
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(reconnectedRequests).toHaveLength(1);
    expect(reconnectedRequests[0]?.messages.some((message) => message.content?.includes('"cursor":1'))).toBe(true);
    expect(reconnectedRequests[0]?.messages.some((message) => message.content?.includes('"cursor":2'))).toBe(true);
    expect(reconnectedSent.filter((message) => message.kind === 'intent')).toEqual([
      expect.objectContaining({ kind: 'intent', requestId: 'reconnected-request', observedCursor: 2 }),
    ]);
    reconnected.dispose();
  });

  it('seeds the first valid no-event observation while paused after rejecting a malformed frame', async () => {
    const requests: ModelRequest[] = [];
    const sent: ControllerHostMessage[] = [];
    const runtime = new CognitionRuntime({
      binding: binding(),
      model: intentModel(requests),
      send: (message) => sent.push(message),
      fallbackSeconds: 60,
    });
    runtime.receive({ kind: 'control', protocolVersion: 1, binding: binding(), sequence: 1, command: 'pause' });
    const invalid = baselineObservation();
    runtime.receive(
      observe(2, {
        ...invalid,
        character: { ...invalid.character, policyRevision: invalid.character.policyRevision + 1 },
      }),
    );
    expect(sent.at(-1)).toMatchObject({ kind: 'status', state: 'paused', reason: 'stale' });
    runtime.receive(observe(3, baselineObservation()));
    runtime.receive({ kind: 'control', protocolVersion: 1, binding: binding(), sequence: 4, command: 'resume' });
    await vi.advanceTimersByTimeAsync(60_250);
    expect(requests).toHaveLength(0);

    runtime.receive(observe(5));
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toHaveLength(1);
    runtime.dispose();
  });
});
