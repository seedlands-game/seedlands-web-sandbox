import { describe, expect, it } from 'vitest';
import { ActionRuntime, type ActorAction } from '../../packages/game-core/src/server/simulation/action-runtime';
import { AutonomyRuntime } from '../../packages/game-core/src/server/simulation/autonomy-runtime';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';
import { testCorePlatform } from '../support/core-platform';

function fixture() {
  const entities = new EntityStore();
  entities.spawn({ id: 'player', type: 'player', position: [4.5, 1, 0.5] });
  const runtime = new AutonomyRuntime({
    entities,
    clone: testCorePlatform.clone,
    getVoxel: (_x, y) => (y < 1 ? 3 : 0),
    getWorldTime: () => 10,
    isPlayerAlive: () => true,
    combat: {
      actorAvailable: () => true,
      targetAvailable: () => true,
      validateHit: () => null,
      applyDamage: () => null,
    },
  });
  for (const id of ['npc', 'other']) {
    entities.spawn({ id, type: 'npc', archetype: 'settler', position: [0.5, 1, 0.5] });
    runtime.registerActor(id, { archetype: 'settler' });
  }
  runtime.characters.register(
    'npc',
    { name: 'Lin', personality: 'Careful and friendly', riskTolerance: 0.2 },
    [0.5, 1, 0.5],
  );
  const observed = runtime.characters.execute({ kind: 'observe', entityId: 'npc' });
  if (observed.kind !== 'observation') throw new Error('Missing observation');
  const player = observed.observation.visibleEntities.find((entity) => entity.type === 'player')!;
  runtime.characters.execute({
    kind: 'intent',
    entityId: 'npc',
    requestId: 'follow',
    expectedRevision: 0,
    goal: { kind: 'follow', target: player.target },
  });
  return { runtime, entities };
}

function churn(actions: ActionRuntime, count: number) {
  for (let index = 0; index < count; index += 1) {
    const action = actions.start({ actorId: 'other', type: 'idle' }, index + 1);
    actions.succeed(action.id, index + 1);
  }
}

describe('bounded action completion history', () => {
  it('retains active actions and orders a long-running completion by finish time', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const old = actions.start({ actorId: 'npc', type: 'move-to' }, 0);
    churn(actions, 800);
    expect(actions.snapshot().actions).toHaveLength(257);
    expect(actions.forActor('npc')?.id).toBe(old.id);
    actions.succeed(old.id, 1000);
    expect(actions.get(old.id)?.status).toBe('succeeded');
    expect(actions.snapshot().actions).toHaveLength(256);
    const restored = new ActionRuntime(testCorePlatform.clone);
    restored.restore(actions.snapshot());
    expect(restored.get(old.id)).toEqual(actions.get(old.id));
    expect(restored.start({ actorId: 'npc', type: 'idle' }, 1001).id).toBe('action-802');
  });

  it('retains unresolved character terminal links across old oversized saves, then releases them', () => {
    const { runtime } = fixture();
    runtime.advanceAuthorityRules(0.1);
    const snapshot = runtime.snapshot();
    const linked = snapshot.characters!.characters[0]!.actionId!;
    const action = snapshot.actions.actions.find((value) => value.id === linked)!;
    action.status = 'succeeded';
    action.endedAt = 0.1;
    const nextSequence = snapshot.actions.sequence + 400;
    for (let index = 0; index < 400; index += 1) {
      snapshot.actions.actions.push({
        ...action,
        id: `action-${snapshot.actions.sequence + index + 1}`,
        actorId: 'other',
        type: 'idle',
        startedAt: index + 1,
        endedAt: index + 1,
      } satisfies ActorAction);
    }
    snapshot.actions.sequence = nextSequence;
    runtime.restore(snapshot);
    expect(runtime.actions.get(linked)?.status).toBe('succeeded');
    expect(runtime.actions.snapshot().actions).toHaveLength(257);
    runtime.advanceAuthorityRules(0.1);
    expect(runtime.characters.snapshot().characters[0]!.actionId).toBeUndefined();
    expect(runtime.actions.get(linked)).toBeNull();
    expect(runtime.actions.snapshot().actions).toHaveLength(256);
    runtime.advanceAuthorityRules(0.1);
    expect(runtime.actions.forActor('npc')?.id).toBe(`action-${nextSequence + 1}`);
  });

  it('preserves an active combat action and its checkpoint link during other actors history churn', () => {
    const { runtime } = fixture();
    const attack = runtime.requestActorCombat('other', 'player', 'wood-sword');
    if (!attack.success) throw new Error(attack.reason);
    for (let index = 0; index < 400; index += 1) {
      const action = runtime.actions.start({ actorId: 'npc', type: 'idle' }, index);
      runtime.actions.succeed(action.id, index);
    }
    expect(runtime.actions.get(attack.actionId)?.status).toBe('running');
    runtime.restore(runtime.snapshot());
    expect(runtime.combatSnapshotFor('other').active).toBeNull();
    expect(runtime.actions.get(attack.actionId)).toMatchObject({ status: 'interrupted', reason: 'restore-cancelled' });
    expect(runtime.combatSnapshotFor('other').lastResult?.actionId).toBe(attack.actionId);
  });

  it('keeps actual follow replanning history bounded at 400 and 800 simulated seconds', () => {
    const { runtime, entities } = fixture();
    const samples: { count: number; bytes: number; sequence: number }[] = [];
    // Controlled poses isolate repeated follow planning from the independently tested body/Physics loop.
    for (let seconds = 1; seconds <= 800; seconds += 1) {
      entities.update('player', { position: [seconds % 2 ? 4.5 : 5.5, 1, 0.5] });
      runtime.advanceAuthorityRules(1);
      if (seconds === 400 || seconds === 800) {
        const actions = runtime.snapshot().actions;
        samples.push({
          count: actions.actions.length,
          bytes: JSON.stringify(actions).length,
          sequence: actions.sequence,
        });
        expect(runtime.characters.snapshot().characters[0]?.currentGoal.status).toBe('active');
      }
    }
    expect(samples[0]!.sequence).toBeGreaterThanOrEqual(350);
    expect(samples[1]!.sequence).toBeGreaterThan(samples[0]!.sequence + 350);
    expect(samples.map((sample) => sample.count)).toEqual([257, 257]);
    expect(samples[1]!.bytes).toBeLessThanOrEqual(samples[0]!.bytes * 1.05);
    runtime.restore(runtime.snapshot());
    runtime.advanceAuthorityRules(1);
    expect(runtime.actions.snapshot().actions.length).toBeLessThanOrEqual(257);
  });
});
