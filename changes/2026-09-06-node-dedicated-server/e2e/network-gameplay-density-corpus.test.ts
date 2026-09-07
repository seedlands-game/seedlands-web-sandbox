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
import {
  projectEntityPoseReference,
  type EntityPosePublicationReference,
} from '../../../src/server/protocol/network-reference-pose';
import { projectPlayerCorrectionReference } from '../../../src/server/protocol/network-reference-projection';
import {
  densityCorpusOutputDirectory,
  readDensityCorpus,
  writeDensityCorpus,
  type DensityCorpusRecord,
} from './support/network-gameplay-density-corpus-recorder';

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'src/server/protocol/network-gameplay-consumer-reference.ts',
  'src/server/protocol/network-reference-pose.ts',
  'src/server/protocol/network-reference-projection.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/support/network-gameplay-density-corpus-recorder.ts',
  'changes/2026-09-06-node-dedicated-server/e2e/network-gameplay-density-corpus.test.ts',
] as const;
const historicalCorpusPaths = [
  '/tmp/seedlands-network-real-corpus-v1/manifest.json',
  '/tmp/seedlands-network-real-corpus-v1/frames.jsonl',
  '/tmp/seedlands-network-directional-corpus-v1/manifest.json',
  '/tmp/seedlands-network-directional-corpus-v1/frames.jsonl',
  '/tmp/seedlands-network-entity-corpus-v1/manifest.json',
  '/tmp/seedlands-network-entity-corpus-v1/frames.jsonl',
  '/tmp/seedlands-network-gameplay-consumer-corpus-v2/manifest.json',
  '/tmp/seedlands-network-gameplay-consumer-corpus-v2/frames.jsonl',
] as const;
const fixtureAdmin = {
  actorId: 'network-gameplay-density-corpus-fixture',
  sourceType: 'local-developer' as const,
  entityId: 'player',
  capabilities: ALL_COMMAND_CAPABILITIES,
};
const actorTargets = [32, 128] as const;

type ActorTarget = (typeof actorTargets)[number];

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

function spawnPositions(host: DedicatedServerHost, count: number): readonly (readonly [number, number, number])[] {
  const player = host.snapshot.player.body.position;
  const originX = Math.floor(player.x) + 12;
  const originY = Math.floor(player.y);
  const originZ = Math.floor(player.z) - 12;
  return Array.from(
    { length: count },
    (_, index) => [originX + (index % 16) * 3, originY, originZ + Math.floor(index / 16) * 3] as const,
  );
}

function expectCurrentCounts(
  host: DedicatedServerHost,
  pose: EntityPosePublicationReference,
  gameplay: GameplayConsumerReference,
  actorTarget: ActorTarget,
) {
  const view = host.runtime.view();
  expect(view.actors).toHaveLength(actorTarget);
  expect(gameplay.actorBehaviors).toHaveLength(actorTarget);
  expect(pose.entities).toHaveLength(view.entities.length);
  expect(pose.entities).toHaveLength(gameplay.entities.length + 1);
  expect(gameplay.entities).not.toContainEqual(expect.objectContaining({ id: host.snapshot.player.id }));
  expect(pose.entities).toContainEqual(expect.objectContaining({ id: host.snapshot.player.id }));
  expect(pose.entities.length).toBeLessThanOrEqual(256);
}

