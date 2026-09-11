import { describe, expect, it } from 'vitest';

import { createLifeBehavior } from '@seedlands/game-core/runtime/character-control-protocol';
import { assembleOverworldPacks, type VerifiedPackArtifact } from '@seedlands/game-core/server/composition/host-api';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { testCorePlatform } from '../support/core-platform';

const artifact: VerifiedPackArtifact = {
  ...overworld,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
};
const createComposition = () => assembleOverworldPacks([artifact]);
const profile = { name: 'Lin', personality: 'Patient and practical.', riskTolerance: 0.25 } as const;

describe('world-owned character behavior', () => {
  it('discovers the frozen world catalog and atomically replaces only a current valid tree', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'behavior-control',
      createComposition,
    });
    try {
      await session.world.clock({ kind: 'pause' });
      const behaviorTree = createLifeBehavior({
        homePosition: [1.5, 34, 0.5],
        patrolPositions: [
          [2.5, 34, 0.5],
          [1.5, 34, 1.5],
        ],
      });
      const created = await session.world.character({
        kind: 'create',
        profile,
        position: [1.5, 34, 0.5],
        behaviorTree,
      });
      if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
      const entityId = created.data.character.entityId;
      const capabilities = await session.world.character({ kind: 'capabilities' });
      if (!capabilities.ok) throw new Error('Behavior catalog unavailable.');
      expect(capabilities.data).toMatchObject({
        kind: 'capabilities',
        capabilities: expect.arrayContaining([
          expect.objectContaining({ id: 'satisfy-hunger', kind: 'skill' }),
          expect.objectContaining({ id: 'hunger-at-least', kind: 'condition' }),
        ]),
      });
      const replacement = createLifeBehavior({
        homePosition: [1.5, 34, 0.5],
        patrolPositions: [[3.5, 34, 0.5]],
        threatResponse: 'ignore',
      });
      expect(
        await session.world.character({
          kind: 'behavior',
          entityId,
          requestId: 'replace-life',
          expectedBehaviorRevision: 1,
          ...replacement,
        }),
      ).toMatchObject({ ok: true, data: { character: { behaviorTree: { revision: 2 } } } });
      const before = await session.world.character({ kind: 'inspect', entityId });
      expect(
        await session.world.character({
          kind: 'behavior',
          entityId,
          requestId: 'stale-life',
          expectedBehaviorRevision: 1,
          ...behaviorTree,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'WORLD_EXECUTION_FAILED', message: expect.stringMatching(/CONFLICT/) },
      });
      expect(await session.world.character({ kind: 'inspect', entityId })).toEqual(before);
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('restores a running standard provider ledger without replaying completed speech', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'behavior-ledger',
      createComposition,
    });
    try {
      await session.world.clock({ kind: 'pause' });
      const created = await session.world.character({
        kind: 'create',
        profile,
        position: [1.5, 34, 0.5],
        behaviorTree: {
          goal: { description: 'Greet once, then wait.' },
          definition: {
            version: 1,
            root: {
              id: 'greeting',
              type: 'sequence',
              children: [
                { id: 'say-once', type: 'action', skill: 'speak', args: { text: 'Hello.' } },
                { id: 'wait-after', type: 'action', skill: 'hold' },
              ],
            },
          },
        },
      });
      if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
      const entityId = created.data.character.entityId;
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
      const checkpoint = await session.world.checkpoint({ kind: 'export' });
      if (!checkpoint.ok || !checkpoint.data.snapshot) throw new Error('Checkpoint unavailable.');
      expect(await session.world.checkpoint({ kind: 'restore', snapshot: checkpoint.data.snapshot })).toMatchObject({
        ok: true,
      });
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
      const observed = await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
      if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Observation unavailable.');
      expect(
        observed.data.observation.events.filter((event) => event.type === 'speech' && event.text === 'Hello.'),
      ).toHaveLength(1);
      expect(observed.data.observation.character.behaviorTree.runtime.skills).toEqual(
        expect.arrayContaining([expect.objectContaining({ nodeId: 'wait-after', status: 'running' })]),
      );
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('dispatches standard combat through its declared registered operation and applies damage', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'behavior-registered-combat',
      createComposition,
    });
    try {
      await session.world.clock({ kind: 'pause' });
      for (const command of [
        { type: 'fill', from: [-4, 56, -4], to: [4, 56, 4], voxel: 3 },
        { type: 'fill', from: [-4, 57, -4], to: [4, 60, 4], voxel: 0 },
        { type: 'teleport', position: [2, 58.6, 0.5] },
      ] as const)
        expect(await session.world.command(command)).toMatchObject({ ok: true, data: { success: true } });
      const created = await session.world.character({
        kind: 'create',
        profile,
        position: [0.5, 57, 0.5],
        behaviorTree: {
          goal: { description: 'Defend against the visible threat.' },
          definition: { version: 1, root: { id: 'defend', type: 'action', skill: 'attack-threat' } },
        },
      });
      if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
      expect(
        session.runtime.server.attackEntity(session.runtime.playerId, created.data.character.entityId),
      ).toMatchObject({ success: true });
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
      const inspected = await session.world.character({ kind: 'inspect', entityId: created.data.character.entityId });
      expect(inspected).toMatchObject({
        ok: true,
        data: {
          character: {
            behaviorTree: {
              runtime: {
                skills: [
                  expect.objectContaining({
                    skill: 'attack-threat',
                    status: 'running',
                    phase: 'attacking',
                    actionId: expect.any(String),
                  }),
                ],
              },
            },
          },
        },
      });
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
      expect(session.runtime.server.getPlayerState(session.runtime.playerId).health).toBeLessThan(20);
    } finally {
      await session.dispose();
    }
  }, 30_000);
});
