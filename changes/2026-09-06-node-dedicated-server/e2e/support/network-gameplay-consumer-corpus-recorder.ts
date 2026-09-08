import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const gameplayConsumerCorpusOutputDir = '/tmp/seedlands-network-gameplay-consumer-corpus-v2';

export type GameplayConsumerCorpusRecord = Readonly<{
  frameId: string;
  category: 'player-correction' | 'entity-pose' | 'gameplay-consumer';
  direction: 'server-to-client';
  metadata: object;
  binary: [];
  captureProvenance: Readonly<{
    stage: 'starter-ecology' | 'fixture-admin-expanded' | 'restored';
    publisher: 'dedicated-host-subscribe';
    sequenceScope: 'per-recorder-subscription';
    fixtureAdmin?: Readonly<{
      sourceType: 'local-developer';
      actorId: string;
      commandTypes: readonly ['spawn-world-item', 'spawn-creature', 'spawn-actor'];
    }>;
  }>;
}>;

type IndexedRecord = GameplayConsumerCorpusRecord & { contentSha256: string };
export type GameplayConsumerCorpusFrame = Omit<IndexedRecord, 'captureProvenance'> & {
  provenance: Readonly<
    { kind: 'real-host'; manifestPayloadSha256: string } & GameplayConsumerCorpusRecord['captureProvenance']
  >;
};

type GameplayConsumerCorpusManifest = Readonly<{
  format: 'seedlands-network-gameplay-consumer-corpus/v2';
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
    category: GameplayConsumerCorpusRecord['category'];
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

export async function writeGameplayConsumerCorpus(
  options: Readonly<{
    records: readonly GameplayConsumerCorpusRecord[];
    sourcePaths: readonly string[];
    config: object;
  }>,
): Promise<Readonly<{ frames: readonly GameplayConsumerCorpusFrame[]; manifest: GameplayConsumerCorpusManifest }>> {
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
    format: 'seedlands-network-gameplay-consumer-corpus/v2' as const,
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
      'reference projections; wire and browser client adaptation are not adopted',
      'actorBehaviors contains only the current public behavior allowlist, not ActorState management fields',
      'publicationSequence is a dedicated-host-subscribe callback index scoped per recorder subscription, not a transport field',
      'three small entity stages are correctness evidence, not a density or performance curve',
    ],
  };
  const manifestPayloadSha256 = sha256(JSON.stringify(payload));
  const frames = indexed.map(({ captureProvenance, ...record }) => ({
    ...record,
    provenance: { kind: 'real-host' as const, manifestPayloadSha256, ...captureProvenance },
  }));
  const lines = frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n';
  const manifest: GameplayConsumerCorpusManifest = {
    ...payload,
    manifestPayloadSha256,
    corpusSha256: sha256(lines),
    recordCount: frames.length,
  };
  await mkdir(gameplayConsumerCorpusOutputDir, { recursive: true });
  await writeFile(`${gameplayConsumerCorpusOutputDir}/frames.jsonl`, lines);
  await writeFile(`${gameplayConsumerCorpusOutputDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  return { frames, manifest };
}

export async function readGameplayConsumerCorpus(): Promise<
  Readonly<{ frames: GameplayConsumerCorpusFrame[]; manifest: GameplayConsumerCorpusManifest }>
> {
  const lines = await readFile(`${gameplayConsumerCorpusOutputDir}/frames.jsonl`, 'utf8');
  const frames = lines
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GameplayConsumerCorpusFrame);
  const manifest = JSON.parse(
    await readFile(`${gameplayConsumerCorpusOutputDir}/manifest.json`, 'utf8'),
  ) as GameplayConsumerCorpusManifest;
  return { frames, manifest };
}
