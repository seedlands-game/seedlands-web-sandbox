import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WelcomeReference } from '../../../src/server/protocol/network-reference-bootstrap-types';
import type {
  PlayerCorrectionReference,
  WorldCommitReference,
} from '../../../src/server/protocol/network-reference-projection-types';
import { NetworkReferenceReceiver, type ReceiverBaseline } from './support/network-reference-receiver';

const decodedFixturePath = process.env.SEEDLANDS_REFERENCE_DECODED_FIXTURE;
const c0FixturePath = process.env.SEEDLANDS_REFERENCE_C0_FIXTURE;
const sourceCorpusPath = process.env.SEEDLANDS_REFERENCE_SOURCE_CORPUS;
const expectedOrder = [
  '000-welcome',
  '001-player-correction',
  '002-gameplay-view',
  '003-chunk-baseline',
  '004-player-correction',
  '005-gameplay-view',
  '006-world-commit',
  '007-action-receipt',
  '008-action-receipt',
] as const;

type BinaryDescriptor = Readonly<{
  name: string;
  path: string;
  byteLength: number;
  sha256: string;
  elementType: string;
  byteOrder: string;
}>;
type SourceFrame = Readonly<{
  frameId: string;
  category: string;
  metadata: Record<string, unknown>;
  binary: readonly BinaryDescriptor[];
  metadataSha256: string;
  contentSha256: string;
  provenance: Readonly<{ manifest: 'manifest.json'; manifestPayloadSha256: string }>;
}>;
type SourceManifest = Readonly<{
  corpusSha256: string;
  manifestPayloadSha256: string;
  records: readonly Omit<SourceFrame, 'provenance'>[];
}>;
type DecodedBinary = Readonly<{ name: string; byteLength: number; encoding: 'base64'; data: string }>;
type DecodedRecord = Readonly<{
  frameId: string;
  category: string;
  status: 'DECODED' | 'NOT_SUPPORTED';
  reason?: string;
  metadata?: Record<string, unknown>;
  binary?: readonly DecodedBinary[];
}>;
type DecodedFixture = Readonly<{
  fixtureRoot: string;
  fixtureManifest: string;
  sourceCorpusSha256?: string;
  sourceManifestPayloadSha256?: string;
  sourceFixtureRecordCount: number;
  recordOrder: readonly string[];
  codecs: Readonly<Record<string, Readonly<{ records: readonly DecodedRecord[] }>>>;
}>;
type MaterializedFrame = Readonly<{
  frameId: string;
  category: string;
  metadata: Record<string, unknown>;
  binary: ReadonlyMap<string, ArrayBuffer>;
}>;

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const digest = async (bytes: Uint8Array) => sha256(bytes);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} 必须是对象。`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} 必须是数组。`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} 必须是非空字符串。`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} 必须是非负安全整数。`);
  return value as number;
}

function parseSourceFrame(value: unknown): SourceFrame {
  const source = record(value, 'source frame');
  const binary = array(source.binary, 'source frame binary').map((item, index) => {
    const block = record(item, `source binary ${index}`);
    return {
      name: text(block.name, `source binary ${index}.name`),
      path: text(block.path, `source binary ${index}.path`),
      // 保持 writer 的字段插入顺序；contentSha256 是 JSON 文本承诺的一部分。
      byteLength: integer(block.byteLength, `source binary ${index}.byteLength`),
      sha256: text(block.sha256, `source binary ${index}.sha256`),
      elementType: text(block.elementType, `source binary ${index}.elementType`),
      byteOrder: text(block.byteOrder, `source binary ${index}.byteOrder`),
    };
  });
  const provenance = record(source.provenance, 'source provenance');
  if (provenance.manifest !== 'manifest.json') throw new TypeError('source provenance manifest 无效。');
  return {
    frameId: text(source.frameId, 'source frameId'),
    category: text(source.category, 'source category'),
    metadata: record(source.metadata, 'source metadata'),
    binary,
    metadataSha256: text(source.metadataSha256, 'source metadataSha256'),
    contentSha256: text(source.contentSha256, 'source contentSha256'),
    provenance: {
      manifest: 'manifest.json',
      manifestPayloadSha256: text(provenance.manifestPayloadSha256, 'source provenance manifestPayloadSha256'),
    },
  };
}

