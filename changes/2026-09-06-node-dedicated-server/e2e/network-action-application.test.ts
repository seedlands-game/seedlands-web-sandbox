import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DedicatedComputeExecutor } from '../../../packages/game-core/src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../packages/game-core/src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../packages/game-core/src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../../packages/game-core/src/server/persistence/memory-game-persistence';
import { projectActionReceiptReference } from '../../../packages/game-core/src/server/protocol/network-action-reference';
import {
  projectActionRequestReference,
  type ActionRequestReference,
} from '../../../packages/game-core/src/server/protocol/network-action-request-reference';
import {
  projectGameplayViewReference,
  projectPlayerCorrectionReference,
} from '../../../packages/game-core/src/server/protocol/network-reference-projection';
import type { AuthorityAction } from '../../../packages/game-core/src/worker/authority-worker-protocol';

const decodedFixturePath = process.env.SEEDLANDS_ACTION_DECODED_FIXTURE;
const sourceCorpusPath = process.env.SEEDLANDS_ACTION_SOURCE_CORPUS;
const codecNames = ['C0', 'C1', 'C2'] as const;
const sourcePaths = [
  'src/server/protocol/network-action-reference-copy.ts',
  'src/server/protocol/network-action-request-reference.ts',
  'src/server/protocol/network-action-reference.ts',
  'src/server/protocol/network-reference-integer.ts',
  'src/server/protocol/network-reference-projection.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-action-corpus.test.ts',
] as const;
type CodecName = (typeof codecNames)[number];

type JsonObject = Record<string, unknown>;
type SourceFrame = {
  frameId: string;
  category: string;
  direction: 'client-to-server' | 'server-to-client';
  metadata: JsonObject;
  binary: [];
  contentSha256: string;
  provenance: JsonObject;
};
type Corpus = {
  frames: SourceFrame[];
  corpusSha256: string;
  manifestPayloadSha256: string;
  config: { epoch: string; seedText: string; initialPlayerBodyPosition: [number, number, number] };
};
type DecodedFrame = {
  frameId: string;
  category: string;
  direction: SourceFrame['direction'];
  status: 'DECODED';
  metadata: JsonObject;
  binary: [];
  wireBytes: number;
};
type DecodedFixture = {
  format: string;
  status: string;
  sourceCorpusSha256: string;
  sourceManifestPayloadSha256: string;
  records: number;
  wireStatus: string;
  timing: string;
  codecs: Record<CodecName, DecodedFrame[]>;
};
type ValidatedProvenance = {
  context: JsonObject;
  attempt: number;
  retryOfRequestFrameId: string | null;
  observedResult: 'success' | 'business-failure';
};

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function fail(message: string): never {
  throw new TypeError(message);
}
const object = (value: unknown, field: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} 必须是对象。`);
  return value as JsonObject;
};
const array = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) fail(`${field} 必须是数组。`);
  return value;
};
const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value) fail(`${field} 必须是非空字符串。`);
  return value;
};
const integer = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${field} 必须是非负安全整数。`);
  return value as number;
};
const equal = (actual: unknown, expected: unknown, field: string): void => {
  if (!isDeepStrictEqual(actual, expected)) fail(`${field} 不一致。`);
};
const hexHash = (value: unknown, field: string): string => {
  const result = text(value, field);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(`${field} 必须是 SHA-256。`);
  return result;
};

async function currentSourceHashes(): Promise<JsonObject> {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(path))])));
}

async function validateCurrentSourceHashes(value: JsonObject): Promise<void> {
  equal(Object.keys(value).sort(), [...sourcePaths].sort(), 'source hash paths');
  const current = await currentSourceHashes();
  for (const path of sourcePaths) {
    const recorded = hexHash(value[path], `source hash ${path}`);
    if (recorded !== current[path]) fail(`source hash ${path} 已过期。`);
  }
}

function parsePosition(value: unknown): [number, number, number] {
  const coordinates = array(value, 'config.initialPlayerBodyPosition');
  if (
    coordinates.length !== 3 ||
    !coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  )
    fail('config.initialPlayerBodyPosition 必须是 finite 三元组。');
  return [coordinates[0] as number, coordinates[1] as number, coordinates[2] as number];
}

function parseSourceFrame(value: unknown): SourceFrame {
  const source = object(value, 'source frame');
  const direction = text(source.direction, 'source direction');
  if (direction !== 'client-to-server' && direction !== 'server-to-client') fail('source direction 无效。');
  if (array(source.binary, 'source binary').length) fail('action source binary 必须为空。');
  return {
    frameId: text(source.frameId, 'source frameId'),
    category: text(source.category, 'source category'),
    direction,
    metadata: object(source.metadata, 'source metadata'),
    binary: [],
    contentSha256: hexHash(source.contentSha256, 'source contentSha256'),
    provenance: object(source.provenance, 'source provenance'),
  };
}

