import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';

const sourceCorpusRoot = process.env.SEEDLANDS_GAMEPLAY_CONSUMER_SOURCE_CORPUS;
const decodedFixturePath = process.env.SEEDLANDS_GAMEPLAY_CONSUMER_DECODED_FIXTURE;
const codecs = ['C0', 'C1', 'C2'] as const;
const actorBehaviors = new Set([
  'idle',
  'wander',
  'seek-food',
  'flee',
  'chase',
  'attack',
  'routine-home',
  'routine-work',
]);
const expectedSourcePaths = [
  'src/server/protocol/network-gameplay-consumer-reference.ts',
  'src/server/protocol/network-reference-pose.ts',
  'src/server/protocol/network-reference-projection.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-gameplay-consumer-corpus-recorder.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-gameplay-consumer-corpus.test.ts',
] as const;
const expectedOrder = [
  '000-player-correction',
  '001-entity-pose',
  '002-gameplay-consumer',
  '003-player-correction',
  '004-entity-pose',
  '005-gameplay-consumer',
  '006-player-correction',
  '007-entity-pose',
  '008-gameplay-consumer',
] as const;
const expectedStages = ['starter-ecology', 'fixture-admin-expanded', 'restored'] as const;

type JsonObject = Record<string, unknown>;
type SourceFrame = Readonly<{
  frameId: string;
  category: 'player-correction' | 'entity-pose' | 'gameplay-consumer';
  direction: 'server-to-client';
  metadata: JsonObject;
  binary: [];
  contentSha256: string;
  provenance: Readonly<{
    kind: 'real-host';
    manifestPayloadSha256: string;
    stage: (typeof expectedStages)[number];
    publisher: 'dedicated-host-subscribe';
    sequenceScope: 'per-recorder-subscription';
    fixtureAdmin?: JsonObject;
  }>;
}>;
type SourceManifest = Readonly<{
  manifestPayloadSha256: string;
  corpusSha256: string;
  records: readonly Readonly<{
    frameId: string;
    category: SourceFrame['category'];
    direction: SourceFrame['direction'];
    contentSha256: string;
  }>[];
}>;
type DecodedRecord = Readonly<{
  frameId: string;
  category: SourceFrame['category'];
  direction: SourceFrame['direction'];
  status: 'DECODED';
  metadata: JsonObject;
  binary: [];
  wireBytes: number;
}>;
type DecodedFixture = Readonly<{
  sourceCorpusSha256: string;
  sourceManifestPayloadSha256: string;
  codecs: Readonly<Record<(typeof codecs)[number], readonly DecodedRecord[]>>;
}>;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} 必须是对象。`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} 必须是数组。`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} 必须是非空字符串。`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} 必须是非负安全整数。`);
  return value as number;
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string) {
  expect(Object.keys(value).sort()).toEqual([...expected].sort());
  if (Object.keys(value).length !== expected.length) throw new TypeError(`${label} 字段不唯一。`);
}

async function currentSourceHashes() {
  return Object.fromEntries(
    await Promise.all(expectedSourcePaths.map(async (path) => [path, sha256(await readFile(path, 'utf8'))] as const)),
  );
}

function parseSourceFrame(value: unknown, manifestPayloadSha256: string): SourceFrame {
  const frame = object(value, 'source frame');
  exactKeys(
    frame,
    ['frameId', 'category', 'direction', 'metadata', 'binary', 'contentSha256', 'provenance'],
    'source frame',
  );
  const category = text(frame.category, 'source category');
  if (!['player-correction', 'entity-pose', 'gameplay-consumer'].includes(category))
    throw new TypeError('source category 无效。');
  if (frame.direction !== 'server-to-client') throw new TypeError('source direction 无效。');
  const binary = array(frame.binary, 'source binary');
  if (binary.length) throw new TypeError('Gameplay consumer corpus 不应包含二进制块。');
  const provenance = object(frame.provenance, 'source provenance');
  const allowedProvenance = [
    'kind',
    'manifestPayloadSha256',
    'stage',
    'publisher',
    'sequenceScope',
    ...(provenance.fixtureAdmin === undefined ? [] : ['fixtureAdmin']),
  ];
  exactKeys(provenance, allowedProvenance, 'source provenance');
  if (provenance.kind !== 'real-host' || provenance.manifestPayloadSha256 !== manifestPayloadSha256)
    throw new TypeError('source provenance 绑定无效。');
  if (!expectedStages.includes(provenance.stage as (typeof expectedStages)[number]))
    throw new TypeError('source provenance stage 无效。');
  if (provenance.publisher !== 'dedicated-host-subscribe' || provenance.sequenceScope !== 'per-recorder-subscription')
    throw new TypeError('source publisher 或 sequence scope 无效。');
  return {
    frameId: text(frame.frameId, 'source frameId'),
    category: category as SourceFrame['category'],
    direction: 'server-to-client',
    metadata: object(frame.metadata, 'source metadata'),
    binary: [],
    contentSha256: text(frame.contentSha256, 'source contentSha256'),
    provenance: {
      kind: 'real-host',
      manifestPayloadSha256,
      stage: provenance.stage as SourceFrame['provenance']['stage'],
      publisher: 'dedicated-host-subscribe',
      sequenceScope: 'per-recorder-subscription',
      ...(provenance.fixtureAdmin === undefined
        ? {}
        : { fixtureAdmin: object(provenance.fixtureAdmin, 'fixtureAdmin') }),
    },
  };
}

