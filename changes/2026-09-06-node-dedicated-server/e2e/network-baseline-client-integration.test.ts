import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerResult } from '../../../src/app/app-contracts';
import { MeshTaskScheduler, type MeshWorkerPort } from '../../../src/app/world/mesh-task-scheduler';
import type { CompleteWorkerInputLease } from '../../../src/app/world/mesh-task-source';
import { AuthorityCollisionRevisionGuard } from '../../../src/client/authority/authority-collision-mirror';
import {
  createNetworkBaselineConsumer,
  type NetworkBaselineOwnerRef,
} from '../../../src/client/authority/network-baseline-consumer';
import { PERFORMANCE_PROFILES } from '../../../src/client/presentation/performance-profile';
import { PerformanceTelemetry } from '../../../src/client/presentation/performance-telemetry';
import { createBaselineReferenceInFlightLedger } from '../../../src/server/protocol/network-reference-baseline-budget';
import { createBaselineReferenceReassembler } from '../../../src/server/protocol/network-reference-baseline-reassembly';
import {
  NETWORK_REFERENCE_BASELINE_CELL_COUNT,
  type BaselineBundleDescriptorReference,
  type BaselinePageReference,
  type ReassembledBaselineReference,
} from '../../../src/server/protocol/network-reference-baseline-types';
import { runWorldComputeTask, type GenerateMeshTaskPayload } from '../../../src/worker/world-compute-task';

const projected = '/tmp/seedlands-network-baseline-reference-projected-v1-r2';
const evidencePath = 'changes/2026-09-06-node-dedicated-server/network-baseline-codec-evidence.json';
const expectedInput = Object.freeze({
  derivedManifest: '9d590ded6a1b050f9b7c42cdf3638ca957509f888a2e89de909ee264b6f85dfb',
  derivedFrames: '4320c31fd0c46b58c4bf158f4d94cd59991f9f810abd8a09dc3ada3fbb0b766d',
  rawManifest: '0d2959e728f73a30efec8c9bac0f58269b9d0b51f3c73c23b0640fbbb1b7b0ad',
  rawFrames: '2d3a0a9fd1670c087367fbb1c9330eda9e2484d9e7facd665892c6128e5f3b91',
});
const limits = Object.freeze({
  metadataBytesMax: 64 * 1024,
  reliableMessageBytesMax: 1024 * 1024,
  baselineTransferBytesMax: 1024 * 1024,
  baselineInFlightBytesMax: 16 * 1024 * 1024,
  sendQueueBytesMax: 4 * 1024 * 1024,
});
const chunkBytes = NETWORK_REFERENCE_BASELINE_CELL_COUNT * 3;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const digest = Object.freeze({ algorithm: 'sha-256' as const, digest: async (bytes: Uint8Array) => sha256(bytes) });
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
  codecs: Readonly<Record<'C0', readonly DecodedRecord[]>>;
}>;
type Evidence = Readonly<{
  inputPins: Readonly<{
    derivedDirectory: string;
    derivedManifestSha256: string;
    derivedFramesSha256: string;
    rawManifestSha256: string;
    rawFramesSha256: string;
  }>;
  prototype: Readonly<{ directory: string; decodedArtifactSha256: string }>;
}>;
type Frame = Readonly<{
  frameId: string;
  descriptor: BaselineBundleDescriptorReference;
  pages: readonly Readonly<{ arrivalIndex: number; path: string; sha256: string }>[];
  reassembled: readonly Readonly<{ entryId: number; canonicalSha256: string; fluidSha256: string }>[];
}>;

class TransferMeshWorker implements MeshWorkerPort {
  onmessage: MeshWorkerPort['onmessage'] = null;
  onerror: MeshWorkerPort['onerror'] = null;
  readonly tasks: Array<GenerateMeshTaskPayload & { taskId: number }> = [];
  lastMainSideInput: CompleteWorkerInputLease['input'] | null = null;
  terminated = false;

  postMessage(message: Record<string, unknown>, transfers: Transferable[]) {
    if (message.kind === 'cancel-mesh') return;
    this.tasks.push(structuredClone(message, { transfer: transfers }) as GenerateMeshTaskPayload & { taskId: number });
  }

  terminate() {
    this.terminated = true;
  }

