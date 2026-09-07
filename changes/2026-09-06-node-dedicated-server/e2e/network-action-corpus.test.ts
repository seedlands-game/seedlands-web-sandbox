import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DedicatedComputeExecutor } from '../../../src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../../src/server/persistence/memory-game-persistence';
import { projectActionReceiptReference } from '../../../src/server/protocol/network-action-reference';
import { projectActionRequestReference } from '../../../src/server/protocol/network-action-request-reference';
import {
  projectGameplayViewReference,
  projectPlayerCorrectionReference,
} from '../../../src/server/protocol/network-reference-projection';
import type { AuthorityAction } from '../../../src/worker/authority-worker-protocol';

const outputDir = '/tmp/seedlands-network-action-corpus-v1-source-bound';
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'src/server/protocol/network-action-reference-copy.ts',
  'src/server/protocol/network-action-request-reference.ts',
  'src/server/protocol/network-action-reference.ts',
  'src/server/protocol/network-reference-integer.ts',
  'src/server/protocol/network-reference-projection.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-action-corpus.test.ts',
];
const actions: readonly AuthorityAction[] = [
  { type: 'select-hotbar', slot: 1 },
  { type: 'craft', recipeId: 'missing:recipe' },
  { type: 'attack', targetId: 'missing:target' },
  { type: 'begin-break', position: [100, 33, 100] },
  { type: 'cancel-break' },
  { type: 'place', position: [100, 33, 100] },
  { type: 'respawn' },
  { type: 'move-inventory', source: 0, target: Number.MAX_SAFE_INTEGER },
  { type: 'use-inventory', slot: Number.MAX_SAFE_INTEGER },
];

type HostActionContext = {
  source: 'dedicated-server-host';
  epoch: string;
  issuer: string;
  stream: 'player-actions';
  clientPayloadFields: [];
};
type InvocationProvenance = {
  actionType: AuthorityAction['type'];
  sequence: number;
  attempt: number;
  retryOfRequestFrameId: string | null;
  authorityContext: HostActionContext;
  observedResult: 'success' | 'business-failure';
};
type RecordedFrame = {
  frameId: string;
  category: 'action-request' | 'action-receipt' | 'gameplay-view' | 'player-correction';
  direction: 'client-to-server' | 'server-to-client';
  metadata: object;
  binary: [];
  captureProvenance: InvocationProvenance;
};

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
    format: 'seedlands-network-action-corpus/v1',
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
      'action request contains only DedicatedServerHost.performAction arguments',
      'epoch, issuer, and player-actions stream are host-owned provenance, not client payload authorization',
      'business outcomes are observed from the real Host; the recorder does not manufacture successful actions',
      'player-only deterministic fixture; no GUI, listener, transport, authentication, or performance evidence',
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

async function verifyWrittenCorpus(originalRecords: readonly RecordedFrame[]) {
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
  const roundTrippedRecords = frames.map(
    ({ contentSha256: _contentSha256, provenance: _provenance, ...record }) => record,
  );
  const expectedRecords = originalRecords.map(({ captureProvenance: _captureProvenance, ...record }) => record);
  if (!isDeepStrictEqual(roundTrippedRecords, expectedRecords))
    throw new TypeError('落盘 action records 与原始捕获不一致（包含 f64 -0 所有权语义）。');
  for (const frame of frames) {
    const { contentSha256, provenance, ...content } = frame;
    expect(contentSha256).toBe(sha256(JSON.stringify(content)));
    expect(provenance).toMatchObject({
      kind: 'real-host',
      manifestPayloadSha256,
      authorityContext: {
        source: 'dedicated-server-host',
        stream: 'player-actions',
        clientPayloadFields: [],
      },
    });
  }
  return { frames, manifest };
}

