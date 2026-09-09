import { createServer } from 'node:http';
import { appendFile, writeFile } from 'node:fs/promises';

const port = Number(process.env.MOCK_PROVIDER_PORT);
const logFile = process.env.MOCK_PROVIDER_LOG;
if (!Number.isSafeInteger(port) || port < 1 || !logFile) throw new Error('MOCK_PROVIDER_PORT and LOG are required.');

let active = 0;
let maxActive = 0;
let sequence = 0;
const attempts = new Map();
const events = [];
const record = async (event) => {
  const entry = { seq: ++sequence, atMs: Date.now(), ...event };
  events.push(entry);
  await appendFile(logFile, `${JSON.stringify(entry)}\n`);
};
await writeFile(logFile, '');

const json = (response, status, value, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(value));
};
const completion = (model, message, finishReason = 'stop') => ({
  id: `mock-${sequence}`,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, message, finish_reason: finishReason, logprobs: null }],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 3 } },
});
const sleep = (ms, response) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    response.once('close', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/state') return json(response, 200, { active, maxActive, events });
  if (request.method === 'POST' && request.url === '/reset') {
    active = 0;
    maxActive = 0;
    sequence = 0;
    attempts.clear();
    events.length = 0;
    await writeFile(logFile, '');
    return json(response, 200, { ok: true });
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions')
    return json(response, 404, { error: { message: 'not found', type: 'invalid_request_error' } });

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return json(response, 400, { error: { message: 'invalid json', type: 'invalid_request_error' } });
  }
  const userText = body.messages?.findLast?.((message) => message.role === 'user')?.content ?? '';
  const match = /CASE:([A-Z0-9_-]+)/.exec(String(userText));
  const scenario = match?.[1] ?? 'TEXT';
  const key = `${scenario}:${body.model}`;
  const attempt = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, attempt);
  active += 1;
  maxActive = Math.max(maxActive, active);
  await record({ event: 'start', scenario, attempt, model: body.model, active });
  let finished = false;
  response.once('close', () => {
    if (!finished) void record({ event: 'client-closed', scenario, attempt, model: body.model });
  });
  const finish = async (status) => {
    if (finished) return;
    finished = true;
    active -= 1;
    await record({ event: 'end', scenario, attempt, model: body.model, active, status });
  };

  if (scenario === 'RETRY_429' && attempt < 3) {
    await finish(429);
    return json(
      response,
      429,
      { error: { message: 'controlled retry', type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
      { 'retry-after': '1' },
    );
  }

  const delay =
    scenario === 'SLOW_A' || scenario === 'SLOW_B'
      ? 1200
      : scenario === 'DEADLINE'
        ? 5000
        : scenario === 'CANCEL'
          ? 5000
          : 120;
  if (!(await sleep(delay, response))) {
    await finish('cancelled');
    return;
  }

  if (scenario === 'TOOL') {
    const assistant = body.messages?.findLast?.((message) => message.role === 'assistant' && message.tool_calls);
    const tool = body.messages?.findLast?.((message) => message.role === 'tool');
    if (!tool) {
      await finish(200);
      return json(
        response,
        200,
        completion(
          body.model,
          {
            role: 'assistant',
            content: null,
            reasoning_content: 'reasoning-round-1',
            provider_specific_fields: { admission_state: 'opaque-round-1' },
            tool_calls: [
              {
                id: 'call-admission-1',
                type: 'function',
                function: { name: 'lookup_food', arguments: '{"kind":"berry"}' },
              },
            ],
          },
          'tool_calls',
        ),
      );
    }
    const roundtrip = {
      toolCallId: tool.tool_call_id,
      reasoning: assistant?.reasoning_content ?? null,
      opaque: assistant?.provider_specific_fields?.admission_state ?? null,
    };
    await record({ event: 'tool-roundtrip', scenario, attempt, model: body.model, roundtrip });
    await finish(200);
    return json(
      response,
      200,
      completion(body.model, {
        role: 'assistant',
        content: `tool-loop-complete:${JSON.stringify(roundtrip)}`,
        reasoning_content: 'reasoning-round-2',
        provider_specific_fields: { admission_state: 'opaque-round-2' },
      }),
    );
  }

  await finish(200);
  return json(response, 200, completion(body.model, { role: 'assistant', content: `${scenario}:complete` }));
});

server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ ready: true, port })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
