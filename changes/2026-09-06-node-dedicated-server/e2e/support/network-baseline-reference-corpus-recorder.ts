import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createBaselineReferenceInFlightLedger,
  createBaselineReferenceSendQueue,
} from '../../../../packages/game-core/src/server/protocol/network-reference-baseline-budget';
import { createBaselineReferencePublicationQueue } from '../../../../packages/game-core/src/server/protocol/network-reference-baseline-publication';
import { createBaselineReferenceReassembler } from '../../../../packages/game-core/src/server/protocol/network-reference-baseline-reassembly';
import { prepareAuthorityBaselineReference } from '../../../../packages/game-core/src/server/protocol/network-reference-baseline';
import type {
  BaselineBundleDescriptorReference,
  BaselinePageLocator,
  BaselineReferenceLimits,
  ReassembledBaselineReference,
} from '../../../../packages/game-core/src/server/protocol/network-reference-baseline-types';
import { networkBaselineCorpusOutputDirectory, readNetworkBaselineCorpus } from './network-baseline-corpus-recorder';
import {
  assertDerivedFrameBindsSourceBoundRaw,
  assertReassembledMatchesSourceBoundRaw,
  restoreSourceBoundCapture,
  type NetworkBaselineRawEntryBytes,
  type NetworkBaselineRawFrame,
} from './network-baseline-reference-corpus-raw';
import type {
  DerivedFrame,
  DerivedManifest,
  DerivedPage,
  NetworkBaselineReferenceCorpus,
} from './network-baseline-reference-corpus-types';

export const networkBaselineReferenceCorpusOutputDirectory =
  '/tmp/seedlands-network-baseline-reference-projected-v1-r2';

const rawManifestSha256 = '0d2959e728f73a30efec8c9bac0f58269b9d0b51f3c73c23b0640fbbb1b7b0ad';
const rawFramesSha256 = '2d3a0a9fd1670c087367fbb1c9330eda9e2484d9e7facd665892c6128e5f3b91';
const referencePagePayloadBytes = 16 * 1024;
const referenceLimits: BaselineReferenceLimits = Object.freeze({
  metadataBytesMax: 64 * 1024,
  reliableMessageBytesMax: 1024 * 1024,
  baselineTransferBytesMax: 1024 * 1024,
  baselineInFlightBytesMax: 16 * 1024 * 1024,
  sendQueueBytesMax: 4 * 1024 * 1024,
});

const rawSourcePaths = [
  'src/server/authority/authority-baseline-capture.ts',
  'src/server/canonical-chunk-observation.ts',
  'src/server/dedicated/dedicated-baseline-capture.ts',
  'src/server/dedicated/dedicated-canonical-admission.ts',
  'src/server/dedicated/dedicated-chunk-requests.ts',
  'src/server/dedicated/dedicated-server-host.ts',
  'src/server/server-mesh-snapshots.ts',
  'src/world/mesh.ts',
  'src/world/voxel.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-baseline-corpus-recorder.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-baseline-corpus.test.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/vitest.baseline-corpus.config.ts',
] as const;

const referenceSourcePaths = [
  'src/server/protocol/network-reference-baseline.ts',
  'src/server/protocol/network-reference-baseline-types.ts',
  'src/server/protocol/network-reference-baseline-owned.ts',
  'src/server/protocol/network-reference-baseline-budget.ts',
  'src/server/protocol/network-reference-baseline-publication.ts',
  'src/server/protocol/network-reference-baseline-reassembly.ts',
  'src/server/protocol/network-reference-baseline-validation.ts',
] as const;

