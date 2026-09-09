import { describe, expect, it } from 'vitest';
import { HeadlessSession } from '@seedlands/game-core/server/headless/headless-session';
import { createLifeBehavior } from '@seedlands/game-core/runtime/character-control-protocol';
import { testCorePlatform } from '../support/core-platform';

describe('three resident resource competition', () => {
  it('commits one shared food unit once across independent persistent trees', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'npc-resource-competition',
      initialWorldTime: 9,
    });
    try {
      await session.world.clock({ kind: 'pause' });
      for (const entity of session.runtime.server.queryEntities())
        if (entity.id !== session.runtime.playerId)
          await session.world.command({ type: 'despawn-entity', entityId: entity.id });
      for (const command of [
        { type: 'fill' as const, from: [-5, 56, -5] as const, to: [5, 56, 5] as const, voxel: 3 },
        { type: 'fill' as const, from: [-5, 57, -5] as const, to: [5, 61, 5] as const, voxel: 0 },
        { type: 'teleport' as const, position: [4.5, 57, 4.5] as const },
        { type: 'spawn-world-item' as const, position: [0.5, 57, 0.5] as const, itemId: 'berry', count: 1 },
      ])
        expect(await session.world.command(command)).toMatchObject({ ok: true, data: { success: true } });
      const ids: string[] = [];
      for (const position of [
        [-1.5, 57, 0.5],
        [2.5, 57, 0.5],
        [0.5, 57, -1.5],
      ] as const) {
        const result = await session.world.character({
          kind: 'create',
          position,
          profile: { name: `旅伴${ids.length}`, personality: '饿了会找食物' },
          behaviorTree: createLifeBehavior({ homePosition: position, patrolPositions: [position] }),
        });
        if (!result.ok || result.data.kind !== 'created') throw new Error('resident creation failed');
        ids.push(result.data.character.entityId);
      }
      const picked: { actor: string; cursor: number }[] = [];
      const consumed: { actor: string; cursor: number }[] = [];
      const cursors = new Map(ids.map((id) => [id, 0]));
      for (let step = 0; step < 50; step++) {
        const result = await session.world.clock({ kind: 'advance', elapsedMs: 200 });
        expect(result.ok).toBe(true);
        for (const id of ids) {
          const result = await session.world.character({ kind: 'observe', entityId: id, sinceCursor: cursors.get(id) });
          if (!result.ok || result.data.kind !== 'observation') throw new Error('observation unavailable');
          const observation = result.data.observation;
          cursors.set(id, observation.cursor);
          expect(observation.character.lifecycle).toBe('active');
          for (const event of observation.events) {
            if (event.type === 'item-picked-up') picked.push({ actor: id, cursor: event.cursor });
            if (event.type === 'item-consumed') consumed.push({ actor: id, cursor: event.cursor });
          }
        }
      }
      expect(picked).toHaveLength(1);
      expect(consumed).toHaveLength(1);
      expect(consumed[0]?.actor).toBe(picked[0]?.actor);
      const checkpoint = await session.world.checkpoint({ kind: 'export' });
      expect(checkpoint.ok).toBe(true);
    } finally {
      await session.dispose();
    }
  });
});
