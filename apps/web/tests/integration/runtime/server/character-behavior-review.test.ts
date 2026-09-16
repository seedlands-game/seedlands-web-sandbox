import { describe, expect, it } from 'vitest';

import { createLifeBehavior } from '@seedlands/stdlib/runtime/character-control-protocol';
import type { BehaviorDefinition, BehaviorNode } from '@seedlands/stdlib/mod-api';
import { assembleOverworldPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import { HeadlessSession } from '../../../../../../packages/stdlib/src/server/headless/headless-session';
import { pack as overworld } from '../../../../../../playbooks/classic/src/pack';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';

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
const profile = { name: 'Review', personality: 'Methodical.', riskTolerance: 0.3 } as const;

describe('behavior independent-review corrections', () => {
  it('does not oscillate at the threat-memory boundary before resuming hunger work', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'threat-memory-boundary',
      initialWorldTime: 10,
      createComposition,
    });
    try {
      const world = session.world;
      await world.clock({ kind: 'pause' });
      for (const command of [
        { type: 'fill', from: [-32, 56, -16], to: [16, 56, 16], voxel: 3 },
        { type: 'fill', from: [-32, 57, -16], to: [16, 61, 16], voxel: 0 },
        { type: 'teleport', position: [-25.5, 58.6, 10.5] },
        { type: 'spawn-actor', id: 'edge-threat', archetype: 'night-stalker', position: [1.5, 57, 0.5] },
        { type: 'spawn-world-item', itemId: 'berry', count: 20, position: [-17.5, 57, 0.5] },
      ] as const)
        expect(await world.command(command)).toMatchObject({ ok: true, data: { success: true } });
      const created = await world.character({
        kind: 'create',
        profile,
        position: [-8, 57, 0.5],
        homePosition: [-1.5, 57, 0.5],
        behaviorTree: createLifeBehavior({
          homePosition: [-1.5, 57, 0.5],
          patrolPositions: [[1.5, 57, 0.5]],
        }),
      });
      if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
      const entityId = created.data.character.entityId;
      const events = [];
      let cursor = 0;
      let lastX = 0;
      for (let second = 0; second < 20; second += 1) {
        expect(await world.clock({ kind: 'advance', elapsedMs: 1_000 })).toMatchObject({ ok: true });
        const observed = await world.character({ kind: 'observe', entityId, sinceCursor: cursor });
        if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Observation unavailable.');
        events.push(...observed.data.observation.events);
        cursor = observed.data.observation.cursor;
        lastX = observed.data.observation.self.position[0];
      }
      const threatStarts = events.filter(
        (event) => event.type === 'activity-started' && event.nodeId === 'threat-action',
      );
      expect(threatStarts.length).toBeGreaterThan(0);
      expect(threatStarts.length).toBeLessThanOrEqual(2);
      expect(lastX).toBeLessThan(-10.5);
      expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['item-picked-up', 'item-consumed']));
    } finally {
      await session.dispose();
    }
  }, 45_000);

  it('retains terminal effects only while their control-flow context is unchanged', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'terminal-migration-context',
      createComposition,
    });
    try {
      await session.world.clock({ kind: 'pause' });
      const goal = { description: 'Say once, then remain.' };
      const sayNode = {
        id: 'say-once',
        type: 'action' as const,
        skill: 'speak',
        args: { text: 'Context matters.' },
      } satisfies BehaviorNode;
      const waitNode = {
        id: 'wait-once',
        type: 'action' as const,
        skill: 'wait',
        args: { seconds: 0 },
      } satisfies BehaviorNode;
      const holdNode = { id: 'hold-after', type: 'action' as const, skill: 'hold' } satisfies BehaviorNode;
      const root = {
        id: 'root-sequence',
        type: 'sequence' as const,
        children: [sayNode, waitNode, holdNode],
      } satisfies BehaviorNode;
      const definition = {
        version: 1 as const,
        root,
      } satisfies BehaviorDefinition;
      const created = await session.world.character({
        kind: 'create',
        profile,
        position: [0.5, 34, 0.5],
        behaviorTree: { goal, definition },
      });
      if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
      const entityId = created.data.character.entityId;
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
      expect(
        await session.world.character({
          kind: 'behavior',
          entityId,
          requestId: 'same-context',
          expectedBehaviorRevision: 1,
          goal,
          definition,
        }),
      ).toMatchObject({ ok: true });
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
      const same = await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
      if (!same.ok || same.data.kind !== 'observation') throw new Error('Observation unavailable.');
      expect(same.data.observation.events.filter((event) => event.type === 'speech')).toHaveLength(1);

      expect(
        await session.world.character({
          kind: 'behavior',
          entityId,
          requestId: 'changed-context',
          expectedBehaviorRevision: 2,
          goal,
          definition: {
            ...definition,
            root: {
              ...root,
              children: [root.children[1], root.children[0], root.children[2]],
            },
          },
        }),
      ).toMatchObject({ ok: true });
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
      const changed = await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
      if (!changed.ok || changed.data.kind !== 'observation') throw new Error('Observation unavailable.');
      expect(changed.data.observation.events.filter((event) => event.type === 'speech')).toHaveLength(2);
    } finally {
      await session.dispose();
    }
  }, 30_000);
});
