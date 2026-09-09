import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEEPSEEK_BASE_URL, resolveDeepSeekEndpoint } from '../../apps/agent-server/src/config';
import {
  DeepSeekChatCompletionsTransport,
  DeepSeekTransportError,
} from '../../apps/agent-server/src/deepseek-transport';

describe('DeepSeekChatCompletionsTransport', () => {
  it('preserves provider reasoning in outbound history and parsed responses', async () => {
    const packets: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      packets.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                reasoning_content: 'private-next',
                tool_calls: [
                  {
                    id: 'call-2',
                    type: 'function',
                    function: { name: 'propose_intent', arguments: '{"goal":{"kind":"forage"}}' },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 21,
            prompt_cache_hit_tokens: 8,
            completion_tokens: 7,
            total_tokens: 28,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const transport = new DeepSeekChatCompletionsTransport({
      endpoint: { apiKey: 'test-only-secret', baseUrl: 'https://api.deepseek.com', keySource: 'DEEPSEEK_API_KEY' },
      fetch: fetch as typeof globalThis.fetch,
      now: (() => {
        let now = 100;
        return () => (now += 5);
      })(),
    });
    const priorAssistant = {
      role: 'assistant' as const,
      content: null,
      reasoning_content: 'private-prior',
      tool_calls: [{ id: 'call-1', type: 'function' as const, function: { name: 'inventory', arguments: '{}' } }],
    };
    const completion = await transport.complete({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [
        { role: 'user', content: 'decide' },
        priorAssistant,
        { role: 'tool', tool_call_id: 'call-1', content: '{"inventory":[]}' },
      ],
      maxTokens: 512,
    });

    expect((packets[0]?.messages as unknown[])[1]).toEqual(priorAssistant);
    expect(completion.message.reasoning_content).toBe('private-next');
    expect(completion.usage).toMatchObject({ inputTokens: 21, cacheHitTokens: 8, outputTokens: 7 });
  });

  it('never includes a credential or response body in transport errors', async () => {
    const secret = 'super-secret-test-value';
    const transport = new DeepSeekChatCompletionsTransport({
      endpoint: { apiKey: secret, baseUrl: DEFAULT_DEEPSEEK_BASE_URL, keySource: 'DEEPSEEK_API_KEY' },
      fetch: vi.fn(async () => new Response(`provider echoed ${secret}`, { status: 500 })) as typeof globalThis.fetch,
    });
    await expect(
      transport.complete({ model: 'model', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }),
    ).rejects.toMatchObject({ kind: 'http', message: 'DeepSeek request failed with status 500' });
  });

  it('requires a matching base URL when reusing the approved MIDSCENE key', () => {
    expect(() => resolveDeepSeekEndpoint({ MIDSCENE_MODEL_API_KEY: 'test-secret' })).toThrow(
      'MIDSCENE_MODEL_BASE_URL is required',
    );
    expect(
      resolveDeepSeekEndpoint({
        MIDSCENE_MODEL_API_KEY: 'test-secret',
        MIDSCENE_MODEL_BASE_URL: 'https://api.deepseek.com/',
      }),
    ).toMatchObject({ baseUrl: 'https://api.deepseek.com', keySource: 'MIDSCENE_MODEL_API_KEY' });
  });

  it('classifies timeouts without leaking AbortSignal reasons', async () => {
    const transport = new DeepSeekChatCompletionsTransport({
      endpoint: { apiKey: 'test-key', baseUrl: DEFAULT_DEEPSEEK_BASE_URL, keySource: 'DEEPSEEK_API_KEY' },
      requestTimeoutMs: 1,
      fetch: vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('private abort detail')), { once: true });
          }),
      ) as typeof globalThis.fetch,
    });
    const error = await transport
      .complete({ model: 'model', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeepSeekTransportError);
    expect(error).toMatchObject({ kind: 'timeout', message: 'DeepSeek request timed out' });
  });
});
