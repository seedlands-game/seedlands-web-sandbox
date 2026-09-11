import { describe, expect, it, vi } from 'vitest';
import { executeGameplayCharacterRequest } from '../../packages/game-core/src/server/gameplay/gameplay-character-control';
import { ActionRuntime } from '../../packages/game-core/src/server/simulation/action-runtime';
import { AutonomyRuntime } from '../../packages/game-core/src/server/simulation/autonomy-runtime';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';
import { testCorePlatform } from '../support/core-platform';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import {
  BEHAVIOR_REGISTRY_CAPABILITY,
  type BehaviorCapabilityRegistry,
} from '../../packages/game-core/src/server/composition/behavior-capability-registry';

type CharacterAutonomy = AutonomyRuntime & { readonly characters: NonNullable<AutonomyRuntime['characters']> };

// This suite retains legacy combined snapshots to exercise terminal-link migration;
// current V4 ECS checkpoint continuation is covered by npc-camp-pack.test.ts.
function snapshotWithCharacters(runtime: CharacterAutonomy) {
  return { ...runtime.snapshot(), characters: runtime.characters.snapshot() };
}

function fixture() {
  const entities = new EntityStore();
  entities.spawn({ id: 'player', type: 'player', position: [4.5, 1, 0.5], health: 20, maxHealth: 20 });
  const composition = assembleOverworldPacks([
    {
      ...overworld,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
  const runtime = new AutonomyRuntime({
    entities,
    clone: testCorePlatform.clone,
    getVoxel: (_x, y) => (y < 1 ? 3 : 0),
    getWorldTime: () => 10,
    isPlayerAlive: () => true,
    character: {
      capabilities: composition.capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY),
      changed: () => {},
      domain: {
        read(actorId) {
          const entity = entities.get(actorId);
          const reference = entities.createReference(actorId);
          if (!entity || !reference) return null;
          const actor = entities.actorStateAccess(actorId);
          return {
            reference,
            lifecycle: actor.lifecycle,
            controlSource: actor.controlSource,
            controlRevision: actor.controlRevision,
            health: entity.health ?? 0,
            maxHealth: entity.maxHealth ?? 0,
            needs: { hunger: actor.hunger, maxHunger: actor.maxHunger, hungerMeaning: actor.hungerMeaning },
            inventory: {
              slots: actor.inventory.snapshot(),
              selectedSlot: actor.selectedSlot,
              revision: actor.inventoryRevision,
            },
          };
        },
        allowsCapability: () => true,
        invoke: () => ({
          ok: false,
          code: 'TEST_DOMAIN_FORBIDDEN',
          message: 'Action retention fixture cannot change gameplay resources.',
        }),
      },
    },
    combat: {
      actorAvailable: () => true,
      targetAvailable: () => true,
      validateHit: () => null,
      applyDamage: () => null,
    },
  });
  for (const id of ['npc', 'other']) {
    entities.spawn({
      id,
      type: 'npc',
      archetype: 'settler',
      position: id === 'npc' ? [0.5, 1, 0.5] : [0.5, 1, 8.5],
      health: 20,
      maxHealth: 20,
    });
    runtime.registerActor(id, { archetype: 'settler' });
  }
  if (!runtime.characters) throw new Error('Explicit behavior composition did not create the Character runtime');
  runtime.characters.register(
    'npc',
    { name: 'Lin', personality: 'Careful and friendly', riskTolerance: 0.2 },
    [0.5, 1, 0.5],
  );
  const observed = runtime.characters.execute({ kind: 'observe', entityId: 'npc' });
  if (observed.kind !== 'observation') throw new Error('Missing observation');
  const player = observed.observation.visibleEntities.find((entity) => entity.type === 'player')!;
  const followDefinition = {
    version: 1 as const,
    root: {
      id: 'follow-player',
      type: 'action' as const,
      skill: 'follow',
      args: { targetRef: player.target.ref, maxReplans: 64 },
    },
  };
  runtime.characters.execute({
    kind: 'behavior',
    entityId: 'npc',
    requestId: 'follow',
    expectedBehaviorRevision: 1,
    goal: { description: 'Follow the visible player.' },
    definition: followDefinition,
  });
  return { runtime: runtime as CharacterAutonomy, entities, followDefinition };
}

function churn(actions: ActionRuntime, count: number) {
  for (let index = 0; index < count; index += 1) {
    const action = actions.start({ actorId: 'other', type: 'idle' }, index + 1);
    actions.succeed(action.id, index + 1);
  }
}

describe('bounded action completion history', () => {
  it('atomically rejects a restored sequence below another actor action id', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const current = actions.start({ actorId: 'npc', type: 'idle' }, 0);
    const before = actions.snapshot();
    expect(() =>
      actions.restore({ version: 1, sequence: 1, actions: [{ ...current, id: 'action-2', actorId: 'other' }] }),
    ).toThrow(/allocator high-water/);
    expect(actions.snapshot()).toEqual(before);
    expect(actions.start({ actorId: 'other', type: 'idle' }, 1).id).toBe('action-2');
    expect(actions.forActor('npc')?.id).toBe(current.id);
  });

  it('rejects exhausted or unsafe action sequences without interrupting the current action', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const current = actions.start({ actorId: 'npc', type: 'idle' }, 0);
    expect(() => actions.restore({ ...actions.snapshot(), sequence: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      /Invalid action snapshot/,
    );
    actions.restore({ ...actions.snapshot(), sequence: Number.MAX_SAFE_INTEGER });
    expect(() => actions.start({ actorId: 'npc', type: 'idle' }, 1)).toThrow(/sequence/);
    expect(actions.forActor('npc')).toEqual(current);
  });

  it('preserves completion ordering for actions finished in the same tick across restore', () => {
    const actions = new ActionRuntime(testCorePlatform.clone);
    const older = actions.start({ actorId: 'npc', type: 'idle' }, 0);
    const newer = actions.start({ actorId: 'other', type: 'idle' }, 0);
    actions.succeed(newer.id, 1);
    actions.succeed(older.id, 1);
    for (let index = 0; index < 254; index += 1) {
      const action = actions.start({ actorId: 'other', type: 'idle' }, index + 2);
      actions.succeed(action.id, index + 2);
    }
    const restored = new ActionRuntime(testCorePlatform.clone);
    restored.restore(actions.snapshot());
    const next = restored.start({ actorId: 'other', type: 'idle' }, 300);
    restored.succeed(next.id, 300);
    expect(restored.get(newer.id)).toBeNull();
    expect(restored.get(older.id)?.status).toBe('succeeded');
  });

  it('preflights exhausted capacity before Autonomy or Character request side effects', () => {
    const { runtime } = fixture();
    const snapshot = snapshotWithCharacters(runtime);
    snapshot.actions.sequence = Number.MAX_SAFE_INTEGER;
    runtime.restore(snapshot);
    const before = snapshotWithCharacters(runtime);
    expect(() => runtime.startAction('other', { type: 'idle' })).toThrow(/sequence/);
    expect(snapshotWithCharacters(runtime)).toEqual(before);
    expect(() =>
      runtime.characters.execute({
        kind: 'behavior',
        entityId: 'npc',
        requestId: 'exhausted',
        expectedBehaviorRevision: before.characters!.characters[0]!.behaviorTree!.revision,
        goal: { description: 'Move to the requested position.' },
        definition: {
          version: 1,
          root: { id: 'move-exhausted', type: 'action', skill: 'move-to', args: { position: [3.5, 1, 0.5] } },
        },
      }),
    ).toThrow(/sequence/);
    expect(snapshotWithCharacters(runtime)).toEqual(before);
    expect(() => runtime.advanceAuthorityRules(2)).not.toThrow();
    expect(runtime.actions.snapshot().sequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(runtime.characters.snapshot().characters[0]!.behaviorTree!.skills[0]).toMatchObject({
      actionId: before.characters!.characters[0]!.behaviorTree!.skills[0]!.actionId,
      status: 'running',
    });
  });

  it('rejects exhausted creation before spawn while allowing an action-free policy', () => {
    const { runtime, entities } = fixture();
    const snapshot = snapshotWithCharacters(runtime);
    snapshot.actions.sequence = Number.MAX_SAFE_INTEGER;
    runtime.restore(snapshot);
    const before = snapshotWithCharacters(runtime);
    const spawnAutonomous = vi.fn(() => {
      throw new Error('Unexpected spawn');
    });
    const profile = { name: 'New resident', personality: 'Curious' };
    for (const behaviorTree of [
      undefined,
      {
        goal: { description: 'Move home' },
        definition: {
          version: 1 as const,
          root: { id: 'move', type: 'action' as const, skill: 'move-to', args: { position: [3, 1, 0] } },
        },
      },
    ]) {
      expect(() =>
        executeGameplayCharacterRequest(
          { entities, simulation: runtime, spawnAutonomous },
          {
            kind: 'create',
            profile,
            position: [8, 1, 0],
            behaviorTree,
          },
        ),
      ).toThrow(/sequence/);
      expect(spawnAutonomous).not.toHaveBeenCalled();
      expect(snapshotWithCharacters(runtime)).toEqual(before);
      expect(() => runtime.characters.register('other', profile, [8, 1, 0], behaviorTree)).toThrow(/sequence/);
      expect(snapshotWithCharacters(runtime)).toEqual(before);
    }
    expect(() =>
      runtime.characters.validateRegistration(profile, [8, 1, 0], {
        goal: { description: 'Wait without an Authority Action' },
        definition: { version: 1, root: { id: 'wait', type: 'action', skill: 'wait', args: { seconds: 1 } } },
      }),
    ).not.toThrow();
  });

  it('rejects the same follow tree atomically when arrival left no action and capacity is exhausted', () => {
    const { runtime, entities, followDefinition } = fixture();
    entities.update('npc', { position: [4.5, 1, 0.5] });
    runtime.advanceAuthorityRules(0.1);
    const snapshot = snapshotWithCharacters(runtime);
    expect(snapshot.characters!.characters[0]!.behaviorTree!.skills[0]!.actionId).toBeUndefined();
    snapshot.actions.sequence = Number.MAX_SAFE_INTEGER;
    runtime.restore(snapshot);
    entities.update('player', { position: [7.5, 1, 0.5] });
    const before = snapshotWithCharacters(runtime);
    const character = before.characters!.characters[0]!;
    expect(() =>
      runtime.characters.execute({
        kind: 'behavior',
        entityId: 'npc',
        requestId: 'same-follow',
        expectedBehaviorRevision: character.behaviorTree!.revision,
        goal: { description: 'Continue following the visible player.' },
        definition: followDefinition,
      }),
    ).toThrow(/sequence/);
    expect(snapshotWithCharacters(runtime)).toEqual(before);
  });

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
    const { runtime, entities } = fixture();
    runtime.advanceAuthorityRules(0.1);
    const snapshot = snapshotWithCharacters(runtime);
    const linked = snapshot.characters!.characters[0]!.behaviorTree!.skills[0]!.actionId!;
    const action = snapshot.actions.actions.find((value) => value.id === linked)!;
    action.status = 'succeeded';
    action.endedAt = 0.1;
    const nextSequence = snapshot.actions.sequence + 400;
    for (let index = 0; index < 400; index += 1) {
      snapshot.actions.actions.push({
        ...action,
        id: `action-${snapshot.actions.sequence + index + 1}`,
        actorId: 'other',
        actorIdentity: entities.createReference('other')!,
        type: 'idle',
        startedAt: index + 1,
        endedAt: index + 1,
      });
    }
    snapshot.actions.sequence = nextSequence;
    runtime.restore(snapshot);
    expect(runtime.actions.get(linked)?.status).toBe('succeeded');
    expect(runtime.actions.snapshot().actions).toHaveLength(257);
    runtime.advanceAuthorityRules(0.1);
    const execution = runtime.characters.snapshot().characters[0]!.behaviorTree!.skills[0]!;
    expect(execution.actionId).toBe(`action-${nextSequence + 1}`);
    expect(runtime.actions.get(linked)).toBeNull();
    expect(runtime.actions.snapshot().actions).toHaveLength(257);
    expect(runtime.actions.forActor('npc')?.id).toBe(execution.actionId);
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
    runtime.restore(snapshotWithCharacters(runtime));
    // The gameplay-main contract resumes valid combat with current body/target identities.
    expect(runtime.combatSnapshotFor('other').active).toMatchObject({ actionId: attack.actionId, targetId: 'player' });
    expect(runtime.actions.get(attack.actionId)).toMatchObject({ status: 'running', actorId: 'other' });
  });

  it('keeps actual follow replanning history bounded at 400 and 800 simulated seconds', () => {
    const { runtime, entities } = fixture();
    const samples: { count: number; bytes: number; sequence: number }[] = [];
    // Controlled poses isolate repeated follow planning from the independently tested body/Physics loop.
    for (let step = 1; step <= 8_000; step += 1) {
      entities.update('npc', { position: [0.5, 1, step % 2 ? 0.5 : 0.6] });
      if (step % 200 === 0) entities.update('player', { position: [step % 400 === 0 ? 4.5 : 5.5, 1, 0.5] });
      runtime.advanceAuthorityRules(0.1);
      if (step === 4_000 || step === 8_000) {
        const actions = snapshotWithCharacters(runtime).actions;
        samples.push({
          count: actions.actions.length,
          bytes: JSON.stringify(actions).length,
          sequence: actions.sequence,
        });
        expect(runtime.characters.snapshot().characters[0]?.behaviorTree?.skills[0]).toMatchObject({
          skill: 'follow',
          status: 'running',
        });
      }
    }
    expect(samples.map((sample) => sample.sequence)).toEqual([1, 1]);
    expect(samples.map((sample) => sample.count)).toEqual([1, 1]);
    expect(samples[1]!.bytes).toBeLessThanOrEqual(samples[0]!.bytes * 1.05);
    runtime.restore(snapshotWithCharacters(runtime));
    runtime.advanceAuthorityRules(1);
    expect(runtime.actions.snapshot().actions.length).toBeLessThanOrEqual(257);
  });
});
