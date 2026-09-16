import { expect, it } from 'vitest';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { createLifeBehavior } from '@seedlands/stdlib/runtime/character-control-protocol';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { buildCampPackFixture } from '../../../../fixtures/packs/camp-pack';
import { withCampWork } from '../../../../fixtures/packs/camp-work/camp-work';

it('独立 ESM 能力在三角色世界发现、运行和中途恢复，正常合成不重放', async () => {
  const fixture = await buildCampPackFixture();
  let session: HeadlessSession;
  try {
    session = await HeadlessSession.create({
      seedText: 'npc-camp-extension',
      platform: testCorePlatform,
      createComposition: fixture.createComposition,
    });
  } catch (error) {
    await fixture.dispose();
    throw error;
  }
  const world = session.world;
  const advance = async (elapsedMs: number) => {
    expect(await world.clock({ kind: 'advance', elapsedMs })).toMatchObject({ ok: true });
  };
  try {
    await world.clock({ kind: 'pause' });
    const nearby = await world.command({ type: 'query-nearby', radius: 128 });
    if (!nearby.ok || !nearby.data.success) throw new Error('Fixture entity list unavailable');
    for (const entity of (nearby.data.data as { entities: { id: string; type: string }[] }).entities)
      if (entity.type !== 'player')
        expect(await world.command({ type: 'despawn-entity', entityId: entity.id })).toMatchObject({
          ok: true,
          data: { success: true },
        });
    for (const command of [
      { type: 'fill', from: [-12, 56, -12], to: [12, 56, 12], voxel: 3 },
      { type: 'fill', from: [-12, 57, -12], to: [12, 62, 12], voxel: 0 },
      { type: 'teleport', position: [0.5, 58.6, 8.5] },
      { type: 'spawn-world-item', itemId: 'berry', count: 64, position: [2.5, 57, 0.5] },
      { type: 'spawn-world-item', itemId: 'berry', count: 64, position: [-2.5, 57, 0.5] },
    ] as const)
      expect(await world.command(command)).toMatchObject({ ok: true, data: { success: true } });
    const characters = [];
    for (let index = 0; index < 3; index++) {
      const position = [index * 2 - 1.5, 57, 3.5] as const;
      const life = createLifeBehavior({
        homePosition: position,
        patrolPositions: [
          [-4.5, 57, -3.5],
          [4.5, 57, -3.5],
        ],
      });
      const created = await world.character({
        kind: 'create',
        profile: { name: `营地伙伴${index + 1}`, personality: `第${index + 1}位独立旅行者。` },
        position,
        homePosition: position,
        behaviorTree: life,
      });
      if (!created.ok || created.data.kind !== 'created') throw new Error('Camp character unavailable');
      characters.push(created.data.character);
    }
    const actor = characters[0];
    const capabilities = await world.character({ kind: 'capabilities', entityId: actor.entityId });
    expect(capabilities).toMatchObject({
      ok: true,
      data: {
        kind: 'capabilities',
        capabilities: expect.arrayContaining([
          expect.objectContaining({ id: 'sample:has-camp-material', kind: 'condition' }),
          expect.objectContaining({ id: 'sample:prepare-planks', kind: 'skill' }),
        ]),
      },
    });
    expect(
      await world.command({ type: 'give-item', entityId: actor.entityId, itemId: 'wood-block', count: 1 }),
    ).toMatchObject({ ok: true, data: { success: true } });
    expect(
      await world.character({
        kind: 'behavior',
        entityId: actor.entityId,
        requestId: 'camp-work-policy',
        expectedBehaviorRevision: actor.behaviorTree.revision,
        goal: { description: '先把自己的木材准备成营地木板，再继续吃饭和巡逻。' },
        definition: withCampWork(actor.behaviorTree.definition),
      }),
    ).toMatchObject({ ok: true });
    const observe = async (entityId = actor.entityId) => {
      const result = await world.character({ kind: 'observe', entityId });
      if (!result.ok || result.data.kind !== 'observation') throw new Error('Camp observation unavailable');
      return result.data.observation;
    };
    const count = (observation: Awaited<ReturnType<typeof observe>>, itemId: string) =>
      observation.character.inventory.reduce((sum, slot) => sum + (slot?.itemId === itemId ? slot.count : 0), 0);
    await advance(1000);
    expect((await observe()).character.behaviorTree.runtime.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skill: 'sample:prepare-planks', status: 'running', phase: 'preparing' }),
      ]),
    );
    const saved = await world.checkpoint({ kind: 'export' });
    if (!saved.ok || !saved.data.snapshot) throw new Error('Camp checkpoint unavailable');
    await advance(2000);
    expect(count(await observe(), 'wood-block')).toBe(0);
    expect(count(await observe(), 'plank')).toBe(4);
    expect(await world.checkpoint({ kind: 'restore', snapshot: saved.data.snapshot })).toMatchObject({ ok: true });
    expect(count(await observe(), 'wood-block')).toBe(1);
    await advance(2000);
    expect(count(await observe(), 'plank')).toBe(4);
    await advance(20000);
    const after = await observe();
    expect(count(after, 'plank')).toBe(4);
    expect(
      after.events.filter((event) => event.nodeId === 'camp-prepare' && event.type === 'activity-succeeded'),
    ).toHaveLength(1);
    for (const character of characters.slice(1)) {
      const other = await observe(character.entityId);
      expect(other.character.lifecycle).toBe('active');
      expect(other.events.some((event) => event.type === 'item-consumed')).toBe(true);
      expect(other.character.behaviorTree.revision).toBe(1);
    }
  } finally {
    await session.dispose();
    await fixture.dispose();
  }
}, 90000);