  async finish(index: number): Promise<WorkerResult> {
    const task = this.tasks[index]!;
    const result = await runWorldComputeTask(task);
    const canonical = 'canonical' in result ? result.canonical : undefined;
    if (
      result.kind !== 'mesh-result' ||
      !(canonical instanceof ArrayBuffer) ||
      !('generatorVersion' in result) ||
      result.generatorVersion === undefined
    )
      throw new Error('Complete baseline worker did not produce a canonical mesh result.');
    const message: WorkerResult = {
      kind: 'mesh-result',
      taskId: task.taskId,
      traceId: result.traceId,
      epoch: result.epoch,
      chunkKey: result.chunkKey,
      chunkRevision: result.chunkRevision,
      haloRevision: result.haloRevision,
      cx: result.cx,
      cy: result.cy,
      cz: result.cz,
      workerMeshingMs: result.workerMeshingMs,
      ...(result.workerGenerationMs === undefined ? {} : { workerGenerationMs: result.workerGenerationMs }),
      ...(result.workerHaloMs === undefined ? {} : { workerHaloMs: result.workerHaloMs }),
      ...(!('computedHaloRevision' in result) || result.computedHaloRevision === undefined
        ? {}
        : { computedHaloRevision: result.computedHaloRevision }),
      ...(!('authorityComplete' in result) || result.authorityComplete !== true ? {} : { authorityComplete: true }),
      ...(!('proceduralVoxelSamples' in result) || result.proceduralVoxelSamples === undefined
        ? {}
        : { proceduralVoxelSamples: result.proceduralVoxelSamples }),
      ...(!('macroContextCount' in result) || result.macroContextCount === undefined
        ? {}
        : { macroContextCount: result.macroContextCount }),
      generatorVersion: result.generatorVersion,
      canonical,
      meshes: result.meshes,
    };
    this.onmessage?.({ data: message } as MessageEvent<WorkerResult>);
    return message;
  }
}

function decodedPage(record: DecodedRecord): BaselinePageReference {
  expect(record.category).toBe('baseline-page');
  expect(record.binary).toHaveLength(1);
  expect(record.binary[0]?.name).toBe('bytes');
  return {
    ...(record.metadata as Omit<BaselinePageReference, 'bytes'>),
    bytes: new Uint8Array(Buffer.from(record.binary[0]!.base64, 'base64')),
  };
}

function ownerFrom(descriptor: BaselineBundleDescriptorReference): NetworkBaselineOwnerRef {
  const main = descriptor.entries[0]!;
  return {
    ref: descriptor.ref,
    ownerId: 1,
    ownerGeneration: 1,
    requestId: descriptor.requestId,
    interestId: descriptor.interestId,
    purpose: 'mesh',
    key: descriptor.key,
    generatorVersion: main.generatorVersion,
    expectedEntries: descriptor.entries.map((entry) => ({
      key: entry.key,
      minimumRevision: descriptor.minimumRevision,
    })),
  };
}

