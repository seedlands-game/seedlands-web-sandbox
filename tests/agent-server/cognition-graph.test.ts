import { describe, expect, it } from 'vitest';
import { createCognitionGraph, decideWithGraph } from '../../apps/agent-server/src/cognition-graph';
import type { CognitionModel, ModelRequest } from '../../apps/agent-server/src/model-types';
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
            tool_calls: [
              first
                ? { id: 'read-1', type: 'function', function: { name: 'inventory', arguments: '{}' } }
                : {
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
    expect(requests[1]?.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'read-1' }));
  });

  it('rejects multiple calls and invisible target references without an intent', async () => {
    const responses = [
      [
        { id: 'one', type: 'function' as const, function: { name: 'inventory', arguments: '{}' } },
        { id: 'two', type: 'function' as const, function: { name: 'inventory', arguments: '{}' } },
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
    }
  });
});
