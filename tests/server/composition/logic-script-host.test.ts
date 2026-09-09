import { expect, it, vi } from 'vitest';
import { HeadlessSession } from '../../../packages/game-core/src/server/headless/headless-session';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import type { LogicIntentAction } from '../../../packages/game-core/src/server/logic/logic-protocol';
import { testCorePlatform } from '../../support/core-platform';

async function setup(allowCombat: boolean, defaultDeveloper = false, feeding?: 'allow' | 'deny') {
  const session = await HeadlessSession.create({
    seedText: 'logic-script-host',
    platform: testCorePlatform,
    createComposition: () =>
      assembleOverworldPacks([
        {
          ...pack,
          integrity: {
            algorithm: 'sha256',
            manifestDigest: 'a'.repeat(64),
            entryDigest: 'b'.repeat(64),
            resources: [],
          },
        },
      ]),
    worldHarness: defaultDeveloper
      ? undefined
      : {
          principalId: 'script',
          authorization: {
            principals: [{ id: 'script', subject: 'test:logic-script', kind: 'actor', boundEntityId: 'hunter' }],
            rules: [
              { effect: 'allow', resources: ['world.logic'], operations: ['read', 'control', 'execute'], scope: 'any' },
              { effect: 'allow', resources: ['world.action'], operations: ['execute'], scope: 'self' },
              { effect: 'allow', resources: ['seedlands.ruleset'], operations: ['read'], scope: 'any' },
              ...(feeding === 'allow'
                ? [
                    {
                      effect: 'allow' as const,
                      resources: ['seedlands.feeding-actor', 'seedlands.feeding-item'],
                      operations: ['read' as const, 'execute' as const],
                      scope: 'any' as const,
                    },
                  ]
                : []),
              ...(allowCombat
                ? [
                    {
                      effect: 'allow' as const,
                      resources: ['seedlands.combat'],
                      operations: ['read' as const, 'execute' as const],
                      scope: 'any' as const,
                    },
                  ]
                : []),
            ],
          },
        },
  });
  const [x, y, z] = session.runtime.server.getEntity(session.runtime.playerId)!.position;
  session.runtime.server.spawnAutonomousActor({
    id: 'hunter',
    archetype: feeding ? 'grazer' : 'night-stalker',
    position: [x, y + 3, z],
    registration: feeding ? { hunger: 60 } : undefined,
  });
  session.runtime.server.spawnAutonomousActor({ id: 'other', archetype: 'night-stalker', position: [x + 4, y + 3, z] });
  session.runtime.server.spawnPlayer({ id: 'prey', position: [x, y + 3, z + 1] });
  await session.world.logic({ kind: 'mode', mode: 'scripted' });
  return session;
}

async function submit(session: HeadlessSession, entityId: string, action?: LogicIntentAction) {
  const observed = await session.world.logic({ kind: 'observe' });
  if (!observed.ok || !('observation' in observed.data) || !observed.data.observation)
    throw new Error('No observation.');
  const observation = observed.data.observation;
  const entity = observation.entities.find((candidate) => candidate.id === entityId)!;
  return session.world.logic({
    kind: 'submit',
    batch: {
      protocolVersion: 1,
      epoch: observation.epoch,
      observationSequence: observation.observationSequence,
      expiresAtPhysicsTick: observation.physicsTick + 12,
      intents: [
        {
          entityId,
          identityRevision: entity.identityRevision,
          observedPoseRevision: entity.poseRevision,
          readChunkRevisions: [],
          wish: { x: 1, z: 0 },
          jumpRequested: false,
          verticalIntent: 0,
          ...(action ? { action } : {}),
        },
      ],
    },
  });
}

it.each([false, true])(
  'scripted Logic uses actual Combat permission and origin (allowed: %s)',
  async (allowed) => {
    const session = await setup(allowed);
    try {
      const before = session.runtime.server.simulationSnapshot();
      const health = session.runtime.server.getEntity('prey')!.health!;
      expect(await submit(session, 'hunter', { type: 'attack', targetId: 'prey' })).toMatchObject({ ok: true });
      if (!allowed) expect(session.runtime.server.simulationSnapshot()).toEqual(before);
      else
        expect(
          session.runtime.server.simulationSnapshot().combat?.combatants.find((entry) => entry.actorId === 'hunter')
            ?.combat.active,
        ).toMatchObject({ origin: { principalSubject: 'test:logic-script' } });
      session.runtime.server.advanceGameplayRules(0.3);
      expect(session.runtime.server.getEntity('prey')!.health).toBe(health - (allowed ? 2 : 0));
    } finally {
      await session.dispose();
    }
  },
  15000,
);