async function captureTarget(actorTarget: ActorTarget): Promise<void> {
  const priorHashes = await existingHashes(historicalCorpusPaths);
  let now = 0;
  const host = await DedicatedServerHost.create({
    epoch: `host:gameplay-density:${actorTarget}`,
    seedText: `network-gameplay-density-actors-${actorTarget}`,
    persistence: new MemoryGamePersistence(),
    executors: { general: executor(), fluid: executor(), logic: executor() },
    now: () => now,
  });
  const records: DensityCorpusRecord[] = [];
  let publicationCount = 0;
  const unsubscribe = host.subscribe(({ snapshot, gameplay }) => {
    if (!gameplay) throw new Error('Expected gameplay publication after density advancement.');
    const pose = projectEntityPoseReference(snapshot, { publicationSequence: publicationCount });
    const consumer = projectGameplayConsumerReference(gameplay, {
      epoch: snapshot.epoch,
      snapshotPhysicsTick: snapshot.physicsTick,
      snapshotCommitSequence: snapshot.commitSequence,
      snapshotWorldRevision: snapshot.worldRevision,
    });
    expectCurrentCounts(host, pose, consumer, actorTarget);
    const actual = {
      registeredActorCount: gameplay.actors.length,
      totalEntityCount: pose.entities.length,
      poseEntityCount: pose.entities.length,
      gameplayEntityCount: consumer.entities.length,
      gameplayRevision: consumer.gameplayRevision,
      physicsTick: snapshot.physicsTick,
      worldRevision: snapshot.worldRevision,
    };
    const add = (category: DensityCorpusRecord['category'], metadata: object) =>
      records.push({
        frameId: `${String(records.length).padStart(3, '0')}-${category}`,
        category,
        direction: 'server-to-client',
        metadata: structuredClone(metadata),
        binary: [],
        captureProvenance: {
          stage: `actors-${actorTarget}`,
          publisher: 'dedicated-host-subscribe',
          sequenceScope: 'per-recorder-subscription',
          fixtureAdmin: {
            sourceType: fixtureAdmin.sourceType,
            actorId: fixtureAdmin.actorId,
            commandType: 'spawn-actor',
            targetRegisteredActorCount: actorTarget,
          },
          actual,
        },
      });
    add('player-correction', projectPlayerCorrectionReference(snapshot));
    add('entity-pose', pose);
    add('gameplay-consumer', consumer);
    publicationCount += 1;
  });
  try {
    const initialActorCount = host.runtime.view().actors.length;
    expect(initialActorCount).toBeLessThan(actorTarget);
    const positions = spawnPositions(host, actorTarget - initialActorCount);
    expect(new Set(positions.map((position) => position.join(','))).size).toBe(positions.length);
    for (const [index, position] of positions.entries()) {
      const archetype = (['grazer', 'night-stalker', 'settler'] as const)[index % 3];
      await expect(
        host.runtime.executeCommand(fixtureAdmin, {
          type: 'spawn-actor',
          id: `density-${actorTarget}-${index}`,
          archetype,
          position,
        }),
      ).resolves.toMatchObject({ success: true });
    }
    const before = host.snapshot;
    now += 50;
    const advanced = host.wake(now);
    expect(publicationCount).toBe(1);
    expect(advanced.physicsTick).toBeGreaterThan(before.physicsTick);
    expect(records).toHaveLength(3);
    const written = await writeDensityCorpus({
      actorTarget,
      records,
      sourcePaths,
      config: {
        seedText: `network-gameplay-density-actors-${actorTarget}`,
        positionLayout: 'player-relative-16-column-grid-step-3',
        advancement: 'one-host-wake-after-final-spawn',
      },
    });
    const disk = await readDensityCorpus(actorTarget);
    deepStrictEqual(disk.frames, written.frames);
    deepStrictEqual(disk.manifest, written.manifest);
    const lines = await readFile(`${densityCorpusOutputDirectory(actorTarget)}/frames.jsonl`, 'utf8');
    const { manifestPayloadSha256, corpusSha256, recordCount, ...payload } = disk.manifest;
    expect(manifestPayloadSha256).toBe(sha256(JSON.stringify(payload)));
    expect(corpusSha256).toBe(sha256(lines));
    expect(recordCount).toBe(3);
    expect(payload.records).toEqual(
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
  } finally {
    unsubscribe();
    await host.stop();
  }
}

describe('真实 Host 已注册 actor 密度语料', () => {
  for (const actorTarget of actorTargets)
    it(`记录 ${actorTarget} 个 registered actors 的完整公开投影`, async () => {
      await captureTarget(actorTarget);
    });
});