function validateRequestMetadata(value: JsonObject, field: string): ActionRequestReference {
  equal(Object.keys(value).sort(), ['action', 'kind', 'projectionVersion', 'sequence'], `${field} fields`);
  const projected = projectActionRequestReference(
    value.action as AuthorityAction,
    integer(value.sequence, `${field}.sequence`),
  );
  equal(value, projected, field);
  return projected;
}

function validateProvenance(frame: SourceFrame, manifestPayloadSha256: string): ValidatedProvenance {
  const provenance = frame.provenance;
  equal(
    Object.keys(provenance).sort(),
    [
      'actionType',
      'attempt',
      'authorityContext',
      'kind',
      'manifestPayloadSha256',
      'observedResult',
      'retryOfRequestFrameId',
      'sequence',
    ],
    `${frame.frameId} provenance fields`,
  );
  if (provenance.kind !== 'real-host' || provenance.manifestPayloadSha256 !== manifestPayloadSha256)
    fail(`${frame.frameId} provenance 未绑定 manifest。`);
  const context = object(provenance.authorityContext, `${frame.frameId}.authorityContext`);
  equal(
    Object.keys(context).sort(),
    ['clientPayloadFields', 'epoch', 'issuer', 'source', 'stream'],
    `${frame.frameId} authority context fields`,
  );
  if (context.source !== 'dedicated-server-host' || context.stream !== 'player-actions')
    fail(`${frame.frameId} authority context 来源无效。`);
  text(context.epoch, `${frame.frameId}.authorityContext.epoch`);
  text(context.issuer, `${frame.frameId}.authorityContext.issuer`);
  if (array(context.clientPayloadFields, `${frame.frameId}.clientPayloadFields`).length)
    fail(`${frame.frameId} 客户端 payload 不得携带 authority identity。`);
  const attempt = integer(provenance.attempt, `${frame.frameId}.attempt`);
  if (attempt < 1) fail(`${frame.frameId} attempt 必须从1开始。`);
  const retryOfRequestFrameId =
    provenance.retryOfRequestFrameId === null
      ? null
      : text(provenance.retryOfRequestFrameId, `${frame.frameId}.retryOfRequestFrameId`);
  const observedResult = provenance.observedResult;
  if (observedResult !== 'success' && observedResult !== 'business-failure')
    fail(`${frame.frameId} observedResult 无效。`);
  return { context, attempt, retryOfRequestFrameId, observedResult };
}

function validateGroups(frames: readonly SourceFrame[], config: Corpus['config'], manifestHash: string): void {
  let firstRequest: ActionRequestReference | undefined;
  for (let index = 0; index < frames.length; index += 4) {
    const group = frames.slice(index, index + 4);
    equal(
      group.map(({ category, direction }) => ({ category, direction })),
      [
        { category: 'action-request', direction: 'client-to-server' },
        { category: 'action-receipt', direction: 'server-to-client' },
        { category: 'gameplay-view', direction: 'server-to-client' },
        { category: 'player-correction', direction: 'server-to-client' },
      ],
      `source group ${index / 4}`,
    );
    const request = validateRequestMetadata(group[0]!.metadata, group[0]!.frameId);
    const provenance = validateProvenance(group[0]!, manifestHash);
    group.slice(1).forEach((frame) => equal(frame.provenance, group[0]!.provenance, `${frame.frameId} provenance`));
    if (group.some(({ provenance: value }) => value.actionType !== request.action.type))
      fail(`${group[0]!.frameId} provenance actionType 不一致。`);
    if (group.some(({ provenance: value }) => value.sequence !== request.sequence))
      fail(`${group[0]!.frameId} provenance sequence 不一致。`);
    const receipt = object(group[1]!.metadata, `${group[1]!.frameId} receipt`);
    const transaction = object(receipt.transaction, `${group[1]!.frameId} transaction`);
    equal(
      transaction,
      {
        epoch: provenance.context.epoch,
        issuer: provenance.context.issuer,
        stream: provenance.context.stream,
        sequence: request.sequence,
      },
      `${group[1]!.frameId} authority transaction`,
    );
    if (provenance.context.epoch !== config.epoch || receipt.status !== 'executed')
      fail(`${group[1]!.frameId} authority epoch/status 无效。`);
    const outcome = object(receipt.outcome, `${group[1]!.frameId} outcome`);
    const observed = outcome.success === true ? 'success' : outcome.success === false ? 'business-failure' : null;
    if (observed !== provenance.observedResult) fail(`${group[1]!.frameId} observedResult 与 receipt 不一致。`);
    if (index === 0) firstRequest = request;
    const retry = index === 4;
    if (
      provenance.attempt !== (retry ? 2 : 1) ||
      provenance.retryOfRequestFrameId !== (retry ? frames[0]!.frameId : null) ||
      (retry && !isDeepStrictEqual(request, firstRequest))
    )
      fail(`${group[0]!.frameId} retry provenance 无效。`);
  }
}