it('does not let world.logic permission drive another actor outside world.action self scope', async () => {
  const session = await setup(true);
  try {
    const before = session.runtime.server.simulationSnapshot();
    const position = session.runtime.server.getEntity('other')!.position;
    expect(
      await submit(session, 'other', { type: 'move-to', target: [position[0] + 2, position[1], position[2]] }),
    ).toMatchObject({ ok: true });
    expect(session.runtime.server.simulationSnapshot()).toEqual(before);
    expect(session.runtime.server.getActorAction('other')).toBeNull();
  } finally {
    await session.dispose();
  }
}, 15000);

it.each([false, true])(
  'script cannot retain an autonomous Combat action under borrowed origin (%s)',
  async (allowed) => {
    const session = await setup(allowed);
    try {
      const started = session.runtime.server.applyActorAuthorityAction('hunter', { type: 'attack', targetId: 'prey' });
      expect(started).toMatchObject({ accepted: true });
      const action = session.runtime.server.getActorAction('hunter')!;
      const before = session.runtime.server.simulationSnapshot();
      const applied = vi.spyOn(session.runtime.server, 'applyActorAuthorityAction');
      await submit(session, 'hunter', { type: 'start-existing-action', actionId: action.id });
      expect(applied.mock.results[0]?.value).toMatchObject({ accepted: false, changed: false });
      expect(session.runtime.server.simulationSnapshot()).toEqual(before);
    } finally {
      await session.dispose();
    }
  },
  15000,
);

it('retains the same script Combat action without issuing or buffering another attack', async () => {
  const session = await setup(true);
  try {
    await submit(session, 'hunter', { type: 'attack', targetId: 'prey' });
    const action = session.runtime.server.getActorAction('hunter')!;
    const before = session.runtime.server.simulationSnapshot();
    const applied = vi.spyOn(session.runtime.server, 'applyActorAuthorityAction');
    await submit(session, 'hunter', { type: 'start-existing-action', actionId: action.id });
    expect(applied.mock.results[0]?.value, JSON.stringify(applied.mock.results[0]?.value)).toMatchObject({
      accepted: true,
      changed: false,
    });
    expect(session.runtime.server.simulationSnapshot()).toEqual(before);
  } finally {
    await session.dispose();
  }
}, 15000);

it('filters pure movement wishes by actor scope while retaining authorized self movement', async () => {
  const session = await setup(true);
  try {
    session.runtime.pause(session.runtime.sessionTimeMs);
    const otherX = session.runtime.server.getEntity('other')!.position[0];
    const hunterX = session.runtime.server.getEntity('hunter')!.position[0];
    await submit(session, 'other');
    session.runtime.advancePausedSession(100);
    expect(session.runtime.server.getEntity('other')!.position[0]).toBe(otherX);
    await submit(session, 'hunter');
    session.runtime.advancePausedSession(100);
    expect(session.runtime.server.getEntity('hunter')!.position[0]).toBeGreaterThan(hunterX);
  } finally {
    await session.dispose();
  }
}, 15000);

it('default developer Harness can submit registered Logic with its own durable identity', async () => {
  const session = await setup(true, true);
  try {
    const health = session.runtime.server.getEntity('prey')!.health!;
    await submit(session, 'hunter', { type: 'attack', targetId: 'prey' });
    expect(session.runtime.server.getActorAction('hunter')).toMatchObject({ type: 'attack', status: 'running' });
    const active = session.runtime.server
      .simulationSnapshot()
      .combat?.combatants.find((entry) => entry.actorId === 'hunter')?.combat.active;
    expect(active).toMatchObject({ origin: { principalSubject: expect.stringContaining('developer') } });
    session.runtime.server.advanceGameplayRules(0.3);
    expect(session.runtime.server.getEntity('prey')!.health).toBe(health - 2);
  } finally {
    await session.dispose();
  }
}, 15000);

it.each(['allow', 'deny'] as const)(
  'scripted ground food uses actual Feeding grants (%s)',
  async (permission) => {
    const session = await setup(false, false, permission);
    try {
      const server = session.runtime.server;
      const [x, y, z] = server.getEntity('hunter')!.position;
      const food = server.spawnWorldItem([x + 0.5, y, z], { itemId: 'berry', count: 2 });
      const before = server.freezePortableSaveSnapshot(0);
      await submit(session, 'hunter', { type: 'consume-world-item', targetId: food.id });
      if (permission === 'deny') expect(server.freezePortableSaveSnapshot(0)).toEqual(before);
      else {
        expect(server.getEntity(food.id)?.stack?.count).toBe(1);
        expect(server.getActorState('hunter')?.hunger).toBe(0);
        expect(server.getActorAction('hunter')).toBeNull();
      }
    } finally {
      await session.dispose();
    }
  },
  15000,
);
