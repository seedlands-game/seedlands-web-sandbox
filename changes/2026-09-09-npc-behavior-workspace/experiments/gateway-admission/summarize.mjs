import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [inputDir, output] = process.argv.slice(2);
if (!inputDir || !output) throw new Error('Usage: node summarize.mjs INPUT_DIR OUTPUT.json');
const read = async (name) => JSON.parse(await readFile(join(inputDir, name), 'utf8'));
const [router, globalRun, replacement, cancellationLate] = await Promise.all([
  read('router.json'),
  read('global.json'),
  read('replacement.json'),
  read('cancellation-late.json'),
]);
const starts = (state, scenario) =>
  state.events.filter((event) => event.event === 'start' && (!scenario || event.scenario === scenario));
const retryStarts = starts(router.retryState, 'RETRY_429');
const retryAfterHonored = retryStarts
  .slice(1)
  .every(
    (event, index) =>
      event.atMs -
        router.retryState.events.find(
          (candidate) =>
            candidate.event === 'end' &&
            candidate.scenario === 'RETRY_429' &&
            candidate.attempt === retryStarts[index].attempt,
        ).atMs >=
      1_000,
  );
const toolPass = (loop) =>
  loop.first.status === 200 &&
  loop.second.status === 200 &&
  loop.exposed.toolCallId === 'call-admission-1' &&
  loop.exposed.reasoning === 'reasoning-round-1' &&
  loop.exposed.opaque === 'opaque-round-1';
const cancellationStarts = starts(cancellationLate, 'CANCEL');
const queueStatuses = globalRun.queueOverCapacity.map(({ status }) => status);

const checks = {
  fullToolLoopAndOpaqueRoundtrip: toolPass(router.toolLoops.flash) && toolPass(router.toolLoops.pro),
  aliasesReachCorrectBackends:
    router.toolState.events.some((event) => event.model === 'mock-flash-backend') &&
    router.toolState.events.some((event) => event.model === 'mock-pro-backend'),
  sameTierReplacement:
    replacement.mappingState.events.some((event) => event.model === 'mock-flash-replacement') &&
    replacement.mappingState.events.some((event) => event.model === 'mock-pro-backend'),
  sameDeploymentConcurrencyTwo: router.sameDeploymentState.maxActive === 2,
  slowADoesNotBlockBC:
    router.sameDeployment[1].elapsedMs < router.sameDeployment[0].elapsedMs &&
    router.sameDeployment[2].elapsedMs < router.sameDeployment[0].elapsedMs,
  retryAfterAndThreeTotalAttempts: retryStarts.length === 3 && retryAfterHonored,
  totalCrossAliasConcurrencyTwo: globalRun.crossAliasState.maxActive <= 2,
  boundedQueue32Backpressure:
    queueStatuses.length === 35 && queueStatuses.filter((status) => status !== 200).length >= 3,
  totalDeadline: router.deadline.elapsedMs <= 2_500 && starts(router.deadlineState, 'DEADLINE').length <= 1,
  downstreamCancellation:
    router.cancellation.status === 'client-error' &&
    router.cancellation.elapsedMs < 1_000 &&
    cancellationStarts.length === 1 &&
    cancellationLate.events.at(-1).atMs - cancellationStarts[0].atMs < 1_000,
};
const summary = {
  schemaVersion: 1,
  candidate: 'LiteLLM Proxy 1.100.0',
  admitted: Object.values(checks).every(Boolean),
  checks,
  observations: {
    crossAliasBackendMaxActive: globalRun.crossAliasState.maxActive,
    queuedRequestsAccepted: queueStatuses.filter((status) => status === 200).length,
    queuedRequestsTotal: queueStatuses.length,
    deadlineElapsedMs: router.deadline.elapsedMs,
    deadlineProviderAttempts: starts(router.deadlineState, 'DEADLINE').length,
    cancelledClientElapsedMs: router.cancellation.elapsedMs,
    cancellationProviderAttempts: cancellationStarts.length,
  },
};
await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output, admitted: summary.admitted }));
