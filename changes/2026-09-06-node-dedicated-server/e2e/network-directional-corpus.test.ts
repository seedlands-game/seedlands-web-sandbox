import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { DedicatedComputeExecutor } from '../../../packages/game-core/src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../packages/game-core/src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../packages/game-core/src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../../packages/game-core/src/server/persistence/memory-game-persistence';
import {
  projectPlayerInputReference,
  projectInputDecisionReference,
} from '../../../packages/game-core/src/server/protocol/network-reference-input';
import { projectEntityPoseReference } from '../../../packages/game-core/src/server/protocol/network-reference-pose';
import { projectPlayerCorrectionReference } from '../../../packages/game-core/src/server/protocol/network-reference-projection';
import type { InputCommand } from '../../../packages/game-core/src/runtime/session-protocol';

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const outputDir = '/tmp/seedlands-network-directional-corpus-v1';
const sourcePaths = [
  'src/server/protocol/network-reference-input-types.ts',
  'src/server/protocol/network-reference-input.ts',
  'src/server/protocol/network-reference-pose.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-directional-corpus.test.ts',
];
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
type RecordedFrame = {
  frameId: string;
  category: string;
  direction: 'client-to-server' | 'server-to-client';
  metadata: object;
  binary: [];
  captureProvenance?: {
    publisher: 'dedicated-host-subscribe';
    sequenceScope: 'per-recorder-subscription';
  };
};

async function writeCorpus(records: readonly RecordedFrame[], config: object) {
  const source = {
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedSourceDiffSha256: sha256(
      execFileSync('git', ['diff', 'HEAD', '--', 'src', 'tests', 'changes/2026-09-06-node-dedicated-server']),
    ),
    explicitInputSha256: Object.fromEntries(
      await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(path))] as const)),
    ),
  };
  const indexed = records.map(({ captureProvenance, ...record }) => ({
    ...record,
    captureProvenance,
    contentSha256: sha256(JSON.stringify(record)),
  }));
  const payload = {
    format: 'seedlands-network-directional-corpus/v1',
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    source,
    config,
    records: indexed.map(({ frameId, category, direction, contentSha256 }) => ({
      frameId,
      category,
      direction,
      contentSha256,
    })),
    limitations: [
      'reference projections; wire not adopted',
      'publicationSequence is a dedicated-host-subscribe callback index scoped per recorder subscription, not a snapshot or transport field',
      'pose reflects actual player-only snapshot bodies; no fabricated entity count, non-player entity, or density coverage',
      'duplicate input records prove decision and acknowledged-sequence behavior only, not duplicate-edge motion behavior',
      'actions and transport not included',
    ],
  };
  const manifestPayloadSha256 = sha256(JSON.stringify(payload));
  const lines =
    indexed
      .map(({ captureProvenance, ...record }) =>
        JSON.stringify({
          ...record,
          provenance: { kind: 'real-host', manifestPayloadSha256, ...captureProvenance },
        }),
      )
      .join('\n') + '\n';
  const manifest = { ...payload, manifestPayloadSha256, corpusSha256: sha256(lines), recordCount: indexed.length };
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/frames.jsonl`, lines);
  await writeFile(`${outputDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  return { lines, manifest };
}

async function verifyWrittenCorpus() {
  const lines = await readFile(`${outputDir}/frames.jsonl`, 'utf8');
  const frames = lines
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const manifest = JSON.parse(await readFile(`${outputDir}/manifest.json`, 'utf8')) as Record<string, unknown>;
  const { manifestPayloadSha256, corpusSha256, recordCount, ...payload } = manifest;

  expect(manifestPayloadSha256).toBe(sha256(JSON.stringify(payload)));
  expect(corpusSha256).toBe(sha256(lines));
  expect(recordCount).toBe(frames.length);
  expect(payload.records).toEqual(
    frames.map(({ frameId, category, direction, contentSha256 }) => ({ frameId, category, direction, contentSha256 })),
  );

  for (const frame of frames) {
    const { contentSha256, provenance, ...record } = frame;
    expect(contentSha256).toBe(sha256(JSON.stringify(record)));
    expect(provenance).toMatchObject({ kind: 'real-host', manifestPayloadSha256 });
    if (frame.category === 'entity-pose') {
      expect(provenance).toMatchObject({
        publisher: 'dedicated-host-subscribe',
        sequenceScope: 'per-recorder-subscription',
      });
    }
  }
}

