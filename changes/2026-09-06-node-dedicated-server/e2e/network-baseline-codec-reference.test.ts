import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createBaselineReferenceInFlightLedger } from '../../../packages/game-core/src/server/protocol/network-reference-baseline-budget';
import { createBaselineReferenceReassembler } from '../../../packages/game-core/src/server/protocol/network-reference-baseline-reassembly';
import type {
  BaselineBundleDescriptorReference,
  BaselinePageReference,
  ReassembledBaselineReference,
} from '../../../packages/game-core/src/server/protocol/network-reference-baseline-types';

const prototype = '/tmp/seedlands-network-probe-codec-baseline-reference-v2';
const artifactPath = `${prototype}/baseline-codec-decoded-artifact.json`;
const validationPath = `${prototype}/baseline-codec-validation.json`;
const framesPath = '/tmp/seedlands-network-baseline-reference-projected-v1-r2/frames.jsonl';
const evidencePath = 'changes/2026-09-06-node-dedicated-server/network-baseline-codec-evidence.json';
const expectedInput = Object.freeze({
  derivedManifest: '9d590ded6a1b050f9b7c42cdf3638ca957509f888a2e89de909ee264b6f85dfb',
  derivedFrames: '4320c31fd0c46b58c4bf158f4d94cd59991f9f810abd8a09dc3ada3fbb0b766d',
  rawManifest: '0d2959e728f73a30efec8c9bac0f58269b9d0b51f3c73c23b0640fbbb1b7b0ad',
  rawFrames: '2d3a0a9fd1670c087367fbb1c9330eda9e2484d9e7facd665892c6128e5f3b91',
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const limits = Object.freeze({
  metadataBytesMax: 64 * 1024,
  reliableMessageBytesMax: 1024 * 1024,
  baselineTransferBytesMax: 1024 * 1024,
  baselineInFlightBytesMax: 16 * 1024 * 1024,
  sendQueueBytesMax: 4 * 1024 * 1024,
});
const digest = Object.freeze({
  algorithm: 'sha-256' as const,
  digest: async (bytes: Uint8Array) => sha256(bytes),
});
const sizer = Object.freeze({
  measureMetadataBytes: (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength,
  measureReliableMessageBytes: (metadata: unknown, bytes: Uint8Array) =>
    new TextEncoder().encode(JSON.stringify(metadata)).byteLength + bytes.byteLength,
});

type DecodedRecord = Readonly<{
  label: string;
  category: string;
  metadata: unknown;
  binary: readonly Readonly<{ name: string; base64: string }>[];
}>;
type DecodedArtifact = Readonly<{
  format: string;
  wireStatus: string;
  input: typeof expectedInput;
  codecs: Readonly<Record<'C0' | 'C1' | 'C2', readonly DecodedRecord[]>>;
  synthetic32KiB: Readonly<Record<'C0' | 'C1' | 'C2', readonly DecodedRecord[]>>;
}>;
type Evidence = Readonly<{
  prototype: Readonly<{
    sourceSha256: Readonly<Record<string, string>>;
    validationJsonSha256: string;
    decodedArtifactSha256: string;
  }>;
}>;
type CorpusFrame = Readonly<{
  frameId: string;
  descriptor: BaselineBundleDescriptorReference;
  pages: readonly Readonly<{ arrivalIndex: number }>[];
  reassembled: readonly Readonly<{ entryId: number; canonicalSha256: string; fluidSha256: string }>[];
}>;

function decodedPage(record: DecodedRecord): BaselinePageReference {
  expect(record.category).toBe('baseline-page');
  expect(record.binary).toHaveLength(1);
  expect(record.binary[0]?.name).toBe('bytes');
  return {
    ...(record.metadata as Omit<BaselinePageReference, 'bytes'>),
    bytes: new Uint8Array(Buffer.from(record.binary[0]!.base64, 'base64')),
  };
}

function indexRecords(records: readonly DecodedRecord[], frames: readonly CorpusFrame[]) {
  expect(records).toHaveLength(333);
  const index = new Map<string, DecodedRecord>();
  for (const record of records) {
    expect(index.has(record.label)).toBe(false);
    index.set(record.label, record);
  }
  const expected = new Set<string>();
  for (const frame of frames) {
    expected.add(`${frame.frameId}:descriptor`);
    for (const page of frame.pages) expected.add(`${frame.frameId}:page:${page.arrivalIndex}`);
  }
  expect(index.size).toBe(expected.size);
  expect([...index.keys()].sort()).toEqual([...expected].sort());
  expect([...index.values()].filter((record) => record.category === 'baseline-bundle-descriptor')).toHaveLength(3);
  expect([...index.values()].filter((record) => record.category === 'baseline-page')).toHaveLength(330);
  return index;
}

async function reassembleCodecFrame(
  index: ReadonlyMap<string, DecodedRecord>,
  frame: CorpusFrame,
): Promise<ReassembledBaselineReference> {
  const descriptorRecord = index.get(`${frame.frameId}:descriptor`);
  expect(descriptorRecord?.category).toBe('baseline-bundle-descriptor');
  const descriptor = descriptorRecord!.metadata as BaselineBundleDescriptorReference;
  const reassembler = createBaselineReferenceReassembler({
    ref: descriptor.ref,
    limits,
    pagesPerBundleMax: frame.pages.length,
    digest,
    sizer,
    inFlight: createBaselineReferenceInFlightLedger(limits.baselineInFlightBytesMax),
  });
  try {
    reassembler.acceptDescriptor(descriptor);
    const terminal: ReassembledBaselineReference[] = [];
    for (const page of frame.pages) {
      const record = index.get(`${frame.frameId}:page:${page.arrivalIndex}`);
      expect(record).toBeDefined();
      const received = await reassembler.acceptPage(decodedPage(record!));
      if (received !== null) terminal.push(received);
    }
    await reassembler.whenIdle();
    expect(terminal).toHaveLength(1);
    expect(reassembler.diagnostics().reservedBlockBytes).toBe(0);
    return terminal[0]!;
  } finally {
    await reassembler.close();
    await reassembler.whenIdle();
    expect(reassembler.diagnostics().reservedBlockBytes).toBe(0);
  }
}

describe('冻结基线 descriptor/page 候选编解码', () => {
  it('只读核验绑定 artifact，并把三种临时解码产物按真实抵达序列交给 production reassembler', async () => {
    const [artifactBytes, validationBytes, evidenceText, framesText] = await Promise.all([
      readFile(artifactPath),
      readFile(validationPath),
      readFile(evidencePath, 'utf8'),
      readFile(framesPath, 'utf8'),
    ]);
    const decoded = JSON.parse(artifactBytes.toString('utf8')) as DecodedArtifact;
    const evidence = JSON.parse(evidenceText) as Evidence;
    const frames = framesText
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as CorpusFrame);
    expect(decoded.format).toBe('baseline-codec-decoded-artifact/v1');
    expect(decoded.wireStatus).toBe('not-adopted');
    expect(decoded.input).toEqual(expectedInput);
    const inputFiles = [
      ['/tmp/seedlands-network-baseline-reference-projected-v1-r2/manifest.json', expectedInput.derivedManifest],
      [framesPath, expectedInput.derivedFrames],
      ['/tmp/seedlands-network-baseline-corpus-v1-r2/manifest.json', expectedInput.rawManifest],
      ['/tmp/seedlands-network-baseline-corpus-v1-r2/frames.jsonl', expectedInput.rawFrames],
    ] as const;
    for (const [file, expectedHash] of inputFiles) expect(sha256(await readFile(file))).toBe(expectedHash);
    expect(frames).toHaveLength(3);
    expect(sha256(validationBytes)).toBe(evidence.prototype.validationJsonSha256);
    expect(sha256(artifactBytes)).toBe(evidence.prototype.decodedArtifactSha256);
    for (const [file, expectedHash] of Object.entries(evidence.prototype.sourceSha256))
      expect(sha256(await readFile(`${prototype}/${file}`))).toBe(expectedHash);

    for (const codec of ['C0', 'C1', 'C2'] as const) {
      const index = indexRecords(decoded.codecs[codec], frames);
      for (const frame of frames) {
        const reassembled = await reassembleCodecFrame(index, frame);
        expect(reassembled.descriptor).toEqual(frame.descriptor);
        expect(reassembled.entries).toHaveLength(frame.reassembled.length);
        for (const expected of frame.reassembled) {
          const entry = reassembled.entries.find((value) => value.entryId === expected.entryId);
          expect(entry).toBeDefined();
          expect(sha256(entry!.canonicalLittleEndian)).toBe(expected.canonicalSha256);
          expect(sha256(entry!.fluid)).toBe(expected.fluidSha256);
        }
      }
      const synthetic = decoded.synthetic32KiB[codec];
      expect(synthetic).toHaveLength(4);
      const syntheticDescriptorRecord = synthetic.find((record) => record.category === 'baseline-bundle-descriptor');
      expect(syntheticDescriptorRecord).toBeDefined();
      const syntheticDescriptor = syntheticDescriptorRecord!.metadata as BaselineBundleDescriptorReference;
      expect(syntheticDescriptor.entries[0]?.blocks.map((block) => block.referencePagePayloadBytes)).toEqual([
        32 * 1024,
        32 * 1024,
      ]);
      const syntheticReassembler = createBaselineReferenceReassembler({
        ref: syntheticDescriptor.ref,
        limits,
        pagesPerBundleMax: 3,
        digest,
        sizer,
        inFlight: createBaselineReferenceInFlightLedger(limits.baselineInFlightBytesMax),
      });
      try {
        syntheticReassembler.acceptDescriptor(syntheticDescriptor);
        const terminal: ReassembledBaselineReference[] = [];
        for (const page of synthetic.filter((record) => record.category === 'baseline-page')) {
          const completed = await syntheticReassembler.acceptPage(decodedPage(page));
          if (completed !== null) terminal.push(completed);
        }
        await syntheticReassembler.whenIdle();
        expect(terminal).toHaveLength(1);
        const entry = terminal[0]!.entries[0]!;
        expect(entry.canonicalLittleEndian).toHaveLength(64 * 1024);
        expect(entry.fluid).toHaveLength(32 * 1024);
        expect(sha256(entry.canonicalLittleEndian)).toBe(syntheticDescriptor.entries[0]!.blocks[0]!.sha256);
        expect(sha256(entry.fluid)).toBe(syntheticDescriptor.entries[0]!.blocks[1]!.sha256);
      } finally {
        await syntheticReassembler.close();
        await syntheticReassembler.whenIdle();
        expect(syntheticReassembler.diagnostics().reservedBlockBytes).toBe(0);
      }
    }
  });
});
