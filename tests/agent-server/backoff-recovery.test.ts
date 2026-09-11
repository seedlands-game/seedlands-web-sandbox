import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ControllerHostMessage } from '@seedlands/cognition-protocol';
import { CognitionRuntime } from '../../apps/agent-server/src/runtime';
import type { CognitionModel } from '../../apps/agent-server/src/model-types';
import { baselineObservation, binding, event, observation } from './fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['dialogue-heard', 'attacked'] as const)(
  'retries %s at backoff expiry instead of the fallback window',
  async (type) => {
    const sent: ControllerHostMessage[] = [];
    let calls = 0;
    const model: CognitionModel = {
      complete: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Temporary provider failure');
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'fresh-decision',
                type: 'function',
                function: { name: 'propose_intent', arguments: JSON.stringify({ goal: { kind: 'idle' } }) },
              },
            ],
          },
          usage: null,
          latencyMs: 1,
          finishReason: 'tool_calls',
        };
      },
    };
    const runtime = new CognitionRuntime({ binding: binding(), model, send: (message) => sent.push(message) });
    const first = observation();
    const observe = (value: ReturnType<typeof observation>) =>
      runtime.receive({
        kind: 'observe',
        protocolVersion: 1,
        binding: binding(),
        sequence: value.cursor,
        observation: value,
      });
    try {
      observe(baselineObservation());
      observe(first);
      await vi.advanceTimersByTimeAsync(250);
      expect(calls).toBe(1);
      expect(sent.at(-1)).toMatchObject({ kind: 'status', reason: 'transport' });
      observe(observation({ character: { ...first.character, eventCursor: 2 }, cursor: 2, events: [event(2, type)] }));
      await vi.advanceTimersByTimeAsync(999);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(2);
      expect(sent).toContainEqual(expect.objectContaining({ kind: 'intent', observedCursor: 2 }));
    } finally {
      runtime.dispose();
    }
    expect(vi.getTimerCount()).toBe(0);
  },
);
