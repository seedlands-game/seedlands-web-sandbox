import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DedicatedComputeExecutor } from '../../../src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../../src/server/persistence/memory-game-persistence';
import { projectInputDecisionReference } from '../../../src/server/protocol/network-reference-input';
import { projectEntityPoseReference } from '../../../src/server/protocol/network-reference-pose';
import { projectPlayerCorrectionReference } from '../../../src/server/protocol/network-reference-projection';
import type { InputCommand } from '../../../src/runtime/session-protocol';

const decodedFixturePath = process.env.SEEDLANDS_DIRECTIONAL_DECODED_FIXTURE;
const sourceCorpusPath = process.env.SEEDLANDS_DIRECTIONAL_SOURCE_CORPUS;
const codecNames = ['C0', 'C1', 'C2'] as const;
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
  if (array(source.binary, 'source binary').length) fail('directional source binary 必须为空。');
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

async function loadCorpus(root: string): Promise<Corpus> {
  const manifest = object(JSON.parse(await readFile(`${root}/manifest.json`, 'utf8')) as unknown, 'manifest');
  const rawFrames = await readFile(`${root}/frames.jsonl`, 'utf8');
  const frames = rawFrames
    .split('\n')
    .filter(Boolean)
    .map((line) => parseSourceFrame(JSON.parse(line) as unknown));
  const manifestPayloadSha256 = hexHash(manifest.manifestPayloadSha256, 'manifestPayloadSha256');
  const corpusSha256 = hexHash(manifest.corpusSha256, 'corpusSha256');
  const recordCount = integer(manifest.recordCount, 'recordCount');
  const payload = { ...manifest };
  delete payload.manifestPayloadSha256;
  delete payload.corpusSha256;
  delete payload.recordCount;
  if (sha256(JSON.stringify(payload)) !== manifestPayloadSha256) fail('manifest payload hash 不一致。');
  if (sha256(rawFrames) !== corpusSha256) fail('corpus hash 不一致。');
  if (recordCount !== frames.length || frames.length !== 21) fail('corpus recordCount 不一致。');
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
  for (const frame of frames) {
    const { contentSha256, provenance, ...content } = frame;
    if (sha256(JSON.stringify(content)) !== contentSha256) fail(`${frame.frameId} content hash 不一致。`);
    if (provenance.kind !== 'real-host' || provenance.manifestPayloadSha256 !== manifestPayloadSha256)
      fail(`${frame.frameId} provenance 未绑定 manifest。`);
    if (
      frame.category === 'entity-pose' &&
      (provenance.publisher !== 'dedicated-host-subscribe' || provenance.sequenceScope !== 'per-recorder-subscription')
    )
      fail(`${frame.frameId} pose publisher provenance 无效。`);
  }
  const config = object(manifest.config, 'manifest config');
  return {
    frames,
    corpusSha256,
    manifestPayloadSha256,
    config: {
      epoch: text(config.epoch, 'config.epoch'),
      seedText: text(config.seedText, 'config.seedText'),
      initialPlayerBodyPosition: parsePosition(config.initialPlayerBodyPosition),
    },
  };
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
  if (fixture.format !== 'seedlands-directional-decoded-reference/v1' || fixture.status !== 'PASS')
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
  let now = 0;
  const compute = executor();
  const host = await DedicatedServerHost.create({
    ...corpus.config,
    now: () => now,
    persistence: new MemoryGamePersistence(),
    executors: { general: compute, fluid: compute, logic: compute },
  });
  let publicationSequence = 0;
  const publications: Array<{ category: string; metadata: object }> = [];
  const observed: Array<{ category: string; metadata: object }> = [];
  const unsubscribe = host.subscribe(({ snapshot }) => {
    publications.push({ category: 'player-correction', metadata: projectPlayerCorrectionReference(snapshot) });
    publications.push({
      category: 'entity-pose',
      metadata: projectEntityPoseReference(snapshot, { publicationSequence: publicationSequence++ }),
    });
  });
  try {
    await host.waitForIdle();
    host.runtime.commitHostActivation();
    let index = 0;
    while (index < decoded.length) {
      const inputFrame = decoded[index++]!;
      if (inputFrame.category !== 'player-input' || inputFrame.direction !== 'client-to-server')
        fail(`${inputFrame.frameId} 应为 client-to-server player-input。`);
      const command = object(inputFrame.metadata.input, `${inputFrame.frameId}.input`) as InputCommand;
      if (command.issuedAtMs !== now) fail(`${inputFrame.frameId} issuedAtMs 与受控时钟不一致。`);
      let decisionFrame = decoded[index++]!;
      do {
        if (decisionFrame.category !== 'input-decision' || decisionFrame.direction !== 'server-to-client')
          fail(`${decisionFrame.frameId} 应为 server-to-client input-decision。`);
        const decision = host.receiveInput(structuredClone(command));
        const actual = projectInputDecisionReference(command, decision, host.runtime.snapshot());
        equal(actual, decisionFrame.metadata, `${decisionFrame.frameId} actual decision`);
        observed.push({ category: decisionFrame.category, metadata: actual });
        decisionFrame = decoded[index]!;
        if (decisionFrame?.category === 'input-decision') index += 1;
      } while (decisionFrame?.category === 'input-decision');

      now = command.issuedAtMs + 50;
      host.wake(now);
      const expectedPublication = decoded.slice(index, index + 2);
      if (
        expectedPublication[0]?.category !== 'player-correction' ||
        expectedPublication[1]?.category !== 'entity-pose'
      )
        fail(`${inputFrame.frameId} 后缺少 correction/pose publication。`);
      equal(
        publications,
        expectedPublication.map(({ category, metadata }) => ({ category, metadata })),
        `${inputFrame.frameId} publication`,
      );
      observed.push(...publications.map((value) => structuredClone(value)));
      publications.length = 0;
      index += 2;
    }
    return observed;
  } finally {
    unsubscribe();
    await host.stop();
  }
}

