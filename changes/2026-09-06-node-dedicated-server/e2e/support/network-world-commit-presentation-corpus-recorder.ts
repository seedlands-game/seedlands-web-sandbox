import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const worldCommitPresentationCorpusOutputDirectory =
  '/tmp/seedlands-network-world-commit-presentation-corpus-v2-r5';

type Scenario = 'ordinary-boundary-edit' | 'accepted-fluid-candidate';

export type WorldCommitPresentationCorpusRecord = Readonly<{
  frameId: string;
  category: 'world-commit-presentation';
  direction: 'server-to-client';
  metadata: object;
  binary: [];
  captureProvenance: Readonly<{
    scenario: Scenario;
    source: 'dedicated-host-authority-runtime';
    inputWorldCommitSha256: string;
    projectedOutputSha256: string;
  }>;
}>;

type IndexedRecord = WorldCommitPresentationCorpusRecord & { contentSha256: string };
type Frame = Omit<IndexedRecord, 'captureProvenance'> & {
  provenance: Readonly<
    { kind: 'real-host'; manifestPayloadSha256: string } & WorldCommitPresentationCorpusRecord['captureProvenance']
  >;
};
type Manifest = Readonly<{
  format: 'seedlands-network-world-commit-presentation-corpus/v2';
  referenceGeneration: 2;
  environment: Readonly<{ node: string; platform: string; arch: string }>;
  source: Readonly<{
    gitSha: string;
    trackedSourceDiffSha256: string;
    explicitInputSha256: Readonly<Record<string, string>>;
  }>;
  config: object;
  records: readonly Readonly<{
    frameId: string;
    category: 'world-commit-presentation';
    direction: 'server-to-client';
    contentSha256: string;
  }>[];
  limitations: readonly string[];
  manifestPayloadSha256: string;
  corpusSha256: string;
  recordCount: number;
}>;

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourceHashes = async (paths: readonly string[]) =>
  Object.fromEntries(await Promise.all(paths.map(async (path) => [path, sha256(await readFile(path))] as const)));

function validateRecords(records: readonly WorldCommitPresentationCorpusRecord[]): void {
  if (records.length !== 2) throw new RangeError('WorldCommit presentation corpus requires exactly two records.');
  const scenarios = records.map((record) => record.captureProvenance.scenario);
  if (scenarios.join(',') !== 'ordinary-boundary-edit,accepted-fluid-candidate')
    throw new TypeError('WorldCommit presentation scenarios are incomplete or out of order.');
  for (const record of records) {
    if (record.category !== 'world-commit-presentation' || record.direction !== 'server-to-client')
      throw new TypeError('WorldCommit presentation record category or direction is invalid.');
    const provenance = record.captureProvenance;
    if (
      !/^[a-f0-9]{64}$/.test(provenance.inputWorldCommitSha256) ||
      !/^[a-f0-9]{64}$/.test(provenance.projectedOutputSha256)
    )
      throw new TypeError('WorldCommit presentation provenance hash is invalid.');
    if (sha256(JSON.stringify(record.metadata)) !== provenance.projectedOutputSha256)
      throw new TypeError('WorldCommit presentation output hash does not bind metadata.');
  }
}

export async function writeWorldCommitPresentationCorpus(
  options: Readonly<{
    records: readonly WorldCommitPresentationCorpusRecord[];
    sourcePaths: readonly string[];
    config: object;
  }>,
): Promise<Readonly<{ frames: readonly Frame[]; manifest: Manifest }>> {
  validateRecords(options.records);
  const source = {
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedSourceDiffSha256: sha256(
      execFileSync('git', ['diff', 'HEAD', '--', 'src', 'tests', 'changes/2026-09-06-node-dedicated-server']),
    ),
    explicitInputSha256: await sourceHashes(options.sourcePaths),
  };
  const indexed: IndexedRecord[] = options.records.map((record) => ({
    ...record,
    contentSha256: sha256(JSON.stringify(record)),
  }));
  const payload = {
    format: 'seedlands-network-world-commit-presentation-corpus/v2' as const,
    referenceGeneration: 2 as const,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    source,
    config: options.config,
    records: indexed.map(({ frameId, category, direction, contentSha256 }) => ({
      frameId,
      category,
      direction,
      contentSha256,
    })),
    limitations: [
      'reference projection only; wire, codec, transport, browser adapter, and GUI are not adopted',
      'ordinary edit and accepted fluid candidate prove source fields, not timing or throughput',
      'presentation sequence is corpus-local and not a transport field',
    ],
  };
  const manifestPayloadSha256 = sha256(JSON.stringify(payload));
  const frames = indexed.map(({ captureProvenance, ...record }) => ({
    ...record,
    provenance: { kind: 'real-host' as const, manifestPayloadSha256, ...captureProvenance },
  }));
  const lines = frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n';
  const manifest: Manifest = {
    ...payload,
    manifestPayloadSha256,
    corpusSha256: sha256(lines),
    recordCount: frames.length,
  };
  await mkdir(worldCommitPresentationCorpusOutputDirectory);
  await writeFile(`${worldCommitPresentationCorpusOutputDirectory}/frames.jsonl`, lines);
  await writeFile(`${worldCommitPresentationCorpusOutputDirectory}/manifest.json`, JSON.stringify(manifest, null, 2));
  return { frames, manifest };
}

export async function readWorldCommitPresentationCorpus(): Promise<Readonly<{ frames: Frame[]; manifest: Manifest }>> {
  const lines = await readFile(`${worldCommitPresentationCorpusOutputDirectory}/frames.jsonl`, 'utf8');
  const frames = lines
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Frame);
  const manifest = JSON.parse(
    await readFile(`${worldCommitPresentationCorpusOutputDirectory}/manifest.json`, 'utf8'),
  ) as Manifest;
  return { frames, manifest };
}