function parseDecodedRecord(value: unknown): DecodedRecord {
  const source = record(value, 'decoded record');
  const status = text(source.status, 'decoded status');
  if (status !== 'DECODED' && status !== 'NOT_SUPPORTED') throw new TypeError('decoded status 无效。');
  const binary =
    source.binary === undefined
      ? undefined
      : array(source.binary, 'decoded binary').map((item, index) => {
          const block = record(item, `decoded binary ${index}`);
          if (block.encoding !== 'base64') throw new TypeError(`decoded binary ${index} 必须为 base64。`);
          return {
            name: text(block.name, `decoded binary ${index}.name`),
            byteLength: integer(block.byteLength, `decoded binary ${index}.byteLength`),
            encoding: 'base64' as const,
            data: text(block.data, `decoded binary ${index}.data`),
          };
        });
  return {
    frameId: text(source.frameId, 'decoded frameId'),
    category: text(source.category, 'decoded category'),
    status,
    ...(source.reason === undefined ? {} : { reason: text(source.reason, 'decoded reason') }),
    ...(source.metadata === undefined ? {} : { metadata: record(source.metadata, 'decoded metadata') }),
    ...(binary === undefined ? {} : { binary }),
  };
}

async function loadSourceCorpus(root: string) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as unknown;
  const manifestRecord = record(manifest, 'source manifest');
  const manifestRecords = array(manifestRecord.records, 'manifest records');
  const manifestPayload = {
    format: text(manifestRecord.format, 'manifest format'),
    generatedBy: text(manifestRecord.generatedBy, 'manifest generatedBy'),
    provenance: record(manifestRecord.provenance, 'manifest provenance'),
    records: manifestRecords,
  };
  const sourceManifest: SourceManifest = {
    corpusSha256: text(manifestRecord.corpusSha256, 'manifest corpusSha256'),
    manifestPayloadSha256: text(manifestRecord.manifestPayloadSha256, 'manifest manifestPayloadSha256'),
    records: manifestRecords.map((value) => {
      const frame = parseSourceFrame({
        ...record(value, 'manifest record'),
        provenance: { manifest: 'manifest.json', manifestPayloadSha256: 'manifest-binding-not-used' },
      });
      return {
        frameId: frame.frameId,
        category: frame.category,
        metadata: frame.metadata,
        binary: frame.binary,
        metadataSha256: frame.metadataSha256,
        contentSha256: frame.contentSha256,
      };
    }),
  };
  expect(sha256(JSON.stringify(manifestPayload))).toBe(sourceManifest.manifestPayloadSha256);
  const jsonl = await readFile(join(root, 'frames.jsonl'), 'utf8');
  const frames = jsonl
    .trim()
    .split('\n')
    .map((line) => parseSourceFrame(JSON.parse(line) as unknown));
  expect(frames.map((frame) => frame.frameId)).toEqual(expectedOrder);
  expect(sourceManifest.records).toHaveLength(frames.length);
  for (const frame of frames) {
    expect(sha256(JSON.stringify(frame.metadata))).toBe(frame.metadataSha256);
    const content = {
      frameId: frame.frameId,
      category: frame.category,
      metadata: frame.metadata,
      binary: frame.binary,
      metadataSha256: frame.metadataSha256,
    };
    expect(sha256(JSON.stringify(content))).toBe(frame.contentSha256);
    expect(frame.provenance.manifestPayloadSha256).toBe(sourceManifest.manifestPayloadSha256);
    const manifestFrame = sourceManifest.records[frames.indexOf(frame)];
    expect(manifestFrame).toEqual({
      frameId: frame.frameId,
      category: frame.category,
      metadata: frame.metadata,
      binary: frame.binary,
      metadataSha256: frame.metadataSha256,
      contentSha256: frame.contentSha256,
    });
    if (frame.category === 'chunk-baseline') {
      const metadata = frame.metadata;
      const canonical = record(metadata.canonical, 'baseline canonical metadata');
      const fluid = record(metadata.fluid, 'baseline fluid metadata');
      expect(frame.binary).toEqual([
        expect.objectContaining({
          name: 'canonical',
          sha256: canonical.sha256,
          byteLength: canonical.byteLength,
          elementType: canonical.elementType,
          byteOrder: 'little-endian',
        }),
        expect.objectContaining({
          name: 'fluid',
          sha256: fluid.sha256,
          byteLength: fluid.byteLength,
          elementType: fluid.elementType,
          byteOrder: 'not-applicable',
        }),
      ]);
    }
  }
  const sidecarHashes: string[] = [];
  for (const frame of frames) {
    for (const block of frame.binary) {
      if (!block.path.startsWith('blocks/') || block.path !== `blocks/${basename(block.path)}`)
        throw new TypeError(`sidecar 路径必须是 blocks/<安全文件名>：${block.path}`);
      const bytes = await readFile(join(root, 'blocks', basename(block.path)));
      expect(bytes.byteLength).toBe(block.byteLength);
      expect(sha256(bytes)).toBe(block.sha256);
      sidecarHashes.push(block.sha256);
    }
  }
  expect(sha256(`${jsonl}${sidecarHashes.join('\n')}`)).toBe(sourceManifest.corpusSha256);
  return { frames, manifest: sourceManifest };
}

