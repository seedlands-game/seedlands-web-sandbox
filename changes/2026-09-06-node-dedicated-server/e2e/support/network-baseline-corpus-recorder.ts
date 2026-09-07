import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AuthorityBaselineCaptureRequest,
  AuthorityBaselineCaptureResult,
} from '../../../../src/server/authority/authority-baseline-capture-types';

export const networkBaselineCorpusOutputDirectory = '/tmp/seedlands-network-baseline-corpus-v1-r2';

type AvailableCapture = Extract<AuthorityBaselineCaptureResult, { status: 'available' }>;
export type NetworkBaselineCorpusScenario = 'unmodified-mesh' | 'edited-main-mesh' | 'collision-resync';
type SnapshotIdentity = Readonly<{
  epoch: string;
  physicsTick: number;
  commitSequence: number;
  worldRevision: number;
}>;

export type NetworkBaselineCorpusCapture = Readonly<{
  scenario: NetworkBaselineCorpusScenario;
  request: AuthorityBaselineCaptureRequest;
  snapshotBeforeCapture: SnapshotIdentity;
  result: AvailableCapture;
}>;

type BinaryDescriptor = Readonly<{
  name: 'canonical' | 'fluid';
  path: string;
  elementType: 'uint16-le' | 'uint8';
  byteOrder: 'little-endian' | 'not-applicable';
  byteLength: number;
  sha256: string;
}>;
type DiskEntry = Readonly<{
  entryId: number;
  role: 'main' | 'overlay' | 'collision-resync';
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  binary: readonly [BinaryDescriptor, BinaryDescriptor];
}>;
type DiskFrame = Readonly<{
  frameId: string;
  category: 'authority-baseline-capture';
  direction: 'server-to-client';
  scenario: NetworkBaselineCorpusScenario;
  request: AuthorityBaselineCaptureRequest;
  checkpoint: SnapshotIdentity;
  entries: readonly DiskEntry[];
  producerInput: Readonly<{
    request: AuthorityBaselineCaptureRequest;
    snapshotBeforeCapture: SnapshotIdentity;
  }>;
  producerOutput: Readonly<{
    captureId: number;
    captureGeneration: number;
    purpose: AuthorityBaselineCaptureRequest['purpose'];
    key: string;
    checkpoint: SnapshotIdentity;
    entries: readonly DiskEntry[];
  }>;
  producerInputSha256: string;
  producerOutputSha256: string;
  contentSha256: string;
  provenance: Readonly<{ kind: 'real-dedicated-host'; manifestPayloadSha256: string }>;
}>;
type Manifest = Readonly<{
  format: 'seedlands-network-baseline-corpus/v1';
  generatedBy: string;
  runtime: Readonly<{ node: string; platform: string; arch: string }>;
  config: object;
  gitSha: string;
  trackedSourceDiffSha256: string;
  sourceFiles: readonly Readonly<{ path: string; sha256: string }>[];
  records: readonly Readonly<{
    frameId: string;
    scenario: NetworkBaselineCorpusScenario;
    contentSha256: string;
  }>[];
  notCollected: readonly string[];
  manifestPayloadSha256: string;
  corpusSha256: string;
}>;

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

function littleEndianCanonical(source: ArrayBuffer): Uint8Array {
  const values = new Uint16Array(source);
  const output = new Uint8Array(values.length * Uint16Array.BYTES_PER_ELEMENT);
  const view = new DataView(output.buffer);
  values.forEach((value, index) => view.setUint16(index * Uint16Array.BYTES_PER_ELEMENT, value, true));
  return output;
}

function assertCaptureSequence(captures: readonly NetworkBaselineCorpusCapture[]): void {
  if (captures.length !== 3) throw new RangeError('Baseline corpus requires exactly three capture scenarios.');
  const scenarios = captures.map(({ scenario }) => scenario).join(',');
  if (scenarios !== 'unmodified-mesh,edited-main-mesh,collision-resync')
    throw new TypeError('Baseline corpus scenarios must be ordered unmodified mesh, edited mesh, collision resync.');
  for (const capture of captures) {
    const { request, result } = capture;
    if (result.captureId !== request.captureId || result.purpose !== request.purpose || result.key !== request.key)
      throw new TypeError('Baseline corpus capture identity does not match its request.');
    const expectedEntries = request.purpose === 'mesh' ? 27 : 1;
    if (result.entries.length !== expectedEntries) throw new RangeError('Baseline capture entry count is invalid.');
  }
}

