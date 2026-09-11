import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ControllerHostMessage } from '@seedlands/cognition-protocol';
import { CognitionRuntime } from '../../apps/agent-server/src/runtime';
import type { ModelCompletion } from '../../apps/agent-server/src/model-types';
import { baselineObservation, binding, observation } from './fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('allows a fixed destination plan to finish while the body moves through unchanged event history', async () => {
  const sent: ControllerHostMessage[] = [];
  let finish!: (value: ModelCompletion) => void;
  const complete = vi.fn(() => new Promise<ModelCompletion>((resolve) => (finish = resolve)));
  const runtime = new CognitionRuntime({ binding: binding(), model: { complete }, send: (m) => sent.push(m) });
  try {
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 0,
      observation: baselineObservation(),
    });
    runtime.receive({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(complete).toHaveBeenCalledTimes(1);
    for (let step = 1; step <= 4; step++) {
      await vi.advanceTimersByTimeAsync(500);
      const current = observation();
      runtime.receive({
        kind: 'observe',
        protocolVersion: 1,
        binding: binding(),
        sequence: step + 1,
        observation: observation({
          character: { ...current.character, hunger: current.character.hunger + step },
          self: { ...current.self, position: [1 + step, 2, 3] },
          visibleEntities: [],
          events: [],
        }),
      });
    }
    expect(complete).toHaveBeenCalledTimes(1);
    finish({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'fixed-destination',
            type: 'function',
            function: {
              name: 'propose_intent',
              arguments: JSON.stringify({ goal: { kind: 'move-to', position: [2, 2, 3] } }),
            },
          },
        ],
      },
      finishReason: 'tool_calls',
      usage: null,
      latencyMs: 2000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.filter((message) => message.kind === 'intent')).toEqual([
      expect.objectContaining({
        observedRevision: 8,
        observedCursor: 1,
        intent: { goal: { kind: 'move-to', position: [2, 2, 3] } },
      }),
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  } finally {
    runtime.dispose();
  }
});