describe('真实 Host 动作请求与回执参考语料', () => {
  it('采集九种动作与同 key 同 payload 重试，并绑定真实 gameplay 和 snapshot 锚点', async () => {
    const now = 0;
    const compute = executor();
    const config = {
      epoch: 'host:action-reference',
      seedText: 'network-action-fixture',
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
      category: RecordedFrame['category'],
      direction: RecordedFrame['direction'],
      metadata: object,
      captureProvenance: InvocationProvenance,
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
    try {
      await host.waitForIdle();
      host.runtime.commitHostActivation();
      const authorityContext: HostActionContext = {
        source: 'dedicated-server-host',
        epoch: host.runtime.snapshot().epoch,
        issuer: host.runtime.playerId,
        stream: 'player-actions',
        clientPayloadFields: [],
      };
      const invoke = async (
        action: AuthorityAction,
        sequence: number,
        attempt: number,
        retryOfRequestFrameId: string | null,
      ) => {
        const requestFrameId = `${String(records.length).padStart(3, '0')}-action-request`;
        const request = projectActionRequestReference(action, sequence);
        const receipt = await host.performAction(action, sequence);
        const projectedReceipt = projectActionReceiptReference(action, receipt, {
          epoch: authorityContext.epoch,
          issuer: authorityContext.issuer,
          stream: authorityContext.stream,
          sequence,
        });
        if (projectedReceipt.status !== 'executed')
          throw new Error(`真实动作 ${action.type} 未进入 executed receipt：${projectedReceipt.status}`);
        const observedResult = projectedReceipt.outcome.success ? 'success' : 'business-failure';
        const captureProvenance: InvocationProvenance = {
          actionType: action.type,
          sequence,
          attempt,
          retryOfRequestFrameId,
          authorityContext,
          observedResult,
        };
        record('action-request', 'client-to-server', request, captureProvenance);
        record('action-receipt', 'server-to-client', projectedReceipt, captureProvenance);
        const snapshot = host.runtime.snapshot();
        record(
          'gameplay-view',
          'server-to-client',
          projectGameplayViewReference(host.runtime.view(), {
            epoch: snapshot.epoch,
            snapshotPhysicsTick: snapshot.physicsTick,
            snapshotCommitSequence: snapshot.commitSequence,
            snapshotWorldRevision: snapshot.worldRevision,
          }),
          captureProvenance,
        );
        record('player-correction', 'server-to-client', projectPlayerCorrectionReference(snapshot), captureProvenance);
        return { requestFrameId, projectedReceipt };
      };

      const first = await invoke(actions[0]!, 0, 1, null);
      const firstGameplayRevision = host.runtime.view().gameplayRevision;
      const repeated = await invoke(actions[0]!, 0, 2, first.requestFrameId);
      expect(repeated.projectedReceipt).toEqual(first.projectedReceipt);
      expect(host.runtime.view().gameplayRevision).toBe(firstGameplayRevision);
      for (let index = 1; index < actions.length; index += 1) await invoke(actions[index]!, index, 1, null);

      expect(records).toHaveLength(40);
      expect(
        new Set(
          records
            .filter(({ category }) => category === 'action-request')
            .map(({ captureProvenance }) => captureProvenance.actionType),
        ),
      ).toEqual(new Set(actions.map(({ type }) => type)));
      const observedOutcomes = records
        .filter(({ category, captureProvenance }) => category === 'action-receipt' && captureProvenance.attempt === 1)
        .map(({ captureProvenance }) => [captureProvenance.actionType, captureProvenance.observedResult]);
      expect(observedOutcomes).toEqual([
        ['select-hotbar', 'success'],
        ['craft', 'business-failure'],
        ['attack', 'business-failure'],
        ['begin-break', 'business-failure'],
        ['cancel-break', 'success'],
        ['place', 'business-failure'],
        ['respawn', 'business-failure'],
        ['move-inventory', 'business-failure'],
        ['use-inventory', 'business-failure'],
      ]);

      const firstWrite = await writeCorpus(records, config);
      const secondWrite = await writeCorpus(records, config);
      expect(secondWrite).toEqual(firstWrite);
      const verified = await verifyWrittenCorpus(records);
      expect(verified.manifest.recordCount).toBe(40);
      const retry = verified.frames.filter((frame) => (frame.provenance as { attempt?: number }).attempt === 2);
      expect(retry).toHaveLength(4);
    } finally {
      await host.stop();
    }
  });
});
