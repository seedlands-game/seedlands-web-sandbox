import { describe, expect, it } from 'vitest';
import {
  createLifeBehavior,
  type CharacterObservation,
} from '../../../../../../packages/stdlib/src/runtime/character-control-protocol';
import { HeadlessSession } from '../../../../../../packages/stdlib/src/server/headless/headless-session';
import { Voxel } from '../../../../../../packages/stdlib/src/world/voxel';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import type {
  BehaviorArguments,
  BehaviorNode,
} from '../../../../../../packages/stdlib/src/runtime/behavior-control-protocol';
import { characterActorSnapshot, createCharacterComposition } from '../../../fixtures/classic/character-gameplay';

const legacyNode = (node: BehaviorNode): BehaviorNode => {
  if (node.type === 'condition') return node;
  const guard = node.id === 'threat-response' || node.id === 'threat-action' ? { name: 'threat-visible' } : node.guard;
  if (node.type === 'action') {
    const args = { ...node.args };
    delete args.avoidThreats;
    return { ...node, args, guard };
  }
  return { ...node, guard, children: node.children.map(legacyNode) };
};

const sameNameCustomRoot = (): BehaviorNode => ({
  id: 'custom-root',
  type: 'selector',
  children: [
    {
      id: 'threat-response',
      type: 'sequence',
      guard: { name: 'threat-visible' },
      children: [
        { id: 'threat-check', type: 'condition', condition: { name: 'threat-visible' } },
        { id: 'threat-action', type: 'action', skill: 'flee-threat', guard: { name: 'threat-visible' } },
      ],
    },
    { id: 'custom-fallback', type: 'action', skill: 'hold' },
  ],
});

async function setup(food = false, legacy = false, sameNameCustom = false) {
  const session = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'npc-threat-edge',
    initialWorldTime: 10,
    createComposition: createCharacterComposition,
  });
  await session.world.clock({ kind: 'pause' });
  for (const entity of session.runtime.server.queryEntities())
    if (entity.id !== session.runtime.playerId)
      await session.world.command({ type: 'despawn-entity', entityId: entity.id });
  await session.world.command({ type: 'fill', from: [-32, 56, -16], to: [16, 56, 16], voxel: Voxel.Stone });
  await session.world.command({ type: 'fill', from: [-32, 57, -16], to: [16, 61, 16], voxel: Voxel.Air });
  await session.world.command({ type: 'teleport', position: [-25.5, 58.6, 10.5] });
  expect(
    await session.world.command({
      type: 'spawn-actor',
      id: 'edge-threat',
      archetype: 'night-stalker',
      position: [1.5, 57, 0.5],
    }),
  ).toMatchObject({ ok: true, data: { success: true } });
  if (food)
    await session.world.command({ type: 'spawn-world-item', itemId: 'berry', count: 20, position: [-17.5, 57, 0.5] });
  const behaviorTree = createLifeBehavior({ homePosition: [-1.5, 57, 0.5], patrolPositions: [[1.5, 57, 0.5]] });
  const created = await session.world.character({
    kind: 'create',
    profile: { name: 'Edge', personality: 'Cautious.' },
    position: [-8, 57, 0.5],
    homePosition: [-1.5, 57, 0.5],
    behaviorTree: sameNameCustom
      ? { ...behaviorTree, definition: { ...behaviorTree.definition, root: sameNameCustomRoot() } }
      : legacy
        ? {
            ...behaviorTree,
            definition: { ...behaviorTree.definition, root: legacyNode(behaviorTree.definition.root) },
          }
        : behaviorTree,
  });
  if (!created.ok || created.data.kind !== 'created') throw new Error('NPC not created');
  return { session, id: created.data.character.entityId };
}

async function observe(session: HeadlessSession, entityId: string, sinceCursor: number) {
  const result = await session.world.character({ kind: 'observe', entityId, sinceCursor });
  if (!result.ok || result.data.kind !== 'observation') throw new Error('No observation');
  return result.data.observation;
}

const behaviorSnapshot = (session: HeadlessSession, entityId: string) =>
  characterActorSnapshot(session.runtime.server.freezeSaveSnapshot().gameplay, entityId)?.character?.behaviorTree;

