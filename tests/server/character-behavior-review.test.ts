import { describe, expect, it } from 'vitest';
import type { BehaviorDefinition, BehaviorGoal } from '../../packages/game-core/src/runtime/behavior-control-protocol';
import type { CharacterObservation } from '../../packages/game-core/src/runtime/character-control-protocol';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { Voxel } from '../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../support/core-platform';

const profile = { name: 'Review', personality: 'Methodical.', riskTolerance: 0.3 } as const;

async function flatSession(seed: string) {
  const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: seed, initialWorldTime: 10 });
  await session.world.clock({ kind: 'pause' });
  await session.world.command({ type: 'fill', from: [-32, 56, -4], to: [32, 56, 4], voxel: Voxel.Stone });
  await session.world.command({ type: 'fill', from: [-32, 57, -4], to: [32, 60, 4], voxel: Voxel.Air });
  return session;
}

async function events(session: HeadlessSession, entityId: string) {
  const result = await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
  if (!result.ok || result.data.kind !== 'observation') throw new Error('Character observation unavailable.');
  return result.data.observation.events;
}

describe('behavior independent-review corrections', () => {
  it('does not spend replan recovery budget during healthy long travel', async () => {
    const session = await flatSession('healthy-long-travel');
    const created = await session.world.character({
      kind: 'create',
      profile,
      position: [-20.5, 57, 0.5],
      behaviorTree: {
        goal: { description: 'Walk a healthy route longer than the default replan horizon.' },
        definition: {
          version: 1,
          root: {
            id: 'travel-sequence',
            type: 'sequence',
            children: [
              { id: 'long-travel', type: 'action', skill: 'move-to', args: { position: [20.5, 57, 0.5] } },
              { id: 'after-travel', type: 'action', skill: 'hold' },
            ],
          },
        },
      },
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    for (let second = 0; second < 30; second += 1) await session.world.clock({ kind: 'advance', elapsedMs: 1_000 });
    const state = await session.world.character({ kind: 'inspect', entityId: created.data.character.entityId });
    expect(state).toMatchObject({
      ok: true,
      data: {
        character: {
          behaviorTree: {
            runtime: {
              skills: expect.arrayContaining([
                expect.objectContaining({ nodeId: 'long-travel', status: 'succeeded', replanCount: 0 }),
              ]),
            },
          },
        },
      },
    });
    expect(await events(session, created.data.character.entityId)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ nodeId: 'long-travel', reason: 'replan-limit' })]),
    );
    await session.dispose();
  }, 30_000);

  it('retains terminal effects only when their control-flow context is unchanged', async () => {
    const session = await flatSession('terminal-migration-context');
    const initial = {
      goal: { description: 'Say once, then remain.' },
      definition: {
        version: 1 as const,
        root: {
          id: 'root-sequence',
          type: 'sequence' as const,
          children: [
            { id: 'say-once', type: 'action' as const, skill: 'speak', args: { text: 'Context matters.' } },
            { id: 'reorder-node', type: 'action' as const, skill: 'wait', args: { seconds: 0 } },
            { id: 'hold-after', type: 'action' as const, skill: 'hold' },
          ],
        },
      },
    } as const satisfies Readonly<{ goal: BehaviorGoal; definition: BehaviorDefinition }>;
    const created = await session.world.character({
      kind: 'create',
      profile,
      position: [0.5, 57, 0.5],
      behaviorTree: initial,
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    await session.world.clock({ kind: 'advance', elapsedMs: 100 });
    expect((await events(session, entityId)).filter((event) => event.type === 'speech')).toHaveLength(1);
    const beforeSwap = await session.world.character({ kind: 'inspect', entityId });
    if (!beforeSwap.ok || beforeSwap.data.kind !== 'state') throw new Error('Character state unavailable.');
    const holdActivation = beforeSwap.data.character.behaviorTree.runtime.skills.find(
      (entry) => entry.nodeId === 'hold-after',
    )?.activation;
    expect(
      await session.world.character({
        kind: 'behavior',
        entityId,
        requestId: 'same-context',
        expectedBehaviorRevision: 1,
        ...initial,
      }),
    ).toMatchObject({ ok: true });
    await session.world.clock({ kind: 'advance', elapsedMs: 100 });
    expect((await events(session, entityId)).filter((event) => event.type === 'speech')).toHaveLength(1);
    const afterCompatibleSwap = await session.world.character({ kind: 'inspect', entityId });
    if (!afterCompatibleSwap.ok || afterCompatibleSwap.data.kind !== 'state')
      throw new Error('Character state unavailable.');
    expect(afterCompatibleSwap.data.character.behaviorTree.runtime.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'hold-after', status: 'running', activation: holdActivation }),
      ]),
    );

    expect(
      await session.world.character({
        kind: 'behavior',
        entityId,
        requestId: 'changed-context',
        expectedBehaviorRevision: 2,
        goal: initial.goal,
        definition: {
          version: 1,
          root: {
            id: 'root-sequence',
            type: 'sequence',
            children: [
              initial.definition.root.children[1],
              initial.definition.root.children[0],
              initial.definition.root.children[2],
            ],
          },
        },
      }),
    ).toMatchObject({ ok: true });
    await session.world.clock({ kind: 'advance', elapsedMs: 100 });
    expect((await events(session, entityId)).filter((event) => event.type === 'speech')).toHaveLength(2);
    await session.dispose();
  }, 30_000);

  it('rejects a restored ledger skill that mismatches its signed definition without mutating the world', async () => {
    const session = await flatSession('restore-ledger-skill');
    const created = await session.world.character({
      kind: 'create',
      profile,
      position: [0.5, 57, 0.5],
      behaviorTree: {
        goal: { description: 'Keep moving.' },
        definition: {
          version: 1,
          root: { id: 'move', type: 'action', skill: 'move-to', args: { position: [10.5, 57, 0.5] } },
        },
      },
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    await session.world.clock({ kind: 'advance', elapsedMs: 200 });
    const before = await session.world.character({ kind: 'inspect', entityId });
    const actionBefore = session.runtime.server.getActorAction(entityId);
    const checkpoint = await session.world.checkpoint({ kind: 'export' });
    if (!checkpoint.ok) throw new Error('Checkpoint unavailable.');
    const corrupted = testCorePlatform.clone(checkpoint.data.snapshot);
    if (!corrupted) throw new Error('Cloned checkpoint unavailable.');
    const simulation = corrupted.gameplay.simulation;
    if (!simulation) throw new Error('Simulation checkpoint unavailable.');
    const execution = simulation.characters?.characters[0]?.behaviorTree?.skills.find(
      (entry) => entry.nodeId === 'move',
    );
    if (!execution?.actionId) throw new Error('Running movement ledger unavailable.');
    (execution as { skill: string }).skill = 'speak';
    expect(await session.world.checkpoint({ kind: 'restore', snapshot: corrupted })).toMatchObject({ ok: false });
    expect(await session.world.character({ kind: 'inspect', entityId })).toEqual(before);
    expect(session.runtime.server.getActorAction(entityId)?.id).toBe(actionBefore?.id);
    await session.dispose();
  }, 30_000);

  it('gives composite monitor and guard consumers independent dialogue edges', async () => {
    const session = await flatSession('composite-dialogue-edge');
    const created = await session.world.character({
      kind: 'create',
      profile,
      position: [0.5, 57, 0.5],
      behaviorTree: {
        goal: { description: 'React once to each new dialogue.' },
        definition: {
          version: 1,
          root: {
            id: 'dialogue-selector',
            type: 'selector',
            children: [
              {
                id: 'dialogue-reply',
                type: 'action',
                skill: 'speak',
                args: { text: 'I heard you.' },
                guard: { all: [{ name: 'always' }, { name: 'dialogue-received' }] },
              },
              { id: 'dialogue-poll', type: 'action', skill: 'wait', args: { seconds: 0.1 } },
            ],
          },
          monitors: [
            {
              id: 'composite-dialogue-monitor',
              condition: { any: [{ name: 'dialogue-received' }, { name: 'hunger-at-least', args: { value: 100 } }] },
              reason: 'new-dialogue',
            },
          ],
        },
      },
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    await session.world.clock({ kind: 'advance', elapsedMs: 100 });
    for (const text of ['First?', 'Second?']) {
      expect(await session.world.character({ kind: 'dialogue', entityId, text })).toMatchObject({ ok: true });
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
      await session.world.clock({ kind: 'advance', elapsedMs: 100 });
    }
    const facts: readonly CharacterObservation['events'][number][] = await events(session, entityId);
    expect(facts.filter((event) => event.type === 'speech' && event.text === 'I heard you.')).toHaveLength(2);
    expect(
      facts.filter((event) => event.type === 'rejudge-requested' && event.nodeId === 'composite-dialogue-monitor'),
    ).toHaveLength(2);
    await session.dispose();
  }, 30_000);
});