const frozenReferenceSourceHashes: Readonly<Record<(typeof referenceSourcePaths)[number], string>> = Object.freeze({
  'src/server/protocol/network-reference-baseline.ts':
    '168c1edc72a288b2ec53a2a73abfff0e10f08dc07054824a11abe7644153f7ce',
  'src/server/protocol/network-reference-baseline-types.ts':
    '46ca686323539fd8eb3573c00565cf072438431ad8e0abb11031b70865bac7a2',
  'src/server/protocol/network-reference-baseline-owned.ts':
    '2bbdde806a7145ac1a2036863018d9d25286bcb543d2beb002f7f6866319ec4a',
  'src/server/protocol/network-reference-baseline-budget.ts':
    '033e9ccb5ad901fc951415d3c143e5666902f4516dc2e6fd12e402bba9dc1acb',
  'src/server/protocol/network-reference-baseline-publication.ts':
    '835e0881684de079b7b1053f0bf4f55bbd1d530422c0d5ebc3b9f96ac87a605e',
  'src/server/protocol/network-reference-baseline-reassembly.ts':
    '6852c282d5d168623f1a249f4fbfd9295afaacaa6982644071b7818e0e85aa6d',
  'src/server/protocol/network-reference-baseline-validation.ts':
    '9872ecd8899ac1489183c1f2c09ceaabde21ef25e1d84dcc6a8c47ffd202b51b',
});

const producerSourcePaths = [
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-baseline-reference-corpus-recorder.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-baseline-reference-corpus-raw.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-baseline-reference-corpus-types.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-baseline-reference-corpus.test.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/vitest.baseline-reference-corpus.config.ts',
] as const;

type RunMode = 'capture' | 'preview' | 'recheck';
type RawCorpus = Awaited<ReturnType<typeof readNetworkBaselineCorpus>>;
type RawFrame = NetworkBaselineRawFrame;
type RawBlock = RawFrame['entries'][number]['binary'][number];
type DerivedOutput = Readonly<{
  corpus: NetworkBaselineReferenceCorpus;
  pageBytes: ReadonlyMap<string, Uint8Array>;
}>;
export type { NetworkBaselineReferenceCorpus } from './network-baseline-reference-corpus-types';

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