async function loadDecodedFixture(path: string): Promise<DecodedFixture> {
  const value = record(JSON.parse(await readFile(path, 'utf8')) as unknown, 'decoded fixture');
  const codecs = record(value.codecs, 'decoded codecs');
  const parseCodec = (name: string) => ({
    records: array(record(codecs[name], `codec ${name}`).records, `codec ${name} records`).map(parseDecodedRecord),
  });
  return {
    fixtureRoot: text(value.fixtureRoot, 'fixtureRoot'),
    fixtureManifest: text(value.fixtureManifest, 'fixtureManifest'),
    ...(value.sourceCorpusSha256 === undefined
      ? {}
      : { sourceCorpusSha256: text(value.sourceCorpusSha256, 'sourceCorpusSha256') }),
    ...(value.sourceManifestPayloadSha256 === undefined
      ? {}
      : { sourceManifestPayloadSha256: text(value.sourceManifestPayloadSha256, 'sourceManifestPayloadSha256') }),
    sourceFixtureRecordCount: integer(value.sourceFixtureRecordCount, 'sourceFixtureRecordCount'),
    recordOrder: array(value.recordOrder, 'recordOrder').map((item) => text(item, 'recordOrder item')),
    codecs: Object.fromEntries(Object.keys(codecs).map((name) => [name, parseCodec(name)])),
  };
}

function decodedFailureSummary(codec: string, records: readonly DecodedRecord[]) {
  return records
    .filter((frame) => frame.status !== 'DECODED')
    .map((frame) => `${codec}/${frame.frameId}:${frame.status}${frame.reason ? `(${frame.reason})` : ''}`);
}