async function loadCorpus(root: string): Promise<Corpus> {
  const manifest = object(JSON.parse(await readFile(`${root}/manifest.json`, 'utf8')) as unknown, 'manifest');
  const rawFrames = await readFile(`${root}/frames.jsonl`, 'utf8');
  const frames = rawFrames
    .split('\n')
    .filter(Boolean)
    .map((line) => parseSourceFrame(JSON.parse(line) as unknown));
  const manifestPayloadSha256 = hexHash(manifest.manifestPayloadSha256, 'manifestPayloadSha256');
  const corpusSha256 = hexHash(manifest.corpusSha256, 'corpusSha256');
  const payload = { ...manifest };
  delete payload.manifestPayloadSha256;
  delete payload.corpusSha256;
  delete payload.recordCount;
  if (sha256(JSON.stringify(payload)) !== manifestPayloadSha256) fail('manifest payload hash 不一致。');
  if (sha256(rawFrames) !== corpusSha256) fail('corpus hash 不一致。');
  if (integer(manifest.recordCount, 'recordCount') !== frames.length || frames.length !== 40)
    fail('corpus recordCount 不一致。');
  equal(
    manifest.records,
    frames.map(({ frameId, category, direction, contentSha256 }) => ({
      frameId,
      category,
      direction,
      contentSha256,
    })),
    'manifest record index',
  );
  frames.forEach((frame) => {
    const content = {
      frameId: frame.frameId,
      category: frame.category,
      direction: frame.direction,
      metadata: frame.metadata,
      binary: frame.binary,
    };
    if (sha256(JSON.stringify(content)) !== frame.contentSha256) fail(`${frame.frameId} content hash 不一致。`);
    validateProvenance(frame, manifestPayloadSha256);
  });
  const config = object(manifest.config, 'manifest config');
  const parsed: Corpus = {
    frames,
    corpusSha256,
    manifestPayloadSha256,
    config: {
      epoch: text(config.epoch, 'config.epoch'),
      seedText: text(config.seedText, 'config.seedText'),
      initialPlayerBodyPosition: parsePosition(config.initialPlayerBodyPosition),
    },
  };
  const source = object(manifest.source, 'manifest source');
  equal(Object.keys(source).sort(), ['explicitInputSha256', 'gitSha', 'trackedSourceDiffSha256'], 'source fields');
  await validateCurrentSourceHashes(object(source.explicitInputSha256, 'source.explicitInputSha256'));
  validateGroups(frames, parsed.config, manifestPayloadSha256);
  return parsed;
}

function parseDecodedFrame(value: unknown, codec: CodecName, index: number): DecodedFrame {
  const source = object(value, `${codec}[${index}]`);
  const direction = text(source.direction, `${codec}[${index}].direction`);
  if (direction !== 'client-to-server' && direction !== 'server-to-client') fail(`${codec}[${index}] direction 无效。`);
  if (source.status !== 'DECODED') fail(`${codec}[${index}] 未成功解码。`);
  if (array(source.binary, `${codec}[${index}].binary`).length) fail(`${codec}[${index}] binary 必须为空。`);
  return {
    frameId: text(source.frameId, `${codec}[${index}].frameId`),
    category: text(source.category, `${codec}[${index}].category`),
    direction,
    status: 'DECODED',
    metadata: object(source.metadata, `${codec}[${index}].metadata`),
    binary: [],
    wireBytes: integer(source.wireBytes, `${codec}[${index}].wireBytes`),
  };
}

