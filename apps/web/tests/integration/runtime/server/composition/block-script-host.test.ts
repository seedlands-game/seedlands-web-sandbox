import { expect, it } from 'vitest';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { assembleOverworldPacks } from '@seedlands/stdlib/host';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { Voxel } from '../../../../../../../packages/stdlib/src/world/voxel';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const SCRIPT_SUBJECT = 'test:miner-script';

const createComposition = () =>
  assembleOverworldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);

async function setup(allowBlock: boolean, principalId = 'script-miner') {
  const session = await HeadlessSession.create({
    seedText: 'block-script-host',
    platform: testCorePlatform,
    createComposition,
    worldHarness: {
      principalId,
      authorization: {
        principals: [{ id: principalId, subject: SCRIPT_SUBJECT, kind: 'actor', boundEntityId: 'miner' }],
        rules: [
          { effect: 'allow', resources: ['world.checkpoint'], operations: ['export', 'restore'], scope: 'any' },
          { effect: 'allow', resources: ['world.action'], operations: ['execute', 'read'], scope: 'self' },
          { effect: 'allow', resources: ['world.interaction'], operations: ['execute'], scope: 'any' },
          { effect: 'allow', resources: ['seedlands.ruleset'], operations: ['read'], scope: 'any' },
          ...(allowBlock
            ? [
                {
                  effect: 'allow' as const,
                  resources: ['seedlands.block-actor'],
                  operations: ['read' as const, 'execute' as const],
                  scope: 'self' as const,
                },
                {
                  effect: 'allow' as const,
                  resources: ['seedlands.block-voxel'],
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
  const minerPosition: [number, number, number] = [Math.floor(x) + 0.5, Math.floor(y) + 3, Math.floor(z) + 0.5];
  const placePosition: [number, number, number] = [Math.floor(x) + 2, Math.floor(y) + 3, Math.floor(z)];
  const breakPosition: [number, number, number] = [Math.floor(x) + 2, Math.floor(y) + 3, Math.floor(z) + 1];
  session.runtime.server.spawnPlayer({ id: 'miner', position: minerPosition });
  session.runtime.server.editBatch({
    actorId: 'fixture',
    edits: [
      { x: placePosition[0], y: placePosition[1], z: placePosition[2], value: Voxel.Air },
      { x: breakPosition[0], y: breakPosition[1], z: breakPosition[2], value: Voxel.Wood },
    ],
  });
  session.runtime.server.giveItem('miner', { itemId: 'wood-block', count: 2 });
  return { session, placePosition, breakPosition };
}

const snapshot = (session: HeadlessSession) => session.runtime.server.freezePortableSaveSnapshot();

it('retains the actual script principal through place, break, and cancel commands', async () => {
  const { session, placePosition, breakPosition } = await setup(true);
  try {
    expect(await session.world.command({ type: 'place-voxel', position: placePosition })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    expect(session.runtime.server.getVoxel(...placePosition)).toBe(Voxel.Wood);
    expect(session.runtime.server.getInventory('miner').slots[0]).toEqual({ itemId: 'wood-block', count: 1 });

    expect(await session.world.command({ type: 'break-voxel', position: breakPosition })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    expect(session.runtime.server.getPlayerState('miner').breakAction).toMatchObject({
      position: breakPosition,
      origin: { principalSubject: SCRIPT_SUBJECT, originalActor: { entityId: 'miner' } },
    });

    expect(await session.world.command({ type: 'cancel-break' })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    expect(session.runtime.server.getPlayerState('miner').breakAction).toBeNull();
    expect(session.runtime.server.getVoxel(...breakPosition)).toBe(Voxel.Wood);
  } finally {
    await session.dispose();
  }
}, 15000);

it('leaves voxel, inventory, and break owners unchanged when the script has no Block grants', async () => {
  const { session, placePosition, breakPosition } = await setup(false);
  try {
    const beforePlace = snapshot(session);
    const place = await session.world.command({ type: 'place-voxel', position: placePosition });
    expect(place.ok && place.data.success, JSON.stringify(place)).toBe(false);
    expect(snapshot(session)).toEqual(beforePlace);

    const beforeBreak = snapshot(session);
    const begin = await session.world.command({ type: 'break-voxel', position: breakPosition });
    expect(begin.ok && begin.data.success, JSON.stringify(begin)).toBe(false);
    expect(snapshot(session)).toEqual(beforeBreak);

    session.runtime.server.getPlayerState('miner').breakAction = {
      position: [...breakPosition],
      voxel: Voxel.Wood,
      elapsedSeconds: 0,
      requiredSeconds: 1.2,
    };
    const beforeCancel = snapshot(session);
    const cancel = await session.world.command({ type: 'cancel-break' });
    expect(cancel.ok && cancel.data.success, JSON.stringify(cancel)).toBe(false);
    expect(snapshot(session)).toEqual(beforeCancel);
  } finally {
    await session.dispose();
  }
}, 15000);

it.each([true, false])(
  'rebinds a saved script break under a new alias only while current Block policy allows it (%s)',
  async (allowBlock) => {
    const source = await setup(true);
    const target = await setup(allowBlock, 'restored-miner-script');
    try {
      expect(await source.session.world.command({ type: 'break-voxel', position: source.breakPosition })).toMatchObject(
        {
          ok: true,
          data: { success: true },
        },
      );
      source.session.runtime.server.advanceGameplayRules(0.4);
      const saved = await source.session.world.checkpoint({ kind: 'export' });
      if (!saved.ok) throw new Error(saved.error.message);

      expect(await target.session.world.checkpoint({ kind: 'restore', snapshot: saved.data.snapshot })).toMatchObject({
        ok: true,
      });
      expect(target.session.runtime.server.getPlayerState('miner').breakAction).toMatchObject({
        origin: { principalSubject: SCRIPT_SUBJECT, originalActor: { entityId: 'miner' } },
      });

      const beforeDrops = target.session.runtime.server.queryEntities({ type: 'world-item' }).length;
      target.session.runtime.server.advanceGameplayRules(1.2);
      expect(target.session.runtime.server.getVoxel(...source.breakPosition)).toBe(allowBlock ? Voxel.Air : Voxel.Wood);
      expect(target.session.runtime.server.queryEntities({ type: 'world-item' })).toHaveLength(
        beforeDrops + Number(allowBlock),
      );
      expect(target.session.runtime.server.getPlayerState('miner').breakAction).toBeNull();

      target.session.runtime.server.advanceGameplayRules(1.2);
      expect(target.session.runtime.server.queryEntities({ type: 'world-item' })).toHaveLength(
        beforeDrops + Number(allowBlock),
      );
    } finally {
      await source.session.dispose();
      await target.session.dispose();
    }
  },
  20000,
);