describe('真实 Host 双向参考语料', () => {
  it('区分入队决定与后续 ack，并在实际 publication 单列 pose', async () => {
    let now = 0;
    const compute = executor();
    const config = {
      epoch: 'host:directional-reference',
      seedText: 'network-directional-fixture',
      initialPlayerBodyPosition: [0.5, 33, 0.5] as [number, number, number],
    };
    const host = await DedicatedServerHost.create({
      ...config,
      now: () => now,
      persistence: new MemoryGamePersistence(),
      executors: { general: compute, fluid: compute, logic: compute },
    });
    const records: RecordedFrame[] = [];
    const record = (
      category: string,
      metadata: object,
      direction: RecordedFrame['direction'] = 'server-to-client',
      captureProvenance?: RecordedFrame['captureProvenance'],
    ) => {
      records.push({
        frameId: `${String(records.length).padStart(3, '0')}-${category}`,
        category,
        direction,
        metadata: structuredClone(metadata),
        binary: [],
        captureProvenance,
      });
    };
    let publicationSequence = 0;
    const unsubscribe = host.subscribe(({ snapshot }) => {
      record('player-correction', projectPlayerCorrectionReference(snapshot));
      record(
        'entity-pose',
        projectEntityPoseReference(snapshot, { publicationSequence: publicationSequence++ }),
        'server-to-client',
        { publisher: 'dedicated-host-subscribe', sequenceScope: 'per-recorder-subscription' },
      );
    });
    try {
      await host.waitForIdle();
      host.runtime.commitHostActivation();
      expect(host.runtime.snapshot().acknowledgedInputSequence).toBe(-1);
      const inputStates = [
        { moveX: 0, jumpHeld: false, jumpPressed: false },
        { moveX: 1, jumpHeld: false, jumpPressed: false },
        { moveX: 1, jumpHeld: false, jumpPressed: true },
        { moveX: 0, jumpHeld: true, jumpPressed: false },
        { moveX: 0, jumpHeld: false, jumpPressed: false },
      ];
      for (const [sequence, state] of inputStates.entries()) {
        const before = host.runtime.snapshot();
        const input: InputCommand = {
          kind: 'input',
          protocolVersion: 1,
          epoch: before.epoch,
          stream: 'player-input',
          sequence,
          targetPhysicsTick: before.physicsTick + 1,
          issuedAtMs: now,
          state: { moveX: state.moveX, moveZ: 0, verticalIntent: 0, jumpHeld: state.jumpHeld },
          edges: { jumpPressed: state.jumpPressed },
        };
        record('player-input', projectPlayerInputReference(input), 'client-to-server');
        const decision = host.receiveInput(input);
        expect(decision).toBe('accepted');
        const observed = host.runtime.snapshot();
        expect(observed.acknowledgedInputSequence).toBe(sequence - 1);
        record('input-decision', projectInputDecisionReference(input, decision, observed));
        if (sequence === 2) {
          const duplicate = host.receiveInput(input);
          expect(duplicate).toBe('duplicate');
          record('input-decision', projectInputDecisionReference(input, duplicate, host.runtime.snapshot()));
        }
        now += 50;
        const after = host.wake(now);
        expect(after.acknowledgedInputSequence).toBe(sequence);
        expect(after.physicsTick).toBeGreaterThanOrEqual(input.targetPhysicsTick);
      }
      expect(publicationSequence).toBe(5);
      expect(records.filter((record) => record.category === 'player-input')).toHaveLength(5);
      expect(records.filter((record) => record.category === 'input-decision')).toHaveLength(6);
      expect(records.filter((record) => record.category === 'entity-pose')).toHaveLength(5);
      expect(records.filter((record) => record.category === 'player-correction')).toHaveLength(5);
      const first = await writeCorpus(records, config);
      const second = await writeCorpus(records, config);
      expect(second).toEqual(first);
      expect(first.manifest.recordCount).toBe(21);
      expect(first.manifest.corpusSha256).toBe(sha256(await readFile(`${outputDir}/frames.jsonl`)));
      await verifyWrittenCorpus();
    } finally {
      unsubscribe();
      await host.stop();
    }
  });
});
