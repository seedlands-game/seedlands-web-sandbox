import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_COMMAND_CAPABILITIES } from '../../../src/server/commands/command-contract';
import type { DedicatedComputeExecutor } from '../../../src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../../src/server/persistence/memory-game-persistence';
import { projectEntityPoseReference } from '../../../src/server/protocol/network-reference-pose';
import { projectGameplayViewReference } from '../../../src/server/protocol/network-reference-projection';

const outputDir = '/tmp/seedlands-network-entity-corpus-v1';
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'src/server/protocol/network-reference-pose.ts',
  'src/server/protocol/network-reference-projection.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-entity-corpus.test.ts',
];
const fixtureAdmin = {
  actorId: 'network-entity-corpus-fixture',
  sourceType: 'local-developer' as const,
  entityId: 'player',
  capabilities: ALL_COMMAND_CAPABILITIES,
};
const fixtureCommandTypes = ['spawn-world-item', 'spawn-creature', 'spawn-actor'] as const;

type Stage = 'starter-ecology' | 'fixture-admin-expanded' | 'restored';
type RecordedFrame = {
  frameId: string;
  category: 'entity-pose' | 'gameplay-view';
  direction: 'server-to-client';
  metadata: object;
  binary: [];
  captureProvenance: {
    stage: Stage;
    publisher: 'dedicated-host-subscribe';
    sequenceScope: 'per-recorder-subscription';
    fixtureAdmin?: {
      sourceType: 'local-developer';
      actorId: string;
      commandTypes: typeof fixtureCommandTypes;
    };
  };
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

const entityTypes = (entities: readonly { type: string }[]) => entities.map((entity) => entity.type).sort();

function expectStarterEcology(entities: readonly { type: string; archetype?: string }[]) {
  expect(entities).toHaveLength(5);
  expect(entityTypes(entities)).toEqual(['creature', 'creature', 'npc', 'player', 'world-item']);
  expect(
    entities
      .map((entity) => entity.archetype)
      .filter(Boolean)
      .sort(),
  ).toEqual(['grazer', 'night-stalker', 'settler']);
}

function createRecorder(host: DedicatedServerHost, records: RecordedFrame[]) {
  let publicationSequence = 0;
  let stage: Stage | null = null;
  let publicationCount = 0;
  const unsubscribe = host.subscribe(({ snapshot, gameplay }) => {
    if (!stage) return;
    if (!gameplay) throw new Error('Expected gameplay in the entity corpus publication.');
    const captureProvenance = {
      stage,
      publisher: 'dedicated-host-subscribe' as const,
      sequenceScope: 'per-recorder-subscription' as const,
      ...(stage === 'fixture-admin-expanded'
        ? {
            fixtureAdmin: {
              sourceType: 'local-developer' as const,
              actorId: fixtureAdmin.actorId,
              commandTypes: fixtureCommandTypes,
            },
          }
        : {}),
    };
    const frame = (category: RecordedFrame['category'], metadata: object) =>
      records.push({
        frameId: `${String(records.length).padStart(3, '0')}-${category}`,
        category,
        direction: 'server-to-client',
        metadata: structuredClone(metadata),
        binary: [],
        captureProvenance,
      });
    frame('entity-pose', projectEntityPoseReference(snapshot, { publicationSequence: publicationSequence++ }));
    frame(
      'gameplay-view',
      projectGameplayViewReference(gameplay, {
        epoch: snapshot.epoch,
        snapshotPhysicsTick: snapshot.physicsTick,
        snapshotCommitSequence: snapshot.commitSequence,
        snapshotWorldRevision: snapshot.worldRevision,
      }),
    );
    publicationCount += 1;
  });
  return {
    capture: (nextStage: Stage, now: number) => {
      stage = nextStage;
      const before = publicationCount;
      const snapshot = host.wake(now);
      expect(publicationCount).toBe(before + 1);
      stage = null;
      return snapshot;
    },
    close: unsubscribe,
  };
}

async function writeCorpus(records: readonly RecordedFrame[], config: object) {
  const source = {
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedSourceDiffSha256: sha256(
      execFileSync('git', ['diff', 'HEAD', '--', 'src', 'tests', 'changes/2026-09-06-node-dedicated-server']),
    ),
    explicitInputSha256: Object.fromEntries(
      await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(path))] as const)),
    ),
    fixtureAdmin: {
      sourceType: fixtureAdmin.sourceType,
      actorId: fixtureAdmin.actorId,
      commandTypes: fixtureCommandTypes,
    },
  };
  const indexed = records.map(({ captureProvenance, ...record }) => ({
    ...record,
    captureProvenance,
    contentSha256: sha256(JSON.stringify(record)),
  }));
  const payload = {
    format: 'seedlands-network-entity-corpus/v1',
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
      'each publicationSequence is a dedicated-host-subscribe callback index scoped per recorder subscription',
      'fixture-admin-expanded uses a local-developer command source, not a player network action',
      'three small entity counts are correctness evidence, not a density or performance curve',
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
  return manifest;
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
  expect(recordCount).toBe(6);
  expect(payload.records).toEqual(
    frames.map(({ frameId, category, direction, contentSha256 }) => ({ frameId, category, direction, contentSha256 })),
  );
  for (const frame of frames) {
    const { contentSha256, provenance, ...record } = frame;
    expect(contentSha256).toBe(sha256(JSON.stringify(record)));
    expect(provenance).toMatchObject({
      kind: 'real-host',
      manifestPayloadSha256,
      publisher: 'dedicated-host-subscribe',
      sequenceScope: 'per-recorder-subscription',
    });
  }
  expect(
    frames.filter((frame) => (frame.provenance as { stage: Stage }).stage === 'fixture-admin-expanded'),
  ).toHaveLength(2);
  expect(frames.filter((frame) => (frame.provenance as { stage: Stage }).stage === 'restored')).toHaveLength(2);
}