async function loadC0Frame(): Promise<Readonly<{ frame: Frame; bundle: ReassembledBaselineReference }>> {
  const [manifestBytes, framesBytes, rawManifestBytes, rawFramesBytes, evidenceText] = await Promise.all([
    readFile(`${projected}/manifest.json`),
    readFile(`${projected}/frames.jsonl`),
    readFile('/tmp/seedlands-network-baseline-corpus-v1-r2/manifest.json'),
    readFile('/tmp/seedlands-network-baseline-corpus-v1-r2/frames.jsonl'),
    readFile(evidencePath, 'utf8'),
  ]);
  expect(sha256(manifestBytes)).toBe(expectedInput.derivedManifest);
  expect(sha256(framesBytes)).toBe(expectedInput.derivedFrames);
  expect(sha256(rawManifestBytes)).toBe(expectedInput.rawManifest);
  expect(sha256(rawFramesBytes)).toBe(expectedInput.rawFrames);
  const evidence = JSON.parse(evidenceText) as Evidence;
  const artifactBytes = await readFile(`${evidence.prototype.directory}/baseline-codec-decoded-artifact.json`);
  const artifact = JSON.parse(artifactBytes.toString('utf8')) as DecodedArtifact;
  expect(evidence.inputPins).toMatchObject({
    derivedDirectory: projected,
    derivedManifestSha256: expectedInput.derivedManifest,
    derivedFramesSha256: expectedInput.derivedFrames,
    rawManifestSha256: expectedInput.rawManifest,
    rawFramesSha256: expectedInput.rawFrames,
  });
  expect(artifact.format).toBe('baseline-codec-decoded-artifact/v1');
  expect(artifact.wireStatus).toBe('not-adopted');
  expect(artifact.input).toEqual(expectedInput);
  expect(sha256(artifactBytes)).toBe(evidence.prototype.decodedArtifactSha256);
  const frames = framesBytes
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Frame);
  const frame = frames.find((value) => value.frameId === 'reference-000-unmodified-mesh');
  expect(frame).toBeDefined();
  const records = new Map(artifact.codecs.C0.map((record) => [record.label, record] as const));
  const descriptorRecord = records.get(`${frame!.frameId}:descriptor`);
  expect(descriptorRecord?.category).toBe('baseline-bundle-descriptor');
  const descriptor = descriptorRecord!.metadata as BaselineBundleDescriptorReference;
  expect(descriptor).toEqual(frame!.descriptor);
  const reassembler = createBaselineReferenceReassembler({
    ref: descriptor.ref,
    limits,
    pagesPerBundleMax: frame!.pages.length,
    digest,
    sizer,
    inFlight: createBaselineReferenceInFlightLedger(limits.baselineInFlightBytesMax),
  });
  try {
    reassembler.acceptDescriptor(descriptor);
    let bundle: ReassembledBaselineReference | null = null;
    for (const page of frame!.pages) {
      const record = records.get(`${frame!.frameId}:page:${page.arrivalIndex}`);
      expect(record).toBeDefined();
      const decoded = decodedPage(record!);
      expect(sha256(decoded.bytes)).toBe(page.sha256);
      expect(await readFile(`${projected}/${page.path}`)).toEqual(Buffer.from(decoded.bytes));
      const completed = await reassembler.acceptPage(decoded);
      if (completed) bundle = completed;
    }
    await reassembler.whenIdle();
    expect(bundle).not.toBeNull();
    expect(reassembler.diagnostics().reservedBlockBytes).toBe(0);
    for (const expected of frame!.reassembled) {
      const entry = bundle!.entries.find((value) => value.entryId === expected.entryId);
      expect(entry).toBeDefined();
      expect(sha256(entry!.canonicalLittleEndian)).toBe(expected.canonicalSha256);
      expect(sha256(entry!.fluid)).toBe(expected.fluidSha256);
    }
    return { frame: frame!, bundle: bundle! };
  } finally {
    await reassembler.close();
    await reassembler.whenIdle();
    expect(reassembler.diagnostics().reservedBlockBytes).toBe(0);
  }
}