async function loadSourceCorpus(root: string): Promise<Readonly<{ frames: SourceFrame[]; manifest: SourceManifest }>> {
  const [manifestText, lines] = await Promise.all([
    readFile(`${root}/manifest.json`, 'utf8'),
    readFile(`${root}/frames.jsonl`, 'utf8'),
  ]);
  const rawManifest = object(JSON.parse(manifestText) as unknown, 'source manifest');
  const { manifestPayloadSha256, corpusSha256, recordCount, ...manifestPayload } = rawManifest;
  if (
    manifestPayload.format !== 'seedlands-network-gameplay-consumer-corpus/v2' ||
    manifestPayload.referenceGeneration !== 2
  )
    throw new TypeError('source manifest format 或 generation 无效。');
  const manifestHash = text(manifestPayloadSha256, 'manifestPayloadSha256');
  if (sha256(JSON.stringify(manifestPayload)) !== manifestHash)
    throw new TypeError('source manifest payload hash 无效。');
  if (sha256(lines) !== text(corpusSha256, 'corpusSha256')) throw new TypeError('source corpus hash 无效。');
  if (recordCount !== 9) throw new TypeError('source recordCount 必须为 9。');
  const source = object(manifestPayload.source, 'source manifest source');
  exactKeys(source, ['gitSha', 'trackedSourceDiffSha256', 'explicitInputSha256'], 'source manifest source');
  const manifestHashes = object(source.explicitInputSha256, 'source explicitInputSha256');
  if (!isDeepStrictEqual(Object.keys(manifestHashes).sort(), [...expectedSourcePaths].sort()))
    throw new TypeError('source explicitInputSha256 路径集合与 collector 不匹配。');
  if (!isDeepStrictEqual(manifestHashes, await currentSourceHashes()))
    throw new TypeError('source explicitInputSha256 与当前采集输入不匹配。');

  const frames = lines
    .split('\n')
    .filter(Boolean)
    .map((line) => parseSourceFrame(JSON.parse(line) as unknown, manifestHash));
  expect(frames.map((frame) => frame.frameId)).toEqual(expectedOrder);
  const records = array(manifestPayload.records, 'source manifest records');
  expect(records).toHaveLength(9);
  deepStrictEqual(
    records,
    frames.map(({ frameId, category, direction, contentSha256 }) => ({ frameId, category, direction, contentSha256 })),
  );
  for (const frame of frames) {
    const { contentSha256, provenance, ...record } = frame;
    const captureProvenance = {
      stage: provenance.stage,
      publisher: provenance.publisher,
      sequenceScope: provenance.sequenceScope,
      ...(provenance.fixtureAdmin === undefined ? {} : { fixtureAdmin: provenance.fixtureAdmin }),
    };
    if (sha256(JSON.stringify({ ...record, captureProvenance })) !== contentSha256)
      throw new TypeError(`source content hash 无效：${frame.frameId}`);
  }
  return {
    frames,
    manifest: {
      manifestPayloadSha256: manifestHash,
      corpusSha256: text(corpusSha256, 'corpusSha256'),
      records: records as SourceManifest['records'],
    },
  };
}