describe('真实 Host 实体规模参考语料', () => {
  it('记录生态、受控命令扩容和保存恢复后的 pose 与 Gameplay', async () => {
    let now = 0;
    const persistence = new MemoryGamePersistence();
    const seedText = 'network-entity-corpus-fixture';
    const first = await DedicatedServerHost.create({
      epoch: 'host:entity-corpus:initial',
      seedText,
      persistence,
      executors: { general: executor(), fluid: executor(), logic: executor() },
      now: () => now,
    });
    const records: RecordedFrame[] = [];
    const firstRecorder = createRecorder(first, records);
    let firstStopped = false;
    let second: DedicatedServerHost | undefined;
    let secondRecorder: ReturnType<typeof createRecorder> | undefined;
    try {
      const initial = firstRecorder.capture('starter-ecology', (now += 50));
      expectStarterEcology(initial.entities);

      const fixtureCommands = [
        { type: 'spawn-world-item' as const, itemId: 'berry', count: 2, position: [3, 34, 0] as const },
        { type: 'spawn-creature' as const, position: [5, 34, 0] as const },
        { type: 'spawn-actor' as const, archetype: 'settler' as const, position: [7, 34, 0] as const },
      ];
      expect(fixtureCommands.map((command) => command.type)).toEqual(fixtureCommandTypes);
      for (const command of fixtureCommands)
        await expect(first.runtime.executeCommand(fixtureAdmin, command)).resolves.toMatchObject({ success: true });
      const expanded = firstRecorder.capture('fixture-admin-expanded', (now += 50));
      expect(expanded.entities).toHaveLength(initial.entities.length + 3);
      expect(expanded.entities.map((entity) => entity.id)).toEqual(
        expect.arrayContaining(initial.entities.map((entity) => entity.id)),
      );

      await first.save();
      firstRecorder.close();
      await first.stop();
      firstStopped = true;

      second = await DedicatedServerHost.create({
        epoch: 'host:entity-corpus:restored',
        seedText,
        persistence,
        executors: { general: executor(), fluid: executor(), logic: executor() },
        now: () => now,
      });
      secondRecorder = createRecorder(second, records);
      const restored = secondRecorder.capture('restored', (now += 50));
      expect(restored.epoch).not.toBe(expanded.epoch);
      expect(restored.entities.map((entity) => entity.id).sort()).toEqual(
        expanded.entities.map((entity) => entity.id).sort(),
      );
      expect(restored.entities).toHaveLength(expanded.entities.length);

      const manifest = await writeCorpus(records, {
        seedText,
        stages: ['starter-ecology', 'fixture-admin-expanded', 'restored'],
      });
      expect(manifest.recordCount).toBe(6);
      await verifyWrittenCorpus();
    } finally {
      firstRecorder.close();
      if (!firstStopped) await first.stop();
      secondRecorder?.close();
      if (second) await second.stop();
    }
  });
});
