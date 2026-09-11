import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterEvent, CharacterObservation } from '@seedlands/game-core/runtime/character-control-protocol';
import type { ControllerHostMessage } from '@seedlands/cognition-protocol';
import type { CognitionModel, ModelRequest } from '../../apps/agent-server/src/model-types';
import { CognitionRuntime } from '../../apps/agent-server/src/runtime';
import { binding, observation } from './fixtures';

const retainedEvent = (cursor: number): CharacterEvent => ({
  cursor,
  at: cursor * 1000,
  type: cursor % 2 === 0 ? 'attacked' : 'dialogue-heard',
  ...(cursor % 2 === 0 ? { reason: `history-${cursor}` } : { text: `history-${cursor}` }),
});

const page = (from: number, through: number, historyHead: number): CharacterObservation => {
  const current = observation();
  return observation({
    character: { ...current.character, eventCursor: historyHead },
    events: Array.from({ length: through - from + 1 }, (_, index) => retainedEvent(from + index)),
    cursor: through,
  });
};

describe('paginated reconnect history', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('suppresses every frozen history page and wakes once for a new event in the final mixed page', async () => {
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
                id: 'fresh-after-history',
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
      requestId: () => 'fresh-request',
      fallbackSeconds: 60,
    });
    const receivePage = (sequence: number, value: CharacterObservation) =>
      runtime.receive({ kind: 'observe', protocolVersion: 1, binding: binding(), sequence, observation: value });

    receivePage(1, page(1, 32, 80));
    runtime.receive({ kind: 'control', protocolVersion: 1, binding: binding(), sequence: 2, command: 'pause' });
    receivePage(3, page(33, 64, 80));
    runtime.receive({ kind: 'control', protocolVersion: 1, binding: binding(), sequence: 4, command: 'resume' });
    await vi.advanceTimersByTimeAsync(60_250);
    expect(requests).toHaveLength(0);
    expect(sent.some((message) => message.kind === 'intent')).toBe(false);

    receivePage(5, page(65, 81, 81));
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toHaveLength(1);
    const history = JSON.stringify(requests[0]?.messages);
    for (let cursor = 1; cursor <= 80; cursor += 1) expect(history).toContain(`history-${cursor}`);
    expect(sent.filter((message) => message.kind === 'intent')).toEqual([
      expect.objectContaining({ requestId: 'fresh-request', observedCursor: 81 }),
    ]);

    runtime.receive({
      kind: 'receipt',
      protocolVersion: 1,
      binding: binding(),
      sequence: 6,
      receipt: { requestId: 'fresh-request', status: 'accepted', actionId: 'fresh-action', cursor: 81, revision: 9 },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveLength(1);
    runtime.dispose();
  });
});
