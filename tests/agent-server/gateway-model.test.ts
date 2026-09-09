import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGatewayChatModel, createStandardGatewayChatModel } from '../../apps/agent-server/src/gateway-model';
import { HumanMessage } from '../../apps/agent-server/src/resident-agent';

const responseBody = {
  id: 'gateway-message-1',
  object: 'chat.completion',
  created: 1,
  model: 'qualified-flash-backend',
  provider_trace: { route: 'opaque-top-level' },
  choices: [
    {
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        reasoning_content: 'opaque reasoning',
        provider_message_id: 'opaque-message-field',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'observe_self', arguments: '{}' } }],
      },
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
};

async function mockGateway(): Promise<Readonly<{ server: Server; baseUrl: string }>> {
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) void _chunk;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(responseBody));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock gateway did not bind');
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

describe('gateway BaseChatModel', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('records the concrete standard ChatOpenAI opaque loss that requires the thin adapter', async () => {
    const gateway = await mockGateway();
    servers.push(gateway.server);
    const standard = createStandardGatewayChatModel({ tier: 'flash', apiKey: 'fake-local', baseUrl: gateway.baseUrl });
    const message = await standard.invoke([new HumanMessage('observe')]);
    expect(message.additional_kwargs).toMatchObject({ reasoning_content: 'opaque reasoning' });
    expect(message.tool_calls?.[0]).toMatchObject({ id: 'call-1', name: 'observe_self', args: {} });
    expect(message.additional_kwargs.provider_message_id).toBeUndefined();
    expect(message.additional_kwargs.gateway_raw_response).toBeUndefined();
  });

  it('preserves full response/message extensions, tool calls, and logical tier with no retry owner', async () => {
    const requests: unknown[] = [];
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as unknown);
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const model = createGatewayChatModel({
      tier: 'flash',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-local',
      fetch: fakeFetch,
    });
    const message = await model.invoke([new HumanMessage('observe')]);
    await model.invoke([new HumanMessage('continue'), message]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(expect.objectContaining({ model: 'flash' }));
    expect(JSON.stringify(requests[1])).not.toContain('gateway_raw_message');
    expect(JSON.stringify(requests[1])).not.toContain('gateway_raw_response');
    expect(message.additional_kwargs).toMatchObject({
      reasoning_content: 'opaque reasoning',
      provider_message_id: 'opaque-message-field',
      gateway_raw_response: { provider_trace: { route: 'opaque-top-level' } },
    });
    expect(message.tool_calls?.[0]).toMatchObject({ id: 'call-1', name: 'observe_self', args: {} });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('preserves bound tool choice and lets explicit invocation options override it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const model = createGatewayChatModel({
      tier: 'pro',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-local',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }] }));
      },
    }).bindTools(
      [{ type: 'function', function: { name: 'publish', parameters: { type: 'object', properties: {} } } }],
      { tool_choice: 'required' } as never,
    );
    await model.invoke([new HumanMessage('publish')]);
    await model.invoke([new HumanMessage('optional')], { tool_choice: 'auto' } as never);
    expect(bodies.map((entry) => entry.tool_choice)).toEqual(['required', 'auto']);
  });

  it('preserves malformed tool arguments as invalid tool calls', async () => {
    const model = createGatewayChatModel({
      tier: 'flash',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-local',
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: 'bad-tool-message',
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    { id: 'bad-call', type: 'function', function: { name: 'observe_self', arguments: '{bad' } },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });
    const message = await model.invoke([new HumanMessage('observe')]);
    expect(message.tool_calls).toEqual([]);
    expect(message.invalid_tool_calls).toEqual([
      expect.objectContaining({ id: 'bad-call', name: 'observe_self', args: '{bad', type: 'invalid_tool_call' }),
    ]);
  });

  it('enforces the configured timeout on the single fetch attempt', async () => {
    let attempts = 0;
    const model = createGatewayChatModel({
      tier: 'pro',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-local',
      timeoutMs: 10,
      fetch: async (_input, init) => {
        attempts += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      },
    });
    await expect(model.invoke([new HumanMessage('compact')])).rejects.toThrow('timed out');
    expect(attempts).toBe(1);
  });

  it('passes cancellation to the single fetch attempt', async () => {
    let seenSignal: AbortSignal | null | undefined;
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      seenSignal = init?.signal;
      throw new DOMException('aborted', 'AbortError');
    });
    const controller = new AbortController();
    controller.abort();
    const model = createGatewayChatModel({
      tier: 'pro',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'fake-local',
      fetch: fakeFetch,
    });
    await expect(model.invoke([new HumanMessage('compact')], { signal: controller.signal })).rejects.toThrow();
    expect(seenSignal).toBe(controller.signal);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});