async function tamperedSourceCorpus(mode: 'stale' | 'missing' | 'extra') {
  const sourceRoot = '/tmp/seedlands-network-gameplay-consumer-corpus-v2';
  const root = await mkdtemp(join(tmpdir(), 'seedlands-gameplay-consumer-source-'));
  const manifest = object(
    JSON.parse(await readFile(`${sourceRoot}/manifest.json`, 'utf8')) as unknown,
    'tampered manifest',
  );
  const source = object(manifest.source, 'tampered source');
  const hashes = object(source.explicitInputSha256, 'tampered source hashes');
  const [firstPath] = expectedSourcePaths;
  if (!firstPath) throw new Error('Expected source path is missing.');
  if (mode === 'stale') hashes[firstPath] = '0'.repeat(64);
  else if (mode === 'missing') delete hashes[firstPath];
  else hashes['src/server/protocol/not-a-capture-input.ts'] = 'f'.repeat(64);

  const payload = { ...manifest };
  delete payload.manifestPayloadSha256;
  delete payload.corpusSha256;
  delete payload.recordCount;
  const manifestPayloadSha256 = sha256(JSON.stringify(payload));
  manifest.manifestPayloadSha256 = manifestPayloadSha256;
  const frames = (await readFile(`${sourceRoot}/frames.jsonl`, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => object(JSON.parse(line) as unknown, 'tampered frame'));
  for (const frame of frames)
    object(frame.provenance, 'tampered provenance').manifestPayloadSha256 = manifestPayloadSha256;
  const lines = frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n';
  manifest.corpusSha256 = sha256(lines);
  await Promise.all([
    writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2)),
    writeFile(`${root}/frames.jsonl`, lines),
  ]);
  return root;
}

function parseDecodedRecord(value: unknown): DecodedRecord {
  const record = object(value, 'decoded record');
  exactKeys(
    record,
    ['frameId', 'category', 'direction', 'status', 'metadata', 'binary', 'wireBytes'],
    'decoded record',
  );
  const category = text(record.category, 'decoded category');
  if (!['player-correction', 'entity-pose', 'gameplay-consumer'].includes(category))
    throw new TypeError('decoded category 无效。');
  if (record.direction !== 'server-to-client' || record.status !== 'DECODED')
    throw new TypeError('decoded direction 或 status 无效。');
  if (array(record.binary, 'decoded binary').length) throw new TypeError('decoded binary 必须为空数组。');
  return {
    frameId: text(record.frameId, 'decoded frameId'),
    category: category as SourceFrame['category'],
    direction: 'server-to-client',
    status: 'DECODED',
    metadata: object(record.metadata, 'decoded metadata'),
    binary: [],
    wireBytes: nonNegativeInteger(record.wireBytes, 'decoded wireBytes'),
  };
}

async function loadDecodedFixture(path: string): Promise<DecodedFixture> {
  const raw = object(JSON.parse(await readFile(path, 'utf8')) as unknown, 'decoded fixture');
  exactKeys(
    raw,
    [
      'format',
      'status',
      'sourceCorpusSha256',
      'sourceManifestPayloadSha256',
      'records',
      'wireStatus',
      'timing',
      'codecs',
    ],
    'decoded fixture',
  );
  if (
    raw.format !== 'seedlands-gameplay-consumer-decoded-reference/v2' ||
    raw.status !== 'PASS' ||
    raw.records !== 9 ||
    raw.wireStatus !== 'not-adopted' ||
    raw.timing !== 'NOT_COLLECTED'
  )
    throw new TypeError('decoded fixture header 无效。');
  const rawCodecs = object(raw.codecs, 'decoded codecs');
  exactKeys(rawCodecs, codecs, 'decoded codecs');
  const parsedCodecs: DecodedFixture['codecs'] = {
    C0: array(rawCodecs.C0, 'decoded C0').map(parseDecodedRecord),
    C1: array(rawCodecs.C1, 'decoded C1').map(parseDecodedRecord),
    C2: array(rawCodecs.C2, 'decoded C2').map(parseDecodedRecord),
  };
  return {
    sourceCorpusSha256: text(raw.sourceCorpusSha256, 'sourceCorpusSha256'),
    sourceManifestPayloadSha256: text(raw.sourceManifestPayloadSha256, 'sourceManifestPayloadSha256'),
    codecs: parsedCodecs,
  };
}

