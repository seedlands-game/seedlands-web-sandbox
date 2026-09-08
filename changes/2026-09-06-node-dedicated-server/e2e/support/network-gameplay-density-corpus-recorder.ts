import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const densityCorpusRoot = '/tmp/seedlands-network-gameplay-density-corpus-v1';

export type DensityActorTarget = 32 | 128;
type DensityCategory = 'player-correction' | 'entity-pose' | 'gameplay-consumer';
type DensityActual = Readonly<{
  registeredActorCount: number;
  totalEntityCount: number;
  poseEntityCount: number;
  gameplayEntityCount: number;
  gameplayRevision: number;
  physicsTick: number;
  worldRevision: number;
}>;

export type DensityCorpusRecord = Readonly<{
  frameId: string;
  category: DensityCategory;
  direction: 'server-to-client';
  metadata: object;
  binary: [];
  captureProvenance: Readonly<{
    stage: `actors-${DensityActorTarget}`;
    publisher: 'dedicated-host-subscribe';
    sequenceScope: 'per-recorder-subscription';
    fixtureAdmin: Readonly<{
      sourceType: 'local-developer';
      actorId: string;
      commandType: 'spawn-actor';
      targetRegisteredActorCount: DensityActorTarget;
    }>;
    actual: DensityActual;
  }>;
}>;

type IndexedRecord = DensityCorpusRecord & { contentSha256: string };
export type DensityCorpusFrame = Omit<IndexedRecord, 'captureProvenance'> & {
  provenance: Readonly<{ kind: 'real-host'; manifestPayloadSha256: string } & DensityCorpusRecord['captureProvenance']>;
};
type DensityCorpusManifest = Readonly<{
  format: 'seedlands-network-gameplay-density-corpus/v1';
  referenceGeneration: 2;
  actorTarget: DensityActorTarget;
  actual: DensityActual;
  environment: Readonly<{ node: string; platform: string; arch: string }>;
  source: Readonly<{
    gitSha: string;
    trackedSourceDiffSha256: string;
    explicitInputSha256: Readonly<Record<string, string>>;
  }>;
  config: object;
  records: readonly Readonly<{
    frameId: string;
    category: DensityCategory;
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

export const densityCorpusOutputDirectory = (actorTarget: DensityActorTarget) =>
  `${densityCorpusRoot}/actors-${actorTarget}`;

function actualFrom(records: readonly DensityCorpusRecord[], actorTarget: DensityActorTarget): DensityActual {
  if (records.length !== 3) throw new RangeError('Density corpus requires one three-category publication.');
  const [first] = records;
  if (!first) throw new RangeError('Density corpus requires records.');
  const actual = first.captureProvenance.actual;
  const categories = records.map((record) => record.category);
  if (categories.join(',') !== 'player-correction,entity-pose,gameplay-consumer')
    throw new TypeError('Density corpus category order is invalid.');
  for (const record of records) {
    if (record.captureProvenance.stage !== `actors-${actorTarget}`)
      throw new TypeError('Density corpus stage does not match actor target.');
    if (record.captureProvenance.fixtureAdmin.targetRegisteredActorCount !== actorTarget)
      throw new TypeError('Density corpus fixture target does not match actor target.');
    if (JSON.stringify(record.captureProvenance.actual) !== JSON.stringify(actual))
      throw new TypeError('Density corpus publication counts must stay identical per frame.');
  }
  if (
    actual.registeredActorCount !== actorTarget ||
    actual.poseEntityCount !== actual.totalEntityCount ||
    actual.gameplayEntityCount !== actual.totalEntityCount - 1 ||
    actual.poseEntityCount > 256
  )
    throw new RangeError('Density corpus observed counts violate the fixed actor/player/pose contract.');
  return actual;
}

export async function writeDensityCorpus(
  options: Readonly<{
    actorTarget: DensityActorTarget;
    records: readonly DensityCorpusRecord[];
    sourcePaths: readonly string[];
    config: object;
  }>,
): Promise<Readonly<{ frames: readonly DensityCorpusFrame[]; manifest: DensityCorpusManifest }>> {
  const actual = actualFrom(options.records, options.actorTarget);
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
    format: 'seedlands-network-gameplay-density-corpus/v1' as const,
    referenceGeneration: 2 as const,
    actorTarget: options.actorTarget,
    actual,
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
      'reference projections; wire and browser client adaptation are not adopted',
      'fixed registered-actor density source; not a timing, throughput, CPU, memory, or tick-p95 experiment',
      'no startup, commit, interest, baseline, transport, GUI, WAN, or complete N2 contract is evidenced',
      'each publication sequence is scoped to this recorder subscription, not a transport field',
    ],
  };
  const manifestPayloadSha256 = sha256(JSON.stringify(payload));
  const frames = indexed.map(({ captureProvenance, ...record }) => ({
    ...record,
    provenance: { kind: 'real-host' as const, manifestPayloadSha256, ...captureProvenance },
  }));
  const lines = frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n';
  const manifest: DensityCorpusManifest = {
    ...payload,
    manifestPayloadSha256,
    corpusSha256: sha256(lines),
    recordCount: frames.length,
  };
  const output = densityCorpusOutputDirectory(options.actorTarget);
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/frames.jsonl`, lines);
  await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2));
  return { frames, manifest };
}

export async function readDensityCorpus(
  actorTarget: DensityActorTarget,
): Promise<Readonly<{ frames: DensityCorpusFrame[]; manifest: DensityCorpusManifest }>> {
  const output = densityCorpusOutputDirectory(actorTarget);
  const lines = await readFile(`${output}/frames.jsonl`, 'utf8');
  const frames = lines
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DensityCorpusFrame);
  const manifest = JSON.parse(await readFile(`${output}/manifest.json`, 'utf8')) as DensityCorpusManifest;
  return { frames, manifest };
}
