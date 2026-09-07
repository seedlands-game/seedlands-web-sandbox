import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_COMMAND_CAPABILITIES } from '../../../src/server/commands/command-contract';
import type { DedicatedComputeExecutor } from '../../../src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../../src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../../src/server/dedicated/dedicated-server-host';
import { MemoryGamePersistence } from '../../../src/server/persistence/memory-game-persistence';
import {
  projectGameplayConsumerReference,
  type GameplayConsumerReference,
} from '../../../src/server/protocol/network-gameplay-consumer-reference';
import { projectEntityPoseReference } from '../../../src/server/protocol/network-reference-pose';
import { projectPlayerCorrectionReference } from '../../../src/server/protocol/network-reference-projection';
import {
  gameplayConsumerCorpusOutputDir,
  readGameplayConsumerCorpus,
  writeGameplayConsumerCorpus,
  type GameplayConsumerCorpusRecord,
} from './support/network-gameplay-consumer-corpus-recorder';

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'src/server/protocol/network-gameplay-consumer-reference.ts',
  'src/server/protocol/network-reference-pose.ts',
  'src/server/protocol/network-reference-projection.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-gameplay-consumer-corpus-recorder.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-gameplay-consumer-corpus.test.ts',
] as const;
const historicalCorpusPaths = [
  '/tmp/seedlands-network-real-corpus-v1/manifest.json',
  '/tmp/seedlands-network-real-corpus-v1/frames.jsonl',
  '/tmp/seedlands-network-directional-corpus-v1/manifest.json',
  '/tmp/seedlands-network-directional-corpus-v1/frames.jsonl',
  '/tmp/seedlands-network-entity-corpus-v1/manifest.json',
  '/tmp/seedlands-network-entity-corpus-v1/frames.jsonl',
] as const;
const fixtureAdmin = {
  actorId: 'network-gameplay-consumer-corpus-fixture',
  sourceType: 'local-developer' as const,
  entityId: 'player',
  capabilities: ALL_COMMAND_CAPABILITIES,
};
const fixtureCommandTypes = ['spawn-world-item', 'spawn-creature', 'spawn-actor'] as const;

type Stage = 'starter-ecology' | 'fixture-admin-expanded' | 'restored';

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