async function assertDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing corpus: ${path}`);
}

export async function networkBaselineCorpusExists(): Promise<boolean> {
  try {
    await lstat(networkBaselineCorpusOutputDirectory);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function writeNetworkBaselineCorpus(
  options: Readonly<{
    captures: readonly NetworkBaselineCorpusCapture[];
    sourcePaths: readonly string[];
    config: object;
  }>,
): Promise<Readonly<{ manifest: Manifest; frames: readonly DiskFrame[] }>> {
  assertCaptureSequence(options.captures);
  const staging = `${networkBaselineCorpusOutputDirectory}.staging-${process.pid}`;
  const claim = `${networkBaselineCorpusOutputDirectory}.publish-claim`;
  await mkdir(claim);
  try {
    await assertDoesNotExist(networkBaselineCorpusOutputDirectory);
    await assertDoesNotExist(staging);
    await mkdir(staging);
    await mkdir(join(staging, 'blocks'));

    const staged: Omit<DiskFrame, 'provenance'>[] = [];
    for (const [captureIndex, capture] of options.captures.entries()) {
      const frameId = `${String(captureIndex).padStart(3, '0')}-${capture.scenario}`;
      const entries: DiskEntry[] = [];
      for (const [entryId, entry] of capture.result.entries.entries()) {
        const prefix = `${String(captureIndex).padStart(3, '0')}-${String(entryId).padStart(2, '0')}-${entry.role}`;
        const canonical = littleEndianCanonical(entry.canonical);
        const fluid = new Uint8Array(entry.fluid.slice(0));
        const canonicalPath = `blocks/${prefix}-canonical.uint16-le.bin`;
        const fluidPath = `blocks/${prefix}-fluid.uint8.bin`;
        await writeFile(join(staging, canonicalPath), canonical);
        await writeFile(join(staging, fluidPath), fluid);
        entries.push({
          entryId,
          role: entry.role,
          key: entry.key,
          chunkRevision: entry.chunkRevision,
          generatorVersion: entry.generatorVersion,
          binary: [
            {
              name: 'canonical',
              path: canonicalPath,
              elementType: 'uint16-le',
              byteOrder: 'little-endian',
              byteLength: canonical.byteLength,
              sha256: sha256(canonical),
            },
            {
              name: 'fluid',
              path: fluidPath,
              elementType: 'uint8',
              byteOrder: 'not-applicable',
              byteLength: fluid.byteLength,
              sha256: sha256(fluid),
            },
          ],
        });
      }
      const producerInput = {
        request: structuredClone(capture.request),
        snapshotBeforeCapture: structuredClone(capture.snapshotBeforeCapture),
      };
      const producerOutput = {
        captureId: capture.result.captureId,
        captureGeneration: capture.result.captureGeneration,
        purpose: capture.result.purpose,
        key: capture.result.key,
        checkpoint: structuredClone(capture.result.checkpoint),
        entries,
      };
      const core = {
        frameId,
        category: 'authority-baseline-capture' as const,
        direction: 'server-to-client' as const,
        scenario: capture.scenario,
        request: producerInput.request,
        checkpoint: producerOutput.checkpoint,
        entries,
        producerInput,
        producerOutput,
        producerInputSha256: sha256(JSON.stringify(producerInput)),
        producerOutputSha256: sha256(JSON.stringify(producerOutput)),
      };
      staged.push({ ...core, contentSha256: sha256(JSON.stringify(core)) });
    }

    const sourceFiles = await Promise.all(
      options.sourcePaths.map(async (path) => ({ path, sha256: sha256(await readFile(path)) })),
    );
    const manifestPayload = {
      format: 'seedlands-network-baseline-corpus/v1' as const,
      generatedBy: 'changes/2026-09-06-node-dedicated-server/e2e/network-baseline-corpus.test.ts',
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      config: options.config,
      gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      trackedSourceDiffSha256: sha256(
        execFileSync('git', ['diff', '--binary', 'HEAD'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
      ),
      sourceFiles,
      records: staged.map(({ frameId, scenario, contentSha256 }) => ({ frameId, scenario, contentSha256 })),
      notCollected: [
        'public interest/session owner and cancellation state machine',
        'baseline descriptor/page framing, reliable transport, and queue backpressure',
        'browser Remote adapter installation and gameplay E2E',
        'capture cancellation, superseded copy, and transport failure corpus scenarios',
      ],
    };
    const manifestPayloadSha256 = sha256(JSON.stringify(manifestPayload));
    const frames = staged.map((frame) => ({
      ...frame,
      provenance: { kind: 'real-dedicated-host' as const, manifestPayloadSha256 },
    }));
    const lines = `${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`;
    const manifest: Manifest = {
      ...manifestPayload,
      manifestPayloadSha256,
      corpusSha256: sha256(lines),
    };
    await writeFile(join(staging, 'frames.jsonl'), lines);
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(staging, networkBaselineCorpusOutputDirectory);
    return { manifest, frames };
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(claim, { recursive: true, force: true });
  }
}

/** 已发布语料只读核验；它从不修改固定 generation。 */
export async function readNetworkBaselineCorpus(
  options: Readonly<{ sourcePaths: readonly string[] }>,
): Promise<Readonly<{ manifest: Manifest; frames: readonly DiskFrame[] }>> {
  const manifestText = await readFile(join(networkBaselineCorpusOutputDirectory, 'manifest.json'), 'utf8');
  const lines = await readFile(join(networkBaselineCorpusOutputDirectory, 'frames.jsonl'), 'utf8');
  const manifest = JSON.parse(manifestText) as Manifest;
  const frames = lines
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as DiskFrame);
  const { manifestPayloadSha256, corpusSha256, ...manifestPayload } = manifest;
  if (sha256(JSON.stringify(manifestPayload)) !== manifestPayloadSha256)
    throw new TypeError('Baseline corpus manifest payload hash is invalid.');
  if (sha256(lines) !== corpusSha256) throw new TypeError('Baseline corpus frame hash is invalid.');
  if (manifest.records.length !== frames.length) throw new TypeError('Baseline corpus record count is invalid.');
  const expectedSourcePaths = [...options.sourcePaths].sort();
  const actualSourcePaths = manifest.sourceFiles.map(({ path }) => path).sort();
  if (JSON.stringify(actualSourcePaths) !== JSON.stringify(expectedSourcePaths))
    throw new TypeError('Baseline corpus source file set is stale or incomplete.');
  for (const source of manifest.sourceFiles) {
    if (sha256(await readFile(source.path)) !== source.sha256)
      throw new TypeError(`Baseline corpus source file hash changed: ${source.path}`);
  }
  for (const [index, frame] of frames.entries()) {
    const { provenance, contentSha256, ...core } = frame;
    const manifestRecord = manifest.records[index];
    if (
      sha256(JSON.stringify(core)) !== contentSha256 ||
      sha256(JSON.stringify(frame.producerInput)) !== frame.producerInputSha256 ||
      sha256(JSON.stringify(frame.producerOutput)) !== frame.producerOutputSha256 ||
      manifestRecord.frameId !== frame.frameId ||
      manifestRecord.scenario !== frame.scenario ||
      manifestRecord.contentSha256 !== contentSha256 ||
      provenance.manifestPayloadSha256 !== manifestPayloadSha256
    )
      throw new TypeError('Baseline corpus frame provenance is invalid.');
    if (
      JSON.stringify(frame.request) !== JSON.stringify(frame.producerInput.request) ||
      frame.producerOutput.captureId !== frame.request.captureId ||
      frame.producerOutput.purpose !== frame.request.purpose ||
      frame.producerOutput.key !== frame.request.key ||
      JSON.stringify(frame.checkpoint) !== JSON.stringify(frame.producerOutput.checkpoint) ||
      JSON.stringify(frame.entries) !== JSON.stringify(frame.producerOutput.entries)
    )
      throw new TypeError('Baseline corpus producer values do not bind the published frame.');
    for (const entry of frame.entries)
      for (const block of entry.binary) {
        const bytes = await readFile(join(networkBaselineCorpusOutputDirectory, block.path));
        if (
          bytes.byteLength !== block.byteLength ||
          sha256(bytes) !== block.sha256 ||
          (block.name === 'canonical' && (block.elementType !== 'uint16-le' || block.byteOrder !== 'little-endian')) ||
          (block.name === 'fluid' && (block.elementType !== 'uint8' || block.byteOrder !== 'not-applicable'))
        )
          throw new TypeError('Baseline corpus block descriptor is invalid.');
      }
  }
  return { manifest, frames };
}