const sizer = Object.freeze({
  measureMetadataBytes: (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength,
  measureReliableMessageBytes: (metadata: unknown, bytes: Uint8Array) =>
    new TextEncoder().encode(JSON.stringify(metadata)).byteLength + bytes.byteLength,
});

const digest = Object.freeze({ algorithm: 'sha-256' as const, digest: async (bytes: Uint8Array) => sha256(bytes) });

export async function networkBaselineReferenceCorpusExists(): Promise<boolean> {
  try {
    await lstat(networkBaselineReferenceCorpusOutputDirectory);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** 默认只重核验；preview 从 r2 完整派生但不写盘；capture 需要调用者显式确认冻结。 */
export async function runNetworkBaselineReferenceCorpus(
  options: Readonly<{ mode?: RunMode; sourceFrozen?: boolean }> = {},
): Promise<NetworkBaselineReferenceCorpus> {
  const mode = options.mode ?? 'recheck';
  if (mode === 'recheck') return readNetworkBaselineReferenceCorpus();
  if (mode === 'capture' && !options.sourceFrozen)
    throw new Error('Reference source is not declared frozen; refusing to capture a derived corpus.');
  const input = await readAndBindRawCorpus();
  const derived = await derive(input);
  if (mode === 'preview') return derived.corpus;
  return writeNetworkBaselineReferenceCorpus(derived);
}

export async function readNetworkBaselineReferenceCorpus(): Promise<NetworkBaselineReferenceCorpus> {
  const manifestText = await readFile(join(networkBaselineReferenceCorpusOutputDirectory, 'manifest.json'), 'utf8');
  const framesText = await readFile(join(networkBaselineReferenceCorpusOutputDirectory, 'frames.jsonl'), 'utf8');
  const manifest = JSON.parse(manifestText) as DerivedManifest;
  const frames = framesText
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as DerivedFrame);
  const { manifestPayloadSha256, corpusSha256, ...payload } = manifest;
  if (sha256(JSON.stringify(payload)) !== manifestPayloadSha256)
    throw new TypeError('Derived baseline manifest hash is invalid.');
  if (sha256(framesText) !== corpusSha256) throw new TypeError('Derived baseline frames hash is invalid.');
  if (manifest.records.length !== 3 || frames.length !== 3)
    throw new TypeError('Derived baseline record count is invalid.');
  const expectedSourcePaths = [...referenceSourcePaths, ...producerSourcePaths].sort();
  if (JSON.stringify(manifest.sourceFiles.map((file) => file.path).sort()) !== JSON.stringify(expectedSourcePaths))
    throw new TypeError('Derived baseline source file set is stale or incomplete.');
  for (const source of manifest.sourceFiles)
    if (sha256(await readFile(source.path)) !== source.sha256)
      throw new TypeError(`Derived baseline source file hash changed: ${source.path}`);
  const raw = await readAndBindRawCorpus();
  if (
    manifest.sourceCorpus.manifestSha256 !== raw.manifestSha256 ||
    manifest.sourceCorpus.framesSha256 !== raw.framesSha256 ||
    manifest.sourceCorpus.corpusSha256 !== raw.published.manifest.corpusSha256
  )
    throw new TypeError('Derived baseline source corpus identity changed.');
  for (const frame of frames) {
    const { contentSha256, provenance, ...core } = frame;
    if (sha256(JSON.stringify(core)) !== contentSha256) throw new TypeError('Derived baseline frame hash is invalid.');
    if (
      provenance.rawManifestSha256 !== raw.manifestSha256 ||
      provenance.rawFramesSha256 !== raw.framesSha256 ||
      !manifest.records.some((record) => record.frameId === frame.frameId && record.contentSha256 === contentSha256)
    )
      throw new TypeError('Derived baseline frame provenance is invalid.');
    const source = raw.published.frames.find((candidate) => candidate.frameId === frame.source.frameId);
    if (!source) throw new TypeError('Derived baseline source frame is absent from r2.');
    assertDerivedFrameBindsSourceBoundRaw(frame, source);
    for (const page of frame.pages) {
      const bytes = new Uint8Array(await readFile(join(networkBaselineReferenceCorpusOutputDirectory, page.path)));
      if (bytes.byteLength !== page.byteLength || sha256(bytes) !== page.sha256)
        throw new TypeError('Derived baseline page sidecar is invalid.');
    }
  }
  return { manifest, frames };
}

async function readAndBindRawCorpus(): Promise<
  Readonly<{
    published: RawCorpus;
    manifestSha256: string;
    framesSha256: string;
    sidecarCount: number;
    entries: readonly (readonly NetworkBaselineRawEntryBytes[])[];
  }>
> {
  const manifestText = await readFile(join(networkBaselineCorpusOutputDirectory, 'manifest.json'), 'utf8');
  const framesText = await readFile(join(networkBaselineCorpusOutputDirectory, 'frames.jsonl'), 'utf8');
  const manifestSha256 = sha256(manifestText);
  const framesSha256 = sha256(framesText);
  if (manifestSha256 !== rawManifestSha256) throw new TypeError('Frozen r2 manifest file SHA-256 does not match.');
  if (framesSha256 !== rawFramesSha256) throw new TypeError('Frozen r2 frames file SHA-256 does not match.');
  const published = await readNetworkBaselineCorpus({ sourcePaths: rawSourcePaths });
  if (published.manifest.corpusSha256 !== rawFramesSha256 || published.frames.length !== 3)
    throw new TypeError('Frozen r2 corpus identity is invalid.');
  const expectedLengths = [27, 27, 1];
  if (JSON.stringify(published.frames.map((frame) => frame.entries.length)) !== JSON.stringify(expectedLengths))
    throw new TypeError('Frozen r2 capture shape is invalid.');
  let sidecarCount = 0;
  const entries = await Promise.all(
    published.frames.map(async (frame) =>
      Promise.all(
        frame.entries.map(async (entry) => {
          const canonical = await readRawBlock(entry.binary[0]);
          const fluid = await readRawBlock(entry.binary[1]);
          sidecarCount += 2;
          return Object.freeze({ canonical, fluid });
        }),
      ),
    ),
  );
  if (sidecarCount !== 110) throw new TypeError('Frozen r2 sidecar count is invalid.');
  return Object.freeze({ published, manifestSha256, framesSha256, sidecarCount, entries });
}

async function derive(input: Awaited<ReturnType<typeof readAndBindRawCorpus>>): Promise<DerivedOutput> {
  const sourceFiles = await sourceFileHashes([...referenceSourcePaths, ...producerSourcePaths]);
  for (const source of sourceFiles) {
    const frozen = frozenReferenceSourceHashes[source.path as keyof typeof frozenReferenceSourceHashes];
    if (frozen && source.sha256 !== frozen)
      throw new TypeError(`Frozen reference source hash does not match: ${source.path}`);
  }
  const queue = createBaselineReferencePublicationQueue();
  const frames: DerivedFrame[] = [];
  const pageBytes = new Map<string, Uint8Array>();
  for (const [index, raw] of input.published.frames.entries()) {
    const rawEntries = input.entries[index]!;
    const result = restoreSourceBoundCapture(raw, rawEntries);
    const expectedPages = raw.request.purpose === 'mesh' ? 162 : 6;
    const inFlight = createBaselineReferenceInFlightLedger(referenceLimits.baselineInFlightBytesMax);
    const prepared = await prepareAuthorityBaselineReference(result, {
      ref: {
        epoch: result.checkpoint.epoch,
        serverEpoch: 'source-bound-reference-server-v1',
        sessionId: `source-bound-reference-${raw.frameId}`,
        worldId: 'source-bound-reference-world-v1',
      },
      requestId: 1000 + index,
      interestId: result.purpose === 'mesh' ? 2000 + index : null,
      expectedCapture: {
        captureId: result.captureId,
        captureGeneration: result.captureGeneration,
        purpose: result.purpose,
        key: result.key,
        generatorVersion: result.entries[0]!.generatorVersion,
      },
      minimumRevision: raw.request.minimumRevision,
      referencePagePayloadBytes,
      pagesPerBundleMax: expectedPages,
      limits: referenceLimits,
      digest,
      sizer,
      inFlight,
    });
    if ('kind' in prepared)
      throw new Error(`Reference projection was unavailable for ${raw.frameId}: ${prepared.reason}.`);
    const published = prepared.publish(queue);
    const sendQueue = createBaselineReferenceSendQueue(referenceLimits.sendQueueBytesMax);
    const descriptorLease = queue.takeDescriptor(sendQueue);
    if (!descriptorLease) throw new Error(`Reference descriptor was not publishable for ${raw.frameId}.`);
    const descriptor = descriptorLease.descriptor;
    descriptorLease.settle();
    if (published.pageCount !== expectedPages)
      throw new TypeError('Reference page count does not match the fixed candidate.');
    const reassembler = createBaselineReferenceReassembler({
      ref: descriptor.ref,
      limits: referenceLimits,
      pagesPerBundleMax: expectedPages,
      digest,
      sizer,
      inFlight: createBaselineReferenceInFlightLedger(referenceLimits.baselineInFlightBytesMax),
    });
    reassembler.acceptDescriptor(descriptor);
    const natural = locators(descriptor);
    const order = deterministicOrder(natural);
    const pageRecords: DerivedPage[] = [];
    const arrivals: Promise<ReassembledBaselineReference | null>[] = [];
    for (const [arrivalIndex, item] of order.entries()) {
      const lease = published.materializePage(item.locator, sendQueue);
      if (!lease) throw new Error(`Reference page could not reserve the send queue for ${raw.frameId}.`);
      const page = lease.page;
      const metadata = { ...page, bytes: undefined };
      const bytes = new Uint8Array(page.bytes);
      pageRecords.push(
        Object.freeze({
          arrivalIndex,
          naturalIndex: item.naturalIndex,
          locator: item.locator,
          path: pageSidecarPath(index, arrivalIndex),
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
          metadataBytes: sizer.measureMetadataBytes(metadata),
          reliableBytes: sizer.measureReliableMessageBytes(metadata, bytes),
        }),
      );
      arrivals.push(reassembler.acceptPage(page));
      lease.settle();
      pageBytes.set(pageSidecarPath(index, arrivalIndex), bytes);
    }
    const completed = (await Promise.all(arrivals)).filter(
      (value): value is ReassembledBaselineReference => value !== null,
    );
    if (completed.length !== 1) throw new Error(`Reference reassembly did not finish exactly once for ${raw.frameId}.`);
    const reassembled = completed[0]!;
    assertReassembledMatchesSourceBoundRaw(reassembled, raw, rawEntries);
    if (sendQueue.diagnostics().reservedBytes !== 0)
      throw new Error(`Reference budgets did not settle for ${raw.frameId}.`);
    published.close();
    if (inFlight.diagnostics().reservedBytes !== 0)
      throw new Error(`Reference owned-block reservation did not settle for ${raw.frameId}.`);
    frames.push(freezeFrame(raw, descriptor, pageRecords, reassembled, input.manifestSha256, input.framesSha256));
  }
  if (frames.map((frame) => frame.pages.length).join(',') !== '162,162,6')
    throw new TypeError('Reference page corpus does not contain the required 162/162/6 pages.');
  const payload = {
    format: 'seedlands-network-baseline-reference-projected/v1' as const,
    generatedBy: 'changes/2026-09-06-node-dedicated-server/e2e/network-baseline-reference-corpus.test.ts',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedSourceDiffSha256: sha256(
      execFileSync('git', ['diff', '--binary', 'HEAD'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    ),
    sourceFiles,
    referenceSourceFiles: referenceSourcePaths,
    producerSourceFiles: producerSourcePaths,
    sourceCorpus: {
      directory: networkBaselineCorpusOutputDirectory,
      manifestSha256: input.manifestSha256,
      manifestPayloadSha256: input.published.manifest.manifestPayloadSha256,
      framesSha256: input.framesSha256,
      corpusSha256: input.published.manifest.corpusSha256,
      recordCount: input.published.frames.length,
      sidecarCount: input.sidecarCount,
    },
    config: {
      referencePagePayloadBytes,
      expectedPages: [162, 162, 6],
      limits: referenceLimits,
      digest: 'node:crypto/sha-256' as const,
      sizer: 'json-utf8-metadata-plus-raw-payload/v1' as const,
      order: 'coprime-step-37/v1' as const,
    },
    records: frames.map(({ frameId, contentSha256 }) => ({ frameId, contentSha256 })),
    notCollected: [
      'authenticated interest/session authorization and cancellation state machine',
      'adopted codec, reliable transport, socket backpressure, and ACK timing',
      'browser Remote adapter installation plus mesh/collision gameplay E2E',
    ],
  };
  const manifestPayloadSha256 = sha256(JSON.stringify(payload));
  const framesText = `${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`;
  return Object.freeze({
    corpus: {
      manifest: Object.freeze({ ...payload, manifestPayloadSha256, corpusSha256: sha256(framesText) }),
      frames: Object.freeze(frames),
    },
    pageBytes,
  });
}

async function writeNetworkBaselineReferenceCorpus(value: DerivedOutput): Promise<NetworkBaselineReferenceCorpus> {
  const staging = `${networkBaselineReferenceCorpusOutputDirectory}.staging-${process.pid}`;
  const claim = `${networkBaselineReferenceCorpusOutputDirectory}.publish-claim`;
  await mkdir(claim);
  try {
    await assertDoesNotExist(networkBaselineReferenceCorpusOutputDirectory);
    await assertDoesNotExist(staging);
    await mkdir(join(staging, 'pages'), { recursive: true });
    for (const [path, bytes] of value.pageBytes) await writeFile(join(staging, path), bytes);
    const framesText = `${value.corpus.frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`;
    await writeFile(join(staging, 'frames.jsonl'), framesText);
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(value.corpus.manifest, null, 2)}\n`);
    await rename(staging, networkBaselineReferenceCorpusOutputDirectory);
    return value.corpus;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(claim, { recursive: true, force: true });
  }
}

function locators(
  descriptor: BaselineBundleDescriptorReference,
): readonly Readonly<{ naturalIndex: number; locator: BaselinePageLocator }>[] {
  const output: Readonly<{ naturalIndex: number; locator: BaselinePageLocator }>[] = [];
  for (const entry of descriptor.entries)
    for (const block of entry.blocks)
      for (let pageIndex = 0; pageIndex < block.pageCount; pageIndex += 1)
        output.push(
          Object.freeze({
            naturalIndex: output.length,
            locator: Object.freeze({ entryId: entry.entryId, block: block.name, pageIndex }),
          }),
        );
  return Object.freeze(output);
}

function deterministicOrder(
  values: readonly Readonly<{ naturalIndex: number; locator: BaselinePageLocator }>[],
): readonly Readonly<{ naturalIndex: number; locator: BaselinePageLocator }>[] {
  if (values.length < 2) return values;
  const start = values.length - 1;
  const output = Array.from({ length: values.length }, (_, index) => values[(start + index * 37) % values.length]!);
  if (new Set(output.map((item) => item.naturalIndex)).size !== values.length)
    throw new TypeError('Reference page order is not a permutation.');
  return Object.freeze(output);
}

function freezeFrame(
  raw: RawFrame,
  descriptor: BaselineBundleDescriptorReference,
  pages: readonly DerivedPage[],
  reassembled: ReassembledBaselineReference,
  manifestSha256: string,
  framesSha256: string,
): DerivedFrame {
  const core = {
    frameId: `reference-${raw.frameId}`,
    source: {
      frameId: raw.frameId,
      scenario: raw.scenario,
      contentSha256: raw.contentSha256,
      captureId: raw.producerOutput.captureId,
      captureGeneration: raw.producerOutput.captureGeneration,
      producerInputSha256: raw.producerInputSha256,
      producerOutputSha256: raw.producerOutputSha256,
    },
    descriptor,
    pageConfig: { referencePagePayloadBytes, expectedPageCount: pages.length },
    pages,
    reassembled: reassembled.entries.map((entry) => ({
      entryId: entry.entryId,
      canonicalSha256: sha256(entry.canonicalLittleEndian),
      fluidSha256: sha256(entry.fluid),
    })),
  };
  return Object.freeze({
    ...core,
    contentSha256: sha256(JSON.stringify(core)),
    provenance: Object.freeze({
      kind: 'reference-projected-from-source-bound-capture' as const,
      rawManifestSha256: manifestSha256,
      rawFramesSha256: framesSha256,
    }),
  });
}

async function readRawBlock(block: RawBlock): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(join(networkBaselineCorpusOutputDirectory, block.path)));
  if (bytes.byteLength !== block.byteLength || sha256(bytes) !== block.sha256)
    throw new TypeError('Frozen r2 sidecar hash is invalid.');
  return bytes;
}

async function sourceFileHashes(paths: readonly string[]) {
  return Promise.all(paths.map(async (path) => Object.freeze({ path, sha256: sha256(await readFile(path)) })));
}

function pageSidecarPath(frameIndex: number, arrivalIndex: number): string {
  return `pages/${String(frameIndex).padStart(3, '0')}-${String(arrivalIndex).padStart(3, '0')}.bin`;
}

async function assertDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing derived corpus: ${path}`);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
