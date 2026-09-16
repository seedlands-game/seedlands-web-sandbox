import { describe, expect, it } from 'vitest';
import { createCognitionGraph, decideWithGraph } from '../src/cognition-graph';
import { validateToolCall } from '../src/cognition-tools';
import type { CognitionModel, ModelRequest } from '../src/model-types';
import { observation } from './fixtures';

describe('cognition graph', () => {
  it('runs a bounded read before emitting exactly one semantic intent', async () => {
    const requests: ModelRequest[] = [];
    const model: CognitionModel = {
      async complete(request) {
        requests.push(request);
        const first = requests.length === 1;
        return {
          message: {
            role: 'assistant',
            content: null,
            reasoning_content: first ? 'inspect privately' : 'choose privately',
            tool_calls: first
              ? [
                  {
                    id: 'read-actions',
                    type: 'function',
                    function: { name: 'available_actions', arguments: '{"ref":"drop-1"}' },
                  },
                  {
                    id: 'read-visible',
                    type: 'function',
                    function: {
                      name: 'inspect_visible',
                      arguments: '{"ref":"drop-1","fields":["type","distance","stack"]}',
                    },
                  },
                ]
              : [
                  {
                    id: 'intent-1',
                    type: 'function',
                    function: {
                      name: 'propose_intent',
                      arguments: '{"goal":{"kind":"forage"},"say":"I will look for berries."}',
                    },
                  },
                ],
          },
          finishReason: 'tool_calls',
          usage: null,
          latencyMs: 1,
        };
      },
    };
    const result = await decideWithGraph(createCognitionGraph({ model }), observation(), []);
    expect(result).toMatchObject({
      status: 'intent',
      proposal: { goal: { kind: 'forage' }, say: 'I will look for berries.' },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages).toContainEqual(
      expect.objectContaining({ role: 'assistant', reasoning_content: 'inspect privately' }),
    );
    expect(requests[1]?.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'read-actions' }),
    );
    expect(requests[1]?.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'read-visible' }),
    );
  });

  it('rejects multiple intents, mixed read+intent, and invisible references while closing every tool call', async () => {
    const responses = [
      [
        {
          id: 'intent-one',
          type: 'function' as const,
          function: { name: 'propose_intent', arguments: '{"goal":{"kind":"idle"}}' },
        },
        {
          id: 'intent-two',
          type: 'function' as const,
          function: { name: 'propose_intent', arguments: '{"goal":{"kind":"forage"}}' },
        },
      ],
      [
        { id: 'mixed-read', type: 'function' as const, function: { name: 'inventory', arguments: '{}' } },
        {
          id: 'mixed-intent',
          type: 'function' as const,
          function: { name: 'propose_intent', arguments: '{"goal":{"kind":"idle"}}' },
        },
      ],
      [
        {
          id: 'bad-target',
          type: 'function' as const,
          function: {
            name: 'propose_intent',
            arguments: '{"goal":{"kind":"follow","target":{"kind":"entity","ref":"hidden","revision":1}}}',
          },
        },
      ],
    ];
    for (const toolCalls of responses) {
      const model: CognitionModel = {
        complete: async () => ({
          message: { role: 'assistant', content: null, tool_calls: toolCalls },
          finishReason: 'tool_calls',
          usage: null,
          latencyMs: 1,
        }),
      };
      const result = await decideWithGraph(createCognitionGraph({ model }), observation(), []);
      expect(result.status).toBe('invalid-tool');
      expect(result.proposal).toBeUndefined();
      for (const call of toolCalls)
        expect(result.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: call.id }));
    }
  });

  it('rejects an over-budget read batch before another provider call and closes all IDs', async () => {
    const calls = Array.from({ length: 5 }, (_, index) => ({
      id: `read-${index}`,
      type: 'function' as const,
      function: { name: 'inventory', arguments: '{}' },
    }));
    let modelCalls = 0;
    const model: CognitionModel = {
      complete: async () => {
        modelCalls += 1;
        return {
          message: { role: 'assistant', content: null, tool_calls: calls },
          finishReason: 'tool_calls',
          usage: null,
          latencyMs: 1,
        };
      },
    };
    const result = await decideWithGraph(createCognitionGraph({ model }), observation(), []);
    expect(result.status).toBe('over-budget');
    expect(modelCalls).toBe(1);
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(5);
  });

  it('rejects a follow intent whose target is a visible point of interest', async () => {
    const poiObservation = observation({
      visiblePois: [
        { target: { kind: 'poi', ref: 'camp', revision: 2 }, type: 'camp', position: [4, 2, 3], distance: 3 },
      ],
    });
    const available = validateToolCall(
      {
        id: 'poi-actions',
        type: 'function',
        function: { name: 'available_actions', arguments: '{"ref":"camp"}' },
      },
      poiObservation,
    );
    expect(available.kind).toBe('read');
    if (available.kind === 'read')
      expect(JSON.parse(available.result)).toEqual({
        goals: ['idle', 'forage', 'return-home', 'move-to'],
      });
    const model: CognitionModel = {
      complete: async () => ({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'poi-follow',
              type: 'function',
              function: {
                name: 'propose_intent',
                arguments: '{"goal":{"kind":"follow","target":{"kind":"poi","ref":"camp","revision":2}}}',
              },
            },
          ],
        },
        finishReason: 'tool_calls',
        usage: null,
        latencyMs: 1,
      }),
    };
    const result = await decideWithGraph(createCognitionGraph({ model }), poiObservation, []);
    expect(result.status).toBe('invalid-tool');
    expect(result.proposal).toBeUndefined();
    expect(result.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'poi-follow' }));
  });
});
