import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// Explicit operator-run probe: inherited credentials only; never read dotenv or log provider-private history.
const root = resolve(import.meta.dirname, '../../..');
const reportPath = process.env.SEEDLANDS_LIVE_REPORT ?? '/tmp/seedlands-living-npc/live-model-smoke.json';
const runner = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});
const report = { kind: 'real-provider-world-contract', calls: [], rounds: [], compression: null };
let session;
try {
  const { HeadlessSession } = await runner.ssrLoadModule('/packages/game-core/src/server/headless/headless-session.ts');
  const { nodeCorePlatform } = await runner.ssrLoadModule('/scripts/headless/node-core-platform.ts');
  const { resolveDeepSeekEndpoint } = await runner.ssrLoadModule('/apps/agent-server/src/config.ts');
  const { DeepSeekChatCompletionsTransport } = await runner.ssrLoadModule(
    '/apps/agent-server/src/deepseek-transport.ts',
  );
  const { createCognitionGraph, decideWithGraph } = await runner.ssrLoadModule(
    '/apps/agent-server/src/cognition-graph.ts',
  );
  const { ContextSession } = await runner.ssrLoadModule('/apps/agent-server/src/context-session.ts');
  const endpoint = resolveDeepSeekEndpoint(process.env);
  if (!endpoint) throw new Error('Authorized inherited model credentials are unavailable');
  const transport = new DeepSeekChatCompletionsTransport({ endpoint, requestTimeoutMs: 60_000 });
  const model = {
    complete: async (request) => {
      if (report.calls.length >= 7) throw new Error('Live smoke bounded call allowance exhausted');
      const completion = await transport.complete(request);
      report.calls.push({
        model: request.model,
        latencyMs: completion.latencyMs,
        usage: completion.usage,
        finishReason: completion.finishReason,
        toolNames: completion.message.tool_calls?.map((call) => call.function.name),
        reasoningPresent: Boolean(completion.message.reasoning_content),
      });
      return completion;
    },
  };
  session = await HeadlessSession.create({ platform: nodeCorePlatform, seedText: 'living-npc-real-provider' });
  await session.world.clock({ kind: 'pause' });
  const created = await session.world.character({
    kind: 'create',
    profile: {
      name: '阿岚',
      personality: '谨慎好奇，友善但有自己的目标，珍惜食物，遇险先保护自己。说简短自然的中文。',
      riskTolerance: 0.25,
    },
  });
  if (!created.ok || created.data.kind !== 'created') throw new Error('Authority character creation failed');
  const entityId = created.data.character.entityId;
  let history = [];
  const graph = createCognitionGraph({ model, maxModelSteps: 2 });
  for (const [index, dialogue] of [
    '阿岚，你好。我想认识你。你愿意先在附近找些吃的吗？',
    '我就在你身边。先放下找食物的事，跟着我走一会儿吧。你为什么愿意跟我来？',
  ].entries()) {
    const spoken = await session.world.character({ kind: 'dialogue', entityId, text: dialogue });
    if (!spoken.ok) throw new Error('Authority rejected nearby dialogue');
    const observed = await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
    if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Authority observation failed');
    const observation = observed.data.observation;
    const result = await decideWithGraph(graph, observation, history);
    if (result.status !== 'intent' || !result.proposal) throw new Error(`Model decision failed: ${result.status}`);
    const receipt = await session.world.character({
      kind: 'intent',
      entityId,
      requestId: `live-round-${index}`,
      expectedRevision: observation.character.revision,
      ...result.proposal,
    });
    const call = result.messages.at(-1)?.tool_calls?.[0];
    if (!call) throw new Error('Missing provider tool identity');
    history = [...result.messages, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(receipt) }];
    report.rounds.push({ input: dialogue, observation, proposal: result.proposal, receipt });
    if (!receipt.ok) throw new Error('Authority rejected model proposal');
    await session.world.clock({ kind: 'advance', elapsedMs: 1000 });
  }
  const observed = await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
  if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Final observation failed');
  // Force only the mechanism for this bounded probe. This is not a 128K/256K quality or timing benchmark.
  const context = new ContextSession(history, { softThreshold: 1 });
  context.appendEvents(observed.data.observation.events);
  const before = context.generation;
  const rotation = await context.rotate(model, observed.data.observation.character.memory);
  if (rotation.kind !== 'pro' || !rotation.memory) throw new Error('Real Pro did not produce a memory proposal');
  const receipt = await session.world.character({ kind: 'memory', entityId, ...rotation.memory });
  if (!receipt.ok) throw new Error('Authority rejected Pro memory');
  if (context.generation !== before) throw new Error('Context switched before Authority acknowledgement');
  context.commitPreparedRotation();
  report.compression = {
    source: 'complete actual Flash tool history plus Authority public events; forced mechanism threshold',
    kind: rotation.kind,
    memory: rotation.memory,
    receipt,
    generationBefore: before,
    generationAfter: context.generation,
  };
  const checkpoint = await session.world.checkpoint({ kind: 'export' });
  if (!checkpoint.ok || !checkpoint.data.snapshot) throw new Error('Checkpoint failed');
  report.checkpoint = { saved: true, characterId: entityId };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : 'unknown failure';
  process.exitCode = 1;
} finally {
  session?.dispose();
  await runner.close();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ status: report.status, calls: report.calls, error: report.error, reportPath })}\n`,
  );
}