function parseDecodedFixture(value: unknown): DecodedFixture {
  const source = object(value, 'decoded fixture');
  const rawCodecs = object(source.codecs, 'decoded codecs');
  equal(Object.keys(rawCodecs).sort(), [...codecNames], 'decoded codec names');
  const codecs = Object.fromEntries(
    codecNames.map((codec) => [
      codec,
      array(rawCodecs[codec], `decoded ${codec}`).map((frame, index) => parseDecodedFrame(frame, codec, index)),
    ]),
  ) as Record<CodecName, DecodedFrame[]>;
  return {
    format: text(source.format, 'fixture format'),
    status: text(source.status, 'fixture status'),
    sourceCorpusSha256: hexHash(source.sourceCorpusSha256, 'fixture sourceCorpusSha256'),
    sourceManifestPayloadSha256: hexHash(source.sourceManifestPayloadSha256, 'fixture sourceManifestPayloadSha256'),
    records: integer(source.records, 'fixture records'),
    wireStatus: text(source.wireStatus, 'fixture wireStatus'),
    timing: text(source.timing, 'fixture timing'),
    codecs,
  };
}

function validateFixture(corpus: Corpus, fixture: DecodedFixture): Record<CodecName, DecodedFrame[]> {
  if (fixture.format !== 'seedlands-action-decoded-reference/v1' || fixture.status !== 'PASS')
    fail('decoded fixture 状态无效。');
  if (fixture.wireStatus !== 'not-adopted' || fixture.timing !== 'NOT_COLLECTED')
    fail('decoded fixture 证据边界无效。');
  if (fixture.sourceCorpusSha256 !== corpus.corpusSha256) fail('decoded fixture corpus hash 不一致。');
  if (fixture.sourceManifestPayloadSha256 !== corpus.manifestPayloadSha256)
    fail('decoded fixture manifest hash 不一致。');
  if (fixture.records !== corpus.frames.length) fail('decoded fixture record count 不一致。');
  for (const codec of codecNames) {
    const decoded = fixture.codecs[codec];
    if (decoded.length !== corpus.frames.length) fail(`${codec} decoded record count 不一致。`);
    decoded.forEach((frame, index) => {
      const source = corpus.frames[index]!;
      equal(
        { frameId: frame.frameId, category: frame.category, direction: frame.direction },
        { frameId: source.frameId, category: source.category, direction: source.direction },
        `${codec}[${index}] index`,
      );
      equal(frame.metadata, source.metadata, `${codec}/${source.frameId} metadata`);
      equal(frame.binary, source.binary, `${codec}/${source.frameId} binary`);
      if (frame.category === 'action-request') validateRequestMetadata(frame.metadata, `${codec}/${frame.frameId}`);
    });
  }
  return fixture.codecs;
}

const executor = (): DedicatedComputeExecutor => ({
  execute: (task) => runDedicatedComputeTask(task),
  close: async () => {},
  diagnostics: () => ({
    mode: 'inline',
    generation: 0,
    queued: 0,
    queuedBytes: 0,
    running: 0,
    runningBytes: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    staleResults: 0,
    childPids: [],
    workerThreadIds: [],
    poolSize: 1,
    liveSlots: 0,
    terminatingSlots: 0,
    health: 'healthy',
    restartCountLastMinute: 0,
    ipcBacklogBytes: 0,
    slotCompletedTasks: [0],
    taskIdHighWatermark: -1,
  }),
});

async function replay(corpus: Corpus, decoded: readonly DecodedFrame[]) {
  const compute = executor();
  const host = await DedicatedServerHost.create({
    ...corpus.config,
    now: () => 0,
    persistence: new MemoryGamePersistence(),
    executors: { general: compute, fluid: compute, logic: compute },
  });
  const observed: Array<{ category: string; metadata: object }> = [];
  const receipts: object[] = [];
  const gameplayRevisions: number[] = [];
  try {
    await host.waitForIdle();
    host.runtime.commitHostActivation();
    for (let index = 0; index < decoded.length; index += 4) {
      const [requestFrame, receiptFrame, gameplayFrame, correctionFrame] = decoded.slice(index, index + 4);
      if (!requestFrame || !receiptFrame || !gameplayFrame || !correctionFrame)
        fail(`decoded group ${index / 4} 不完整。`);
      const request = validateRequestMetadata(requestFrame.metadata, requestFrame.frameId);
      const snapshotBefore = host.runtime.snapshot();
      const receipt = await host.performAction(structuredClone(request.action), request.sequence);
      const actualReceipt = projectActionReceiptReference(request.action, receipt, {
        epoch: snapshotBefore.epoch,
        issuer: host.runtime.playerId,
        stream: 'player-actions',
        sequence: request.sequence,
      });
      const snapshot = host.runtime.snapshot();
      const actualGameplay = projectGameplayViewReference(host.runtime.view(), {
        epoch: snapshot.epoch,
        snapshotPhysicsTick: snapshot.physicsTick,
        snapshotCommitSequence: snapshot.commitSequence,
        snapshotWorldRevision: snapshot.worldRevision,
      });
      const actualCorrection = projectPlayerCorrectionReference(snapshot);
      equal(actualReceipt, receiptFrame.metadata, `${receiptFrame.frameId} actual receipt`);
      equal(actualGameplay, gameplayFrame.metadata, `${gameplayFrame.frameId} actual gameplay`);
      equal(actualCorrection, correctionFrame.metadata, `${correctionFrame.frameId} actual correction`);
      receipts.push(actualReceipt);
      gameplayRevisions.push(actualGameplay.gameplayRevision);
      observed.push(
        { category: receiptFrame.category, metadata: actualReceipt },
        { category: gameplayFrame.category, metadata: actualGameplay },
        { category: correctionFrame.category, metadata: actualCorrection },
      );
    }
    equal(receipts[1], receipts[0], 'select-hotbar retry receipt');
    if (gameplayRevisions[1] !== gameplayRevisions[0]) fail('select-hotbar retry 不得增长 gameplay revision。');
    return { observed, gameplayRevisions };
  } finally {
    await host.stop();
  }
}