function assertStageRelationship(frames: readonly SourceFrame[]) {
  for (const [index, stage] of expectedStages.entries()) {
    const group = frames.slice(index * 3, index * 3 + 3);
    const correction = group[0]!;
    const pose = group[1]!;
    const consumer = group[2]!;
    expect(group.map((frame) => frame.provenance.stage)).toEqual([stage, stage, stage]);
    expect(group.map((frame) => frame.category)).toEqual(['player-correction', 'entity-pose', 'gameplay-consumer']);

    const correctionMetadata = correction.metadata;
    const poseMetadata = pose.metadata;
    const consumerMetadata = consumer.metadata;
    const epoch = text(correctionMetadata.epoch, `${stage} correction epoch`);
    expect(poseMetadata.epoch).toBe(epoch);
    expect(consumerMetadata.epoch).toBe(epoch);
    expect(consumerMetadata.snapshotPhysicsTick).toBe(correctionMetadata.physicsTick);
    expect(consumerMetadata.snapshotCommitSequence).toBe(correctionMetadata.commitSequence);
    expect(consumerMetadata.snapshotWorldRevision).toBe(correctionMetadata.worldRevision);
    expect(poseMetadata.physicsTick).toBe(correctionMetadata.physicsTick);
    expect(poseMetadata.commitSequence).toBe(correctionMetadata.commitSequence);
    expect(poseMetadata.worldRevision).toBe(correctionMetadata.worldRevision);

    const playerId = text(object(correctionMetadata.player, `${stage} correction player`).id, `${stage} player id`);
    expect(object(consumerMetadata.player, `${stage} consumer player`).entityId).toBe(playerId);
    const poses = array(poseMetadata.entities, `${stage} pose entities`).map((value) =>
      object(value, `${stage} pose entity`),
    );
    expect(poses.some((entity) => entity.id === playerId)).toBe(true);
    const entities = array(consumerMetadata.entities, `${stage} reliable entities`).map((value) =>
      object(value, `${stage} reliable entity`),
    );
    expect(entities.some((entity) => entity.id === playerId)).toBe(false);
    const entityById = new Map(entities.map((entity) => [text(entity.id, `${stage} entity id`), entity]));
    const behaviors = array(consumerMetadata.actorBehaviors, `${stage} actorBehaviors`).map((value) =>
      object(value, `${stage} actorBehavior`),
    );
    expect(behaviors).toHaveLength(index === 0 ? 3 : 4);
    const ids = new Set<string>();
    for (const behavior of behaviors) {
      const entityId = text(behavior.entityId, `${stage} actorBehavior entityId`);
      if (ids.has(entityId)) throw new TypeError(`${stage} actorBehavior entityId 重复。`);
      ids.add(entityId);
      if (!actorBehaviors.has(text(behavior.behavior, `${stage} actorBehavior behavior`)))
        throw new TypeError(`${stage} actorBehavior 枚举无效。`);
      const entity = entityById.get(entityId);
      if (!entity || (entity.type !== 'creature' && entity.type !== 'npc'))
        throw new TypeError(`${stage} actorBehavior 未关联 creature/npc。`);
    }
  }
}

async function loadInputs() {
  if (!sourceCorpusRoot || !decodedFixturePath)
    throw new Error(
      '需要显式设置 SEEDLANDS_GAMEPLAY_CONSUMER_SOURCE_CORPUS 与 SEEDLANDS_GAMEPLAY_CONSUMER_DECODED_FIXTURE。',
    );
  const [source, fixture] = await Promise.all([
    loadSourceCorpus(sourceCorpusRoot),
    loadDecodedFixture(decodedFixturePath),
  ]);
  if (
    fixture.sourceCorpusSha256 !== source.manifest.corpusSha256 ||
    fixture.sourceManifestPayloadSha256 !== source.manifest.manifestPayloadSha256
  )
    throw new TypeError('decoded fixture 与 source corpus 身份不匹配。');
  return { source, fixture };
}

describe('Gameplay consumer v2 decoded 字段等价 oracle', () => {
  it.each(['stale', 'missing', 'extra'] as const)('拒绝 %s source hash 清单', async (mode) => {
    const root = await tamperedSourceCorpus(mode);
    try {
      await expect(loadSourceCorpus(root)).rejects.toThrow(/source/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('要求显式来源与 fixture，逐 codec 强等价并核对公开实体关联', async () => {
    const { source, fixture } = await loadInputs();
    assertStageRelationship(source.frames);
    for (const codec of codecs) {
      const decoded = fixture.codecs[codec];
      expect(decoded).toHaveLength(9);
      expect(decoded.map((frame) => frame.frameId)).toEqual(expectedOrder);
      for (const [index, frame] of decoded.entries()) {
        const sourceFrame = source.frames[index]!;
        expect(frame.category).toBe(sourceFrame.category);
        expect(frame.direction).toBe(sourceFrame.direction);
        expect(frame.status).toBe('DECODED');
        deepStrictEqual(frame.metadata, sourceFrame.metadata);
        deepStrictEqual(frame.binary, sourceFrame.binary);
      }
      assertStageRelationship(
        decoded.map((frame, index) => ({
          ...source.frames[index]!,
          metadata: frame.metadata,
        })),
      );
    }
  });
});