describe('完整 Authority 基线的真实客户端接线', () => {
  it('经 C0、production reassembler、consumer 与实际 worker 保持完整输入、所有权和未知 revision 门', async () => {
    const { frame, bundle } = await loadC0Frame();
    const collisionChunks = new Map();
    const collisionGuard = new AuthorityCollisionRevisionGuard();
    const consumer = createNetworkBaselineConsumer({
      limits: {
        ownersMax: 1,
        sharedCollisionBytesMax: 4 * 1024 * 1024,
        sharedPreparationBytesMax: 4 * 1024 * 1024,
        workerTransferBytesMax: 4 * 1024 * 1024,
      },
      collisionChunks,
      collisionGuard,
    });
    const owner = consumer.registerOwner(ownerFrom(frame.descriptor));
    const worker = new TransferMeshWorker();
    const accepted = vi.fn();
    let sourceAccepts = 0;
    let lastLease: CompleteWorkerInputLease | null = null;
    const source = {
      kind: 'authority-complete' as const,
      seed: 0,
      generatorVersion: frame.descriptor.entries[0]!.generatorVersion,
      prepareCompleteWorkerInput: () => {
        const lease = consumer.snapshotForWorker(owner);
        if (!lease) throw new Error('Accepted baseline did not provide a worker snapshot.');
        lastLease = lease;
        worker.lastMainSideInput = lease.input;
        return lease;
      },
      acceptDerivedMesh: (_task: unknown, result: WorkerResult) => {
        sourceAccepts += 1;
        if (!result.canonical || result.generatorVersion === undefined) return false;
        return consumer.acceptWorkerResult(owner, {
          key: result.chunkKey,
          chunkRevision: result.chunkRevision,
          generatorVersion: result.generatorVersion,
          haloRevision: result.haloRevision,
          canonical: result.canonical,
        });
      },
    };
    const scheduler = new MeshTaskScheduler({
      worker,
      source,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'worker-first',
      onAcceptedResult: accepted,
    });
    try {
      expect(consumer.accept(owner, bundle)).toMatchObject({ status: 'accepted' });
      expect(collisionChunks).toHaveLength(27);
      const mainEntry = bundle.entries[0]!;
      const cachedMain = collisionChunks.get(frame.descriptor.key)!;
      expect(cachedMain.canonical[0]).toBe(
        new DataView(mainEntry.canonicalLittleEndian.buffer, mainEntry.canonicalLittleEndian.byteOffset).getUint16(
          0,
          true,
        ),
      );
      expect(sha256(new Uint8Array(cachedMain.canonical.buffer))).toBe(
        mainEntry.canonicalLittleEndian ? sha256(mainEntry.canonicalLittleEndian) : '',
      );
      expect(sha256(cachedMain.fluid)).toBe(sha256(mainEntry.fluid));

      scheduler.request(80, 0, 80);
      expect(worker.tasks).toHaveLength(1);
      expect(lastLease).not.toBeNull();
      const transferred = [
        lastLease!.input.canonical.buffer,
        lastLease!.input.fluid.buffer,
        ...lastLease!.input.overlays.flatMap((overlay) => [overlay.voxels.buffer, overlay.fluid.buffer]),
      ];
      expect(new Set(transferred)).toHaveLength(54);
      expect(transferred.every((buffer) => buffer.byteLength === 0)).toBe(true);
      expect(cachedMain.canonical.length).toBe(NETWORK_REFERENCE_BASELINE_CELL_COUNT);
      expect(sha256(new Uint8Array(cachedMain.canonical.buffer))).toBe(sha256(mainEntry.canonicalLittleEndian));
      expect(sha256(cachedMain.fluid)).toBe(sha256(mainEntry.fluid));

      const result = await worker.finish(0);
      await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
      expect(sourceAccepts).toBe(1);
      expect(result.authorityComplete).toBe(true);
      expect(result.proceduralVoxelSamples).toBe(0);
      expect(result.macroContextCount).toBe(0);
      expect(result.haloRevision).toMatch(/^\[/);
      expect(consumer.diagnostics()).toMatchObject({ workerTransferBytes: 0, activeWorkerSnapshots: 0 });

      const overlay = frame.descriptor.entries[1]!;
      const unknown: string[] = [];
      consumer.consumeCollisionCommits(
        [
          {
            committed: true,
            worldRevision: 1,
            structuralChange: {
              chunks: [overlay.key],
              chunkRevisions: [{ key: overlay.key, revision: overlay.chunkRevision + 1 }],
            },
            collisionDelta: [],
          },
        ],
        { onUnknownChunk: (key) => unknown.push(key) },
      );
      expect(unknown).toEqual([overlay.key]);
      expect(collisionChunks.has(overlay.key)).toBe(false);
      expect(collisionGuard.isReadable(overlay.key, overlay.chunkRevision)).toBe(false);
      expect(consumer.diagnostics().sharedPreparationBytes).toBe(0);
      expect(consumer.diagnostics().sharedCollisionBytes).toBe(26 * chunkBytes);
      expect(
        consumer.acceptWorkerResult(owner, {
          key: result.chunkKey,
          chunkRevision: result.chunkRevision,
          generatorVersion: result.generatorVersion!,
          haloRevision: result.haloRevision,
          canonical: result.canonical!,
        }),
      ).toBe(false);
    } finally {
      scheduler.dispose();
      await consumer.close();
      await consumer.whenIdle();
      expect(consumer.diagnostics()).toMatchObject({ workerTransferBytes: 0, activeWorkerSnapshots: 0, closed: true });
    }
  });
});