async function loadInputs() {
  if (!decodedFixturePath || !sourceCorpusPath)
    throw new Error('需要显式设置 SEEDLANDS_ACTION_DECODED_FIXTURE 与 SEEDLANDS_ACTION_SOURCE_CORPUS。');
  const [corpus, fixtureValue] = await Promise.all([
    loadCorpus(sourceCorpusPath),
    readFile(decodedFixturePath, 'utf8').then((value) => JSON.parse(value) as unknown),
  ]);
  return { corpus, fixture: parseDecodedFixture(fixtureValue) };
}

describe('action codec 真实 Host 应用 oracle', () => {
  it('在应用前拒绝错误来源、被改写动作与伪造 identity metadata', async () => {
    const { corpus, fixture } = await loadInputs();
    let applyCalls = 0;
    const validateThenApply = (candidate: DecodedFixture) => {
      validateFixture(corpus, candidate);
      applyCalls += 1;
    };
    const wrongHash = structuredClone(fixture);
    wrongHash.sourceCorpusSha256 = '0'.repeat(64);
    expect(() => validateThenApply(wrongHash)).toThrow(/corpus hash/);

    const changedAction = structuredClone(fixture);
    object(object(changedAction.codecs.C1[0]!.metadata.action, 'changed action'), 'changed action').slot = 2;
    expect(() => validateThenApply(changedAction)).toThrow(/metadata/);

    const forgedIdentity = structuredClone(fixture);
    forgedIdentity.codecs.C2[0]!.metadata.epoch = 'forged-client-epoch';
    expect(() => validateThenApply(forgedIdentity)).toThrow(/fields|metadata/);
    expect(applyCalls).toBe(0);

    const badProvenance = structuredClone(corpus.frames);
    badProvenance.slice(4, 8).forEach(({ provenance }) => (provenance.retryOfRequestFrameId = 'wrong-request'));
    expect(() => validateGroups(badProvenance, corpus.config, corpus.manifestPayloadSha256)).toThrow(
      /retry provenance/,
    );
  });

  it('在应用前拒绝过期、缺项或多项的当前源码 hash', async () => {
    const current = await currentSourceHashes();
    const stale = { ...current, [sourcePaths[0]]: '0'.repeat(64) };
    await expect(validateCurrentSourceHashes(stale)).rejects.toThrow(/source hash/);
    const missing = { ...current };
    delete missing[sourcePaths[0]];
    await expect(validateCurrentSourceHashes(missing)).rejects.toThrow(/source hash/);
    await expect(validateCurrentSourceHashes({ ...current, 'src/extra.ts': '0'.repeat(64) })).rejects.toThrow(
      /source hash/,
    );
  });

  it('让 C0/C1/C2 的40条 decoded 记录分别经过新真实 Host，并复现10次动作结果', async () => {
    const { corpus, fixture } = await loadInputs();
    const codecs = validateFixture(corpus, fixture);
    const results: Partial<Record<CodecName, Awaited<ReturnType<typeof replay>>>> = {};
    for (const codec of codecNames) results[codec] = await replay(corpus, codecs[codec]);
    expect(results.C1).toEqual(results.C0);
    expect(results.C2).toEqual(results.C0);
    expect(results.C0?.observed).toHaveLength(30);
    expect(results.C0?.gameplayRevisions).toHaveLength(10);
    expect(results.C0?.gameplayRevisions[1]).toBe(results.C0?.gameplayRevisions[0]);
  });
});