async function existingHashes(paths: readonly string[]) {
  const entries = await Promise.all(
    paths.map(async (path) => {
      try {
        return [path, sha256(await readFile(path))] as const;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

function expectActorAssociations(value: GameplayConsumerReference, host: DedicatedServerHost) {
  const gameplay = host.runtime.view();
  const expected = [...gameplay.actors]
    .map(({ entityId, behavior }) => ({ entityId, behavior }))
    .sort((left, right) => (left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0));
  expect(value.actorBehaviors).toEqual(expected);
  const entities = new Map(value.entities.map((entity) => [entity.id, entity] as const));
  for (const actor of gameplay.actors) {
    const entity = entities.get(actor.entityId);
    expect(entity?.type === 'creature' || entity?.type === 'npc').toBe(true);
    expect(entity?.archetype).toBe(actor.archetype);
  }
}

function createRecorder(host: DedicatedServerHost, records: GameplayConsumerCorpusRecord[]) {
  let stage: Stage | null = null;
  let publicationSequence = 0;
  let publicationCount = 0;
  const unsubscribe = host.subscribe(({ snapshot, gameplay }) => {
    if (!stage) return;
    if (!gameplay) throw new Error('Expected gameplay publication.');
    const provenance = {
      stage,
      publisher: 'dedicated-host-subscribe' as const,
      sequenceScope: 'per-recorder-subscription' as const,
      ...(stage === 'fixture-admin-expanded'
        ? {
            fixtureAdmin: {
              sourceType: fixtureAdmin.sourceType,
              actorId: fixtureAdmin.actorId,
              commandTypes: fixtureCommandTypes,
            },
          }
        : {}),
    };
    const add = (category: GameplayConsumerCorpusRecord['category'], metadata: object) =>
      records.push({
        frameId: `${String(records.length).padStart(3, '0')}-${category}`,
        category,
        direction: 'server-to-client',
        metadata: structuredClone(metadata),
        binary: [],
        captureProvenance: provenance,
      });
    add('player-correction', projectPlayerCorrectionReference(snapshot));
    add('entity-pose', projectEntityPoseReference(snapshot, { publicationSequence: publicationSequence++ }));
    const consumer = projectGameplayConsumerReference(gameplay, {
      epoch: snapshot.epoch,
      snapshotPhysicsTick: snapshot.physicsTick,
      snapshotCommitSequence: snapshot.commitSequence,
      snapshotWorldRevision: snapshot.worldRevision,
    });
    expectActorAssociations(consumer, host);
    add('gameplay-consumer', consumer);
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

describe('真实 Host Gameplay 消费者 v2 参考语料', () => {
  it('在生态、受控扩容和保存恢复三阶段记录 consumer、pose 与 correction', async () => {
    const priorHashes = await existingHashes(historicalCorpusPaths);
    let now = 0;
    const persistence = new MemoryGamePersistence();
    const seedText = 'network-gameplay-consumer-corpus-fixture';
    const records: GameplayConsumerCorpusRecord[] = [];
    const first = await DedicatedServerHost.create({
      epoch: 'host:gameplay-consumer:initial',
      seedText,
      persistence,
      executors: { general: executor(), fluid: executor(), logic: executor() },
      now: () => now,
    });
    const firstRecorder = createRecorder(first, records);
    let firstStopped = false;
    let second: DedicatedServerHost | undefined;
    let secondRecorder: ReturnType<typeof createRecorder> | undefined;
    try {
      const initial = firstRecorder.capture('starter-ecology', (now += 50));
      expect(initial.entities).toHaveLength(5);
      expect(records.at(-1)?.category).toBe('gameplay-consumer');
      expect((records.at(-1)?.metadata as GameplayConsumerReference).actorBehaviors).toHaveLength(3);

      const commands = [
        { type: 'spawn-world-item' as const, itemId: 'berry', count: 2, position: [3, 34, 0] as const },
        { type: 'spawn-creature' as const, position: [5, 34, 0] as const },
        { type: 'spawn-actor' as const, archetype: 'settler' as const, position: [7, 34, 0] as const },
      ];
      expect(commands.map((command) => command.type)).toEqual(fixtureCommandTypes);
      for (const command of commands)
        await expect(first.runtime.executeCommand(fixtureAdmin, command)).resolves.toMatchObject({ success: true });
      const expanded = firstRecorder.capture('fixture-admin-expanded', (now += 50));
      expect(expanded.entities).toHaveLength(8);
      expect((records.at(-1)?.metadata as GameplayConsumerReference).actorBehaviors).toHaveLength(4);

      await first.save();
      firstRecorder.close();
      await first.stop();
      firstStopped = true;

      second = await DedicatedServerHost.create({
        epoch: 'host:gameplay-consumer:restored',
        seedText,
        persistence,
        executors: { general: executor(), fluid: executor(), logic: executor() },
        now: () => now,
      });
      secondRecorder = createRecorder(second, records);
      const restored = secondRecorder.capture('restored', (now += 50));
      expect(restored.entities).toHaveLength(8);
      expect(restored.epoch).not.toBe(expanded.epoch);
      expect((records.at(-1)?.metadata as GameplayConsumerReference).actorBehaviors).toHaveLength(4);

      expect(records).toHaveLength(9);
      expect(records.map((record) => record.category)).toEqual([
        'player-correction',
        'entity-pose',
        'gameplay-consumer',
        'player-correction',
        'entity-pose',
        'gameplay-consumer',
        'player-correction',
        'entity-pose',
        'gameplay-consumer',
      ]);
      const written = await writeGameplayConsumerCorpus({
        records,
        sourcePaths,
        config: { seedText, stages: ['starter-ecology', 'fixture-admin-expanded', 'restored'] },
      });
      const disk = await readGameplayConsumerCorpus();
      deepStrictEqual(disk.frames, written.frames);
      deepStrictEqual(disk.manifest, written.manifest);
      expect(written.manifest.recordCount).toBe(9);
      const lines = await readFile(`${gameplayConsumerCorpusOutputDir}/frames.jsonl`, 'utf8');
      const { manifestPayloadSha256, corpusSha256, recordCount, ...manifestPayload } = disk.manifest;
      expect(manifestPayloadSha256).toBe(sha256(JSON.stringify(manifestPayload)));
      expect(corpusSha256).toBe(sha256(lines));
      expect(recordCount).toBe(disk.frames.length);
      expect(manifestPayload.records).toEqual(
        disk.frames.map(({ frameId, category, direction, contentSha256 }) => ({
          frameId,
          category,
          direction,
          contentSha256,
        })),
      );
      for (const frame of disk.frames) {
        const { contentSha256, provenance, ...record } = frame;
        const { kind, manifestPayloadSha256: frameManifestHash, ...captureProvenance } = provenance;
        expect(kind).toBe('real-host');
        expect(frameManifestHash).toBe(manifestPayloadSha256);
        expect(contentSha256).toBe(sha256(JSON.stringify({ ...record, captureProvenance })));
      }
      expect(written.manifest.source.explicitInputSha256).toEqual(
        Object.fromEntries(sourcePaths.map((path) => [path, expect.stringMatching(/^[a-f0-9]{64}$/)])),
      );
      expect(await existingHashes(historicalCorpusPaths)).toEqual(priorHashes);
      expect(gameplayConsumerCorpusOutputDir).toBe('/tmp/seedlands-network-gameplay-consumer-corpus-v2');
    } finally {
      firstRecorder.close();
      if (!firstStopped) await first.stop();
      secondRecorder?.close();
      if (second) await second.stop();
    }
  });
});
