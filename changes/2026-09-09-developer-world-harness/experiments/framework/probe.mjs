import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { ChatDeepSeek } from '@langchain/deepseek';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Agent, Runner, tool, setTracingDisabled } from '@openai/agents';
import { OpenAIChatCompletionsModel } from '@openai/agents-openai';
import OpenAI from 'openai';
import { z } from 'zod';
import { StateGraph, Annotation, START, END, MemorySaver, interrupt, Command } from '@langchain/langgraph';
setTracingDisabled(true);
const definition = {
  type: 'function',
  function: {
    name: 'act',
    description: 'Submit one action',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
};
function mock() {
  const packets = [];
  return {
    packets,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      packets.push(body);
      const first = packets.length === 1;
      return new Response(
        JSON.stringify({
          id: 'mock-' + packets.length,
          object: 'chat.completion',
          created: 0,
          model: 'deepseek-v4-flash',
          choices: [
            {
              index: 0,
              finish_reason: first ? 'tool_calls' : 'stop',
              message: first
                ? {
                    role: 'assistant',
                    content: null,
                    reasoning_content: 'private-wire-1',
                    tool_calls: [{ id: 'call1', type: 'function', function: { name: 'act', arguments: '{}' } }],
                  }
                : { role: 'assistant', content: 'Waiting for authority.', reasoning_content: 'private-wire-2' },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  };
}
const lcMock = mock();
const lc = new ChatDeepSeek({
  apiKey: 'mock-only',
  model: 'deepseek-v4-flash',
  maxRetries: 0,
  configuration: { fetch: lcMock.fetch },
  modelKwargs: { thinking: { type: 'enabled' }, reasoning_effort: 'low' },
}).bindTools([definition]);
const user = new HumanMessage('Move to target.');
const answer = await lc.invoke([user]);
await lc.invoke([
  user,
  answer,
  new ToolMessage({ content: '{"status":"accepted","actionId":"a1"}', tool_call_id: 'call1' }),
]);
const oaMock = mock();
const model = new OpenAIChatCompletionsModel(
  new OpenAI({ apiKey: 'mock-only', fetch: oaMock.fetch, maxRetries: 0 }),
  'deepseek-v4-flash',
);
const agent = new Agent({
  name: 'Probe',
  instructions: 'Use act once then wait.',
  model,
  tools: [
    tool({
      name: 'act',
      description: 'Submit',
      parameters: z.object({}),
      execute: () => JSON.stringify({ status: 'accepted', actionId: 'a1' }),
    }),
  ],
});
await new Runner({ tracingDisabled: true }).run(agent, 'Move to target.', { maxTurns: 3 });
const State = Annotation.Root({ actionId: Annotation(), receipt: Annotation(), goal: Annotation() });
let submits = 0;
const graph = new StateGraph(State)
  .addNode('submit', () => ({ actionId: 'a' + ++submits }))
  .addNode('wait', (state) => {
    const receipt = interrupt({ actionId: state.actionId });
    return { receipt };
  })
  .addEdge(START, 'submit')
  .addEdge('submit', 'wait')
  .addEdge('wait', END)
  .compile({ checkpointer: new MemorySaver() });
const config = { configurable: { thread_id: 'actor-1' }, recursionLimit: 8 };
const paused = await graph.invoke({ goal: 'food' }, config);
assert.equal(submits, 1);
assert.ok(paused.__interrupt__);
const completed = await graph.invoke(
  new Command({ resume: { actionId: 'a1', status: 'completed', commitSequence: 7 } }),
  config,
);
assert.equal(submits, 1);
assert.equal(completed.receipt.status, 'completed');
const report = {
  versions: { langgraph: '1.4.14', deepseek: '1.1.11', agents: '0.17.2' },
  langchain: {
    inboundReasoningPreserved: answer.additional_kwargs.reasoning_content === 'private-wire-1',
    outboundReasoningPreserved:
      lcMock.packets[1].messages.find((x) => x.role === 'assistant')?.reasoning_content === 'private-wire-1',
    requestCount: lcMock.packets.length,
  },
  openaiAgents: {
    outboundReasoningPreserved:
      oaMock.packets[1].messages.find((x) => x.role === 'assistant')?.reasoning_content === 'private-wire-1',
    requestCount: oaMock.packets.length,
  },
  langgraph: {
    pausedBeforeCompletion: Boolean(paused.__interrupt__),
    submitCountAfterResume: submits,
    terminalReceipt: completed.receipt,
  },
  boundary: 'Mock transport and graph only. No real DeepSeek call; no latency/cost/quality claim.',
};
await writeFile(new URL('./result.json', import.meta.url), JSON.stringify(report, null, 2));
await writeFile(
  new URL('./packets.json', import.meta.url),
  JSON.stringify({ langchain: lcMock.packets, openaiAgents: oaMock.packets }, null, 2),
);
console.log(JSON.stringify(report, null, 2));