async function materializeSource(root: string, frame: SourceFrame): Promise<MaterializedFrame> {
  const binary = new Map<string, ArrayBuffer>();
  for (const block of frame.binary) {
    if (!block.path.startsWith('blocks/') || block.path !== `blocks/${basename(block.path)}`)
      throw new TypeError(`sidecar 路径必须是 blocks/<安全文件名>：${block.path}`);
    const bytes = await readFile(join(root, 'blocks', basename(block.path)));
    binary.set(block.name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return { frameId: frame.frameId, category: frame.category, metadata: structuredClone(frame.metadata), binary };
}

function decodeBase64(block: DecodedBinary): ArrayBuffer {
  const bytes = Buffer.from(block.data, 'base64');
  if (bytes.byteLength !== block.byteLength || bytes.toString('base64') !== block.data)
    throw new TypeError(`decoded binary ${block.name} 的 base64 或长度无效。`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function materializeDecoded(source: SourceFrame, decoded: DecodedRecord): MaterializedFrame {
  if (decoded.status !== 'DECODED' || !decoded.metadata || !decoded.binary)
    throw new TypeError(`${decoded.frameId} 未解码。`);
  expect(decoded.frameId).toBe(source.frameId);
  expect(decoded.category).toBe(source.category);
  expect(decoded.metadata).toEqual(source.metadata);
  expect(decoded.binary.map((block) => block.name)).toEqual(source.binary.map((block) => block.name));
  const binary = new Map<string, ArrayBuffer>();
  for (const [index, block] of decoded.binary.entries()) {
    const expected = source.binary[index];
    const bytes = decodeBase64(block);
    expect(block.byteLength).toBe(expected.byteLength);
    expect(sha256(new Uint8Array(bytes))).toBe(expected.sha256);
    binary.set(block.name, bytes);
  }
  return { frameId: source.frameId, category: source.category, metadata: structuredClone(decoded.metadata), binary };
}

function baseline(frame: MaterializedFrame): ReceiverBaseline {
  const metadata = structuredClone(frame.metadata) as unknown as Omit<ReceiverBaseline, 'canonical' | 'fluid'> & {
    canonical: Omit<ReceiverBaseline['canonical'], 'bytes'>;
    fluid: Omit<ReceiverBaseline['fluid'], 'bytes'>;
  };
  const canonical = frame.binary.get('canonical');
  const fluid = frame.binary.get('fluid');
  if (!canonical || !fluid) throw new TypeError('baseline 缺少 canonical 或 fluid 二进制块。');
  return {
    ...metadata,
    canonical: { ...metadata.canonical, elementType: 'uint16-le', bytes: canonical.slice(0) },
    fluid: { ...metadata.fluid, elementType: 'uint8', bytes: fluid.slice(0) },
  };
}

function collisionState(receiver: NetworkReferenceReceiver) {
  return {
    chunks: [...receiver.chunks.entries()]
      .map(([key, chunk]) => ({
        key,
        revision: chunk.chunkRevision,
        canonicalSha256: sha256(
          new Uint8Array(chunk.canonical.buffer, chunk.canonical.byteOffset, chunk.canonical.byteLength),
        ),
        fluidSha256: sha256(new Uint8Array(chunk.fluid.buffer, chunk.fluid.byteOffset, chunk.fluid.byteLength)),
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    requestedBaselines: [...receiver.requestedBaselines].sort(),
    body: structuredClone(receiver.prediction.physicalBody),
    pendingInputSequences: receiver.prediction.pendingFrames.map((frame) => frame.sequence),
    lastResetReason: receiver.prediction.lastResetReason,
    resetCounts: structuredClone(receiver.prediction.resetCounts),
  };
}

async function applyApplication(frames: readonly MaterializedFrame[]) {
  const welcome = frames.find((frame) => frame.category === 'welcome');
  if (!welcome) throw new TypeError('语料缺少 welcome。');
  const bootstrap = welcome.metadata as unknown as WelcomeReference;
  const receiver = new NetworkReferenceReceiver({
    epoch: bootstrap.epoch,
    worldId: bootstrap.worldId,
    generatorVersion: bootstrap.generatorVersion,
    physicsHz: bootstrap.frequencies.physicsHz,
    digest,
  });
  const observed: Record<string, unknown> = {};
  for (const frame of frames) {
    if (frame.category === 'chunk-baseline') {
      observed[frame.frameId] = { accepted: await receiver.baseline(baseline(frame)), state: collisionState(receiver) };
      continue;
    }
    if (frame.category === 'player-correction') {
      const correction = receiver.correction(frame.metadata as unknown as PlayerCorrectionReference);
      observed[frame.frameId] = { correction, state: collisionState(receiver) };
      if (frame.frameId === '001-player-correction') {
        const prediction = receiver.advance({
          elapsedSeconds: 1 / 60,
          issuedAtMs: 51,
          forward: { x: 1, z: 0 },
          right: { x: 0, z: 1 },
          keys: { forward: true, back: false, left: false, right: false, jump: false, crouch: false },
        });
        observed.predictionAfterBaseline = {
          commandCount: prediction.commands.length,
          state: collisionState(receiver),
        };
      }
      continue;
    }
    if (frame.category === 'world-commit') {
      observed[frame.frameId] = {
        accepted: receiver.commit(frame.metadata as unknown as WorldCommitReference),
        state: collisionState(receiver),
      };
      continue;
    }
    observed[frame.frameId] = { metadata: structuredClone(frame.metadata), state: collisionState(receiver) };
  }
  return observed;
}

describe('C1/C2 解码语料的 receiver 应用 oracle', () => {
  it('保留九条真实语料的身份、顺序、DTO 元数据和原始二进制，并在实际 receiver 中得到同一应用结果', async () => {
    if (!decodedFixturePath || !sourceCorpusPath)
      throw new Error('需要显式设置 SEEDLANDS_REFERENCE_DECODED_FIXTURE 与 SEEDLANDS_REFERENCE_SOURCE_CORPUS。');
    const [{ frames, manifest }, c1c2Fixture, c0Fixture] = await Promise.all([
      loadSourceCorpus(sourceCorpusPath),
      loadDecodedFixture(decodedFixturePath),
      c0FixturePath ? loadDecodedFixture(c0FixturePath) : Promise.resolve(undefined),
    ]);
    const codecFixtures: readonly Readonly<{ codec: 'C0' | 'C1' | 'C2'; fixture: DecodedFixture }>[] = [
      { codec: 'C1', fixture: c1c2Fixture },
      { codec: 'C2', fixture: c1c2Fixture },
      ...(c0Fixture ? [{ codec: 'C0' as const, fixture: c0Fixture }] : []),
    ];
    const identityFailures = codecFixtures
      .flatMap(({ codec, fixture }) => [
        fixture.fixtureRoot === sourceCorpusPath
          ? null
          : `${codec} fixtureRoot 与 SEEDLANDS_REFERENCE_SOURCE_CORPUS 不一致`,
        fixture.fixtureManifest === join(sourceCorpusPath, 'manifest.json') ? null : `${codec} fixtureManifest 不一致`,
        fixture.sourceCorpusSha256 === manifest.corpusSha256 ? null : `${codec} sourceCorpusSha256 不一致`,
        fixture.sourceManifestPayloadSha256 === manifest.manifestPayloadSha256
          ? null
          : `${codec} sourceManifestPayloadSha256 不一致`,
        fixture.sourceFixtureRecordCount === frames.length ? null : `${codec} sourceFixtureRecordCount 不一致`,
        JSON.stringify(fixture.recordOrder) === JSON.stringify(expectedOrder) ? null : `${codec} recordOrder 不一致`,
      ])
      .filter((value): value is string => value !== null);
    const unsupported = codecFixtures.flatMap(({ codec, fixture }) => {
      const entry = fixture.codecs[codec];
      return entry ? decodedFailureSummary(codec, entry.records) : [`${codec}: codec section 缺失`];
    });
    if (identityFailures.length || unsupported.length)
      throw new Error(
        `解码 fixture 尚不能作为 application oracle：${[...identityFailures, ...unsupported].join('; ')}`,
      );

    const sourceFrames = await Promise.all(frames.map((frame) => materializeSource(sourceCorpusPath, frame)));
    const results: Record<string, Record<string, unknown>> = {};
    for (const { codec, fixture } of codecFixtures) {
      const entry = fixture.codecs[codec];
      if (!entry) throw new TypeError(`${codec} fixture 缺少 codec section。`);
      expect(entry.records).toHaveLength(frames.length);
      expect(entry.records.map((frame) => frame.frameId)).toEqual(expectedOrder);
      const decodedFrames = frames.map((frame, index) => materializeDecoded(frame, entry.records[index]));
      const [sourceResult, decodedResult] = await Promise.all([
        applyApplication(sourceFrames),
        applyApplication(decodedFrames),
      ]);
      expect(decodedResult).toEqual(sourceResult);
      results[codec] = decodedResult;
    }
    expect(results.C1).toEqual(results.C2);
    if (c0Fixture) expect(results.C0).toEqual(results.C1);
    expect(results.C1['003-chunk-baseline']).toMatchObject({ accepted: true });
    expect(results.C1.predictionAfterBaseline).toMatchObject({
      commandCount: 1,
      state: { pendingInputSequences: [0] },
    });
    expect(results.C1['004-player-correction']).toMatchObject({
      correction: { accepted: true, reconciliation: { resetReason: 'large-error' } },
      state: { requestedBaselines: ['0,1,0'], pendingInputSequences: [], lastResetReason: 'large-error' },
    });
    // The revision correction intentionally arrives before this commit, so resync is the observable contract;
    // a final readable chunk is deliberately not required here.
    expect(results.C1['006-world-commit']).toMatchObject({ accepted: true, state: { requestedBaselines: ['0,1,0'] } });
  });
});