describe('default life threat boundary', () => {
  it.each([false, true])(
    'does not alternate fleeing and searching without a model (legacy tree: %s)',
    async (legacy) => {
      const { session, id } = await setup(false, legacy);
      try {
        const samples: CharacterObservation[] = [];
        let cursor = 0;
        for (let second = 0; second < 20; second += 1) {
          expect(await session.world.clock({ kind: 'advance', elapsedMs: 1_000 })).toMatchObject({ ok: true });
          const sample = await observe(session, id, cursor);
          expect(sample.eventCoverage.lostRange).toBeUndefined();
          samples.push(sample);
          cursor = sample.cursor;
        }
        const events = samples.flatMap((sample) => sample.events);
        expect(
          events.filter((event) => event.type === 'activity-started' && event.nodeId === 'threat-action').length,
        ).toBeLessThanOrEqual(2);
        expect(samples.at(-1)!.self.position[0]).toBeLessThan(-10.5);
        expect(events.some((event) => event.type === 'item-consumed')).toBe(false);
        expect(events.some((event) => event.nodeId === 'hunger-action' && event.type === 'activity-started')).toBe(
          true,
        );
      } finally {
        await session.dispose();
      }
    },
    30_000,
  );

  it('does not weaken an admitted custom guard merely because its local node ids match the old life recipe', async () => {
    const { session, id } = await setup(false, false, true);
    try {
      let observation: CharacterObservation | undefined;
      for (let second = 0; second < 20; second += 1) {
        await session.world.clock({ kind: 'advance', elapsedMs: 1_000 });
        observation = await observe(session, id, 0);
      }
      expect(observation?.self.position[0]).toBeGreaterThan(-10.5);
      expect(observation?.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'activity-interrupted', nodeId: 'threat-action', reason: 'guard-failed' }),
          expect.objectContaining({ type: 'activity-started', nodeId: 'custom-fallback' }),
        ]),
      );
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('actually collects and eats food on the safe side after retreat', async () => {
    const { session, id } = await setup(true);
    try {
      const events: CharacterObservation['events'][number][] = [];
      let cursor = 0;
      for (let second = 0; second < 20; second += 1) {
        await session.world.clock({ kind: 'advance', elapsedMs: 1_000 });
        const sample = await observe(session, id, cursor);
        events.push(...sample.events);
        cursor = sample.cursor;
      }
      expect(events.some((event) => event.type === 'item-picked-up')).toBe(true);
      expect(events.some((event) => event.type === 'item-consumed')).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === 'activity-succeeded' &&
            event.nodeId === 'hunger-action' &&
            event.hunger !== undefined &&
            event.hunger <= 20,
        ),
      ).toBe(true);
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('retains bounded observed memory and search progress across pause and checkpoint without tracking unseen threats', async () => {
    const { session, id } = await setup();
    try {
      await session.world.clock({ kind: 'advance', elapsedMs: 6_000 });
      const before = behaviorSnapshot(session, id);
      if (!before) throw new Error('No behavior snapshot');
      expect(before.recentThreat?.position).toEqual([1.5, 57, 0.5]);
      expect(before.skills.some((skill) => skill.searchOrigin)).toBe(true);
      const checkpoint = await session.world.checkpoint({ kind: 'export' });
      if (!checkpoint.ok) throw new Error('No checkpoint');
      expect(await session.world.checkpoint({ kind: 'restore', snapshot: checkpoint.data.snapshot })).toMatchObject({
        ok: true,
      });
      expect(behaviorSnapshot(session, id)).toEqual(before);
      await session.world.clock({ kind: 'pause' });
      await session.world.clock({ kind: 'status' });
      expect(behaviorSnapshot(session, id)?.recentThreat).toEqual(before.recentThreat);
      // Removing the now unseen threat must not erase its last observed location omnisciently.
      await session.world.command({ type: 'despawn-entity', entityId: 'edge-threat' });
      await session.world.clock({ kind: 'advance', elapsedMs: 1_000 });
      expect(behaviorSnapshot(session, id)?.recentThreat?.position).toEqual(before.recentThreat!.position);
      await session.world.clock({ kind: 'advance', elapsedMs: 30_000 });
      expect(behaviorSnapshot(session, id)?.recentThreat).toBeUndefined();
      expect((await observe(session, id, 0)).character.lifecycle).toBe('active');

      const corrupt = testCorePlatform.clone(checkpoint.data.snapshot);
      if (!corrupt) throw new Error('No cloned checkpoint');
      const corruptBehavior = characterActorSnapshot(corrupt.gameplay, id)?.character?.behaviorTree;
      if (!corruptBehavior?.recentThreat) throw new Error('No corrupt behavior snapshot');
      corruptBehavior.recentThreat.secondsRemaining = Infinity;
      expect(await session.world.checkpoint({ kind: 'restore', snapshot: corrupt })).toMatchObject({ ok: false });
      const old = testCorePlatform.clone(checkpoint.data.snapshot);
      if (!old) throw new Error('No cloned checkpoint');
      const oldBehavior = characterActorSnapshot(old.gameplay, id)?.character?.behaviorTree;
      if (!oldBehavior) throw new Error('No old behavior snapshot');
      delete oldBehavior.recentThreat;
      for (const skill of oldBehavior.skills) delete skill.searchOrigin;
      expect(await session.world.checkpoint({ kind: 'restore', snapshot: old })).toMatchObject({ ok: true });
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it.each([
    { skill: 'patrol', targetX: 1.5 },
    { skill: 'rest-at-home', targetX: 1.5 },
    { skill: 'patrol', targetX: 15.5 },
  ] as const)(
    'waits outside an unsafe $skill route to $targetX unless the tree explicitly permits risk',
    async ({ skill, targetX }) => {
      const { session, id } = await setup();
      try {
        await session.world.clock({ kind: 'advance', elapsedMs: 6_000 });
        if (skill === 'rest-at-home') session.runtime.server.setWorldTime(20);
        const args: BehaviorArguments =
          skill === 'patrol' ? { positions: [targetX, 57, 0.5] } : { position: [targetX, 57, 0.5] };
        for (const avoidThreats of [true, false]) {
          const state = await session.world.character({ kind: 'inspect', entityId: id });
          if (!state.ok || state.data.kind !== 'state') throw new Error('No state');
          expect(
            await session.world.character({
              kind: 'behavior',
              entityId: id,
              requestId: `${skill}-${avoidThreats}`,
              expectedBehaviorRevision: state.data.character.behaviorTree.revision,
              goal: { description: 'Test configurable route risk.' },
              definition: { version: 1, root: { id: 'route', type: 'action', skill, args: { ...args, avoidThreats } } },
            }),
          ).toMatchObject({ ok: true });
          await session.world.clock({ kind: 'advance', elapsedMs: 100 });
          const after = await observe(session, id, 0);
          expect(after.character.behaviorTree.runtime.skills[0].phase).toBe(
            avoidThreats ? 'waiting-for-safety' : 'moving',
          );
        }
      } finally {
        await session.dispose();
      }
    },
    30_000,
  );
});