async function loadInputs() {
  if (!decodedFixturePath || !sourceCorpusPath)
    throw new Error('需要显式设置 SEEDLANDS_DIRECTIONAL_DECODED_FIXTURE 与 SEEDLANDS_DIRECTIONAL_SOURCE_CORPUS。');
  const [corpus, fixtureValue] = await Promise.all([
    loadCorpus(sourceCorpusPath),
    readFile(decodedFixturePath, 'utf8').then((value) => JSON.parse(value) as unknown),
  ]);
  return { corpus, fixture: parseDecodedFixture(fixtureValue) };
}

describe('directional codec 真实 Host 应用 oracle', () => {
  it('在应用前拒绝错误来源 hash 或被改写的 decoded input', async () => {
    const { corpus, fixture } = await loadInputs();
    const wrongHash = structuredClone(fixture);
    wrongHash.sourceCorpusSha256 = '0'.repeat(64);
    expect(() => validateFixture(corpus, wrongHash)).toThrow(/corpus hash/);

    const changedInput = structuredClone(fixture);
    const input = object(changedInput.codecs.C1[0]!.metadata.input, 'changed input');
    const state = object(input.state, 'changed input state');
    state.moveX = 0.25;
    expect(() => validateFixture(corpus, changedInput)).toThrow(/metadata/);
  });

  it('让 C0/C1/C2 的全部 decoded input 分别经过新真实 Host，并得到相同 decision、correction 与 pose', async () => {
    const { corpus, fixture } = await loadInputs();
    const codecs = validateFixture(corpus, fixture);
    const results: Partial<Record<CodecName, Awaited<ReturnType<typeof replay>>>> = {};
    for (const codec of codecNames) results[codec] = await replay(corpus, codecs[codec]);
    expect(results.C1).toEqual(results.C0);
    expect(results.C2).toEqual(results.C0);
    expect(results.C0).toHaveLength(16);
    expect(results.C0?.filter(({ category }) => category === 'input-decision')).toHaveLength(6);
    expect(results.C0?.filter(({ category }) => category === 'player-correction')).toHaveLength(5);
    expect(results.C0?.filter(({ category }) => category === 'entity-pose')).toHaveLength(5);
  });
});
