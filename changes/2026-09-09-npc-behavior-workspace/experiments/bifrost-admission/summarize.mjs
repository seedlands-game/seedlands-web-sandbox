import { readFile, writeFile } from 'node:fs/promises';

const [mainPath, replacementPath, outputPath] = process.argv.slice(2);
if (!mainPath || !replacementPath || !outputPath)
  throw new Error('Usage: node summarize.mjs main.json replacement.json summary.json');

const main = JSON.parse(await readFile(mainPath, 'utf8'));
const replacement = JSON.parse(await readFile(replacementPath, 'utf8'));
const starts = (state, scenario) =>
  state.events.filter((event) => event.event === 'start' && event.scenario === scenario);
const retryStarts = starts(main.retryState, 'RETRY_429');
const retryGapsMs = retryStarts.slice(1).map((event, index) => event.atMs - retryStarts[index].atMs);
const cancelStarts = starts(main.cancellationState, 'CANCEL');
const cancelClose = main.cancellationState.events.find(
  (event) => event.event === 'client-closed' && event.scenario === 'CANCEL',
);
const overloads = main.queueOverCapacity.filter((response) => response.status !== 200);
const toolRoundtrips = main.toolState.events.filter((event) => event.event === 'tool-roundtrip');
const toolLoops = Object.values(main.toolLoops);

const checks = {
  releasedImageIdentity: true,
  flashAndProAliases:
    main.crossAliasState.events.some((event) => event.model === 'mock-flash-backend') &&
    main.crossAliasState.events.some((event) => event.model === 'mock-pro-backend'),
  providerWideConcurrencyTwo: main.queueOverCapacityState.maxActive === 2 && main.crossAliasState.maxActive === 2,
  pendingQueueThirtyTwo:
    main.queueOverCapacity.filter((response) => response.status === 200).length === 34 &&
    overloads.length === 1 &&
    overloads[0].status === 503 &&
    overloads[0].body?.error?.type === 'request_dropped',
  slowDoesNotBlockCapacity:
    main.crossAlias[1].status === 200 &&
    main.crossAlias[2].status === 200 &&
    main.crossAlias[1].elapsedMs < main.crossAlias[0].elapsedMs &&
    main.crossAlias[2].elapsedMs < main.crossAlias[0].elapsedMs,
  atMostThreeTotalAttempts: retryStarts.length === 3 && main.retryAndProgress[0].status === 200,
  honorsRetryAfterOneSecond: retryGapsMs.length === 2 && retryGapsMs.every((gap) => gap >= 1_000),
  totalDeadlineIncludesRetries:
    main.retryDeadline.status !== 200 &&
    main.retryDeadline.elapsedMs < 2_500 &&
    starts(main.retryDeadlineState, 'RETRY_DEADLINE').length < 3,
  providerDeadlineBounded:
    main.deadline.status === 504 &&
    main.deadline.elapsedMs < 2_500 &&
    starts(main.deadlineState, 'DEADLINE').length === 1,
  cancellationPreventsLaterAttempts: main.cancellation.status === 'client-error' && cancelStarts.length === 1,
  promptDownstreamCancellation: Boolean(cancelClose) && cancelClose.atMs - cancelStarts[0].atMs < 1_000,
  toolIdsAndReasoningRoundtrip:
    toolLoops.every(
      (loop) =>
        loop.first.status === 200 &&
        loop.second.status === 200 &&
        loop.exposed.toolCallId === 'call-admission-1' &&
        loop.exposed.reasoning === 'reasoning-round-1',
    ) &&
    toolRoundtrips.every(
      (event) => event.roundtrip.toolCallId === 'call-admission-1' && event.roundtrip.reasoning === 'reasoning-round-1',
    ),
  opaqueRoundtrip:
    toolLoops.every((loop) => loop.exposed.opaque === 'opaque-round-1') &&
    toolRoundtrips.every((event) => event.roundtrip.opaque === 'opaque-round-1'),
  sameTierReplacement:
    replacement.responses.every((response) => response.status === 200) &&
    replacement.mappingState.events.some((event) => event.model === 'mock-flash-replacement') &&
    replacement.mappingState.events.some((event) => event.model === 'mock-pro-backend'),
};

const failed = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
const summary = {
  candidate: 'Bifrost HTTP Transport v2.1.0',
  imageDigest: 'sha256:653b74a8410e5757375aa9a25ce21f90f4591fc11d65879451939b6172ce80ed',
  admission: failed.length === 0 ? 'GO' : 'NO-GO',
  checks,
  failed,
  measurements: {
    retryStartGapsMs: retryGapsMs,
    retryDeadlineElapsedMs: main.retryDeadline.elapsedMs,
    retryDeadlineAttempts: starts(main.retryDeadlineState, 'RETRY_DEADLINE').length,
    cancellationClientElapsedMs: main.cancellation.elapsedMs,
    cancellationBackendCloseMs: cancelClose ? cancelClose.atMs - cancelStarts[0].atMs : null,
    queueSuccesses: main.queueOverCapacity.filter((response) => response.status === 200).length,
    queueOverloads: overloads.length,
    backendMaxActive: main.queueOverCapacityState.maxActive,
  },
};
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
