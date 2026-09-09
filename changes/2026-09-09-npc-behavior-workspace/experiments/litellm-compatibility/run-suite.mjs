import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.GATEWAY_BASE_URL;
const providerUrl = process.env.MOCK_PROVIDER_URL;
const phase = process.argv[2];
const output = process.argv[3];
if (!baseUrl || !providerUrl || !['router', 'global', 'replacement'].includes(phase) || !output)
  throw new Error(
    'Usage: GATEWAY_BASE_URL=... MOCK_PROVIDER_URL=... node run-suite.mjs router|global|replacement output.json',
  );

const startedAt = Date.now();
const request = async (model, scenario, { messages, signal } = {}) => {
  const start = Date.now();
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer sk-local-admission-only', 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        messages: messages ?? [{ role: 'user', content: `CASE:${scenario}` }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup_food',
              description: 'Return a controlled food observation.',
              parameters: {
                type: 'object',
                properties: { kind: { type: 'string' } },
                required: ['kind'],
                additionalProperties: false,
              },
            },
          },
        ],
      }),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { status: response.status, elapsedMs: Date.now() - start, body };
  } catch (error) {
    return {
      status: 'client-error',
      elapsedMs: Date.now() - start,
      error: error instanceof Error ? error.name : 'Error',
    };
  }
};
const reset = () => fetch(`${providerUrl}/reset`, { method: 'POST' });
const state = async () => (await fetch(`${providerUrl}/state`)).json();
const toolLoop = async (model) => {
  const first = await request(model, 'TOOL');
  const assistant = first.body?.choices?.[0]?.message;
  const second = await request(model, 'TOOL', {
    messages: [
      { role: 'user', content: 'CASE:TOOL' },
      assistant,
      { role: 'tool', tool_call_id: assistant?.tool_calls?.[0]?.id, content: '{"found":true}' },
    ],
  });
  return {
    first,
    second,
    exposed: {
      toolCallId: assistant?.tool_calls?.[0]?.id ?? null,
      reasoning: assistant?.reasoning_content ?? null,
      opaque: assistant?.provider_specific_fields?.admission_state ?? null,
      secondReasoning: second.body?.choices?.[0]?.message?.reasoning_content ?? null,
      secondOpaque: second.body?.choices?.[0]?.message?.provider_specific_fields?.admission_state ?? null,
    },
  };
};

const result = { phase, startedAt, gatewayBaseUrl: baseUrl };
if (phase === 'router') {
  await reset();
  result.toolLoops = { flash: await toolLoop('flash'), pro: await toolLoop('pro') };
  result.toolState = await state();

  await reset();
  result.sameDeployment = await Promise.all([
    request('flash', 'SLOW_A'),
    request('flash', 'FAST_B'),
    request('flash', 'FAST_C'),
  ]);
  result.sameDeploymentState = await state();

  await reset();
  const retrying = request('flash', 'RETRY_429');
  for (
    let index = 0;
    index < 100 && !(await state()).events.some((event) => event.scenario === 'RETRY_429' && event.status === 429);
    index += 1
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  result.retryAndProgress = await Promise.all([retrying, request('flash', 'FAST_B'), request('flash', 'FAST_C')]);
  result.retryState = await state();

  await reset();
  result.deadline = await request('flash', 'DEADLINE');
  await new Promise((resolve) => setTimeout(resolve, 100));
  result.deadlineState = await state();

  await reset();
  const controller = new AbortController();
  const cancellation = request('flash', 'CANCEL', { signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  result.cancellation = await cancellation;
  await new Promise((resolve) => setTimeout(resolve, 200));
  result.cancellationState = await state();
} else if (phase === 'global') {
  await reset();
  const first = request('flash', 'SLOW_A');
  const second = request('pro', 'SLOW_B');
  for (let index = 0; index < 100 && (await state()).active < 2; index += 1)
    await new Promise((resolve) => setTimeout(resolve, 20));
  const third = request('flash', 'FAST_C');
  result.crossAlias = await Promise.all([first, second, third]);
  result.crossAliasState = await state();

  await reset();
  result.queueOverCapacity = await Promise.all(
    Array.from({ length: 35 }, (_, index) => request('flash', `QUEUE_${index}`)),
  );
  result.queueOverCapacityState = await state();
} else {
  await reset();
  result.responses = await Promise.all([request('flash', 'TEXT'), request('pro', 'TEXT')]);
  result.mappingState = await state();
}
result.elapsedMs = Date.now() - startedAt;
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ phase, output, elapsedMs: result.elapsedMs }));
