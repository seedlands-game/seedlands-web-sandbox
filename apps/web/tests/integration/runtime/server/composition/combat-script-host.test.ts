import { expect, it } from 'vitest';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { assembleOverworldPacks } from '@seedlands/stdlib/host';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const createComposition = () =>
  assembleOverworldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
async function setup(allowCombat: boolean, principalId = 'script-hunter', allowInventory = false) {
  const session = await HeadlessSession.create({
    seedText: 'combat-script-host',
    platform: testCorePlatform,
    createComposition,
    worldHarness: {
      principalId,
      authorization: {
        principals: [{ id: principalId, subject: 'test:hunter-script', kind: 'actor', boundEntityId: 'hunter' }],
        rules: [
          { effect: 'allow', resources: ['world.checkpoint'], operations: ['export', 'restore'], scope: 'any' },
          { effect: 'allow', resources: ['world.action'], operations: ['execute', 'read'], scope: 'self' },
          { effect: 'allow', resources: ['world.interaction'], operations: ['execute'], scope: 'any' },
          { effect: 'allow', resources: ['seedlands.ruleset'], operations: ['read'], scope: 'any' },
          ...(allowInventory
            ? [
                {
                  effect: 'allow' as const,
                  resources: ['seedlands.inventory'],
                  operations: ['read' as const, 'write' as const, 'execute' as const],
                  scope: 'self' as const,
                },
              ]
            : []),
          ...(allowCombat
            ? [
                {
                  effect: 'allow' as const,
                  resources: ['seedlands.combat'],
                  operations: ['execute' as const, 'read' as const],
                  scope: 'any' as const,
                },
              ]
            : []),
        ],
      },
    },
  });
  const [x, y, z] = session.runtime.server.getEntity(session.runtime.playerId)!.position;
  session.runtime.server.spawnAutonomousActor({ id: 'hunter', archetype: 'night-stalker', position: [x, y + 3, z] });
  session.runtime.server.spawnPlayer({ id: 'prey', position: [x, y + 3, z + 1] });
  return session;
}
it.each(['attack-entity', 'start-action'] as const)(
  'preserves the actual scripted principal through %s and resolves once',
  async (command) => {
    const session = await setup(true);
    try {
      const result = await session.world.command(
        command === 'attack-entity'
          ? { type: command, entityId: 'prey' }
          : { type: command, entityId: 'hunter', action: 'attack', targetEntityId: 'prey' },
      );
      expect(result.ok && result.data.success, JSON.stringify(result)).toBe(true);
      expect(
        session.runtime.server.simulationSnapshot().combat?.combatants.find((entry) => entry.actorId === 'hunter')
          ?.combat.active,
      ).toMatchObject({ origin: { principalSubject: 'test:hunter-script' } });
      const health = session.runtime.server.getEntity('prey')!.health!;
      session.runtime.server.advanceGameplayRules(0.3);
      expect(session.runtime.server.getEntity('prey')!.health).toBe(health - 2);
      session.runtime.server.advanceGameplayRules(0.05);
      expect(session.runtime.server.getEntity('prey')!.health).toBe(health - 2);
      expect(await session.world.actions({ entityId: 'hunter' })).toMatchObject({
        ok: true,
        data: { actions: [{ targetEntityId: 'prey' }] },
      });
    } finally {
      await session.dispose();
    }
  },
  15000,
);
it('does not let start-action borrow autonomy Combat permission from a script without Combat access', async () => {
  const session = await setup(false);
  try {
    const before = session.runtime.server.simulationSnapshot();
    const result = await session.world.command({
      type: 'start-action',
      entityId: 'hunter',
      action: 'attack',
      targetEntityId: 'prey',
    });
    expect(result.ok && result.data.success, JSON.stringify(result)).toBe(false);
    expect(session.runtime.server.simulationSnapshot()).toEqual(before);
  } finally {
    await session.dispose();
  }
}, 15000);

it.each([true, false])(
  'rebinds saved script Combat under a new alias only if current policy still allows it (%s)',
  async (allowCombat) => {
    const source = await setup(true);
    const target = await setup(allowCombat, 'restored-script');
    try {
      expect(await source.world.command({ type: 'attack-entity', entityId: 'prey' })).toMatchObject({
        ok: true,
        data: { success: true },
      });
      source.runtime.server.advanceGameplayRules(0.1);
      const saved = await source.world.checkpoint({ kind: 'export' });
      if (!saved.ok) throw new Error(saved.error.message);
      expect(await target.world.checkpoint({ kind: 'restore', snapshot: saved.data.snapshot })).toMatchObject({
        ok: true,
      });
      const health = target.runtime.server.getEntity('prey')!.health!;
      if (allowCombat)
        expect(target.runtime.server.getActorAction('hunter')).toMatchObject({
          status: 'running',
          targetEntityId: 'prey',
        });
      else expect(target.runtime.server.getActorAction('hunter')).toBeNull();
      target.runtime.server.advanceGameplayRules(0.2);
      expect(target.runtime.server.getEntity('prey')!.health).toBe(health - (allowCombat ? 2 : 0));
    } finally {
      await source.dispose();
      await target.dispose();
    }
  },
  20000,
);

it.each([false, true])(
  'uses the script binding for actual inventory crafting (allowed: %s)',
  async (allowed) => {
    const session = await setup(true, 'script-hunter', allowed);
    try {
      session.runtime.server.giveItem('hunter', { itemId: 'wood-block', count: 1 });
      const before = session.runtime.server.getInventory('hunter');
      const result = await session.world.command({ type: 'craft-recipe', recipeId: 'planks' });
      expect(result.ok && result.data.success, JSON.stringify(result)).toBe(allowed);
      if (allowed)
        expect(session.runtime.server.getInventory('hunter').slots[0]).toEqual({ itemId: 'plank', count: 4 });
      else expect(session.runtime.server.getInventory('hunter')).toEqual(before);
    } finally {
      await session.dispose();
    }
  },
  15000,
);
