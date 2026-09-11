import { expect, it } from 'vitest';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { assembleOverworldPacks } from '@seedlands/stdlib/host';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

it('两日正常采集建造、树叶再生食物、庇护阻挡普通 NPC 攻击，开门死亡后可复活拾回', async () => {
  const session = await HeadlessSession.create({
    seedText: 'overworld-two-day-shelter',
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
  });
  const server = session.runtime.server,
    playerId = session.runtime.playerId;
  const advance = async (seconds: number) => {
    const result = await session.world.clock({ kind: 'advance', elapsedMs: seconds * 1000 });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  };
  const move = async (position: [number, number, number]) => {
    session.runtime.setPlayerPosition(position);
    await advance(0.1);
  };
  const mine = async (position: [number, number, number]) => {
    expect((await session.runtime.performAction({ type: 'begin-break', position })).result).toMatchObject({
      success: true,
    });
    await advance(1.3);
    expect(server.getVoxel(...position)).toBe(0);
  };
  try {
    await session.world.clock({ kind: 'pause' });
    await session.world.logic({ kind: 'mode', mode: 'scripted' });
    const edits = [];
    for (let x = -27; x <= 3; x++)
      for (let z = -3; z <= 4; z++) {
        edits.push({ x, y: 59, z, value: 3 });
        for (let y = 60; y <= 64; y++) edits.push({ x, y, z, value: 0 });
      }
    for (let x = -2; x >= -26; x--) edits.push({ x, y: 60, z: 0, value: 4 });
    edits.push({ x: 0, y: 62, z: 0, value: 5 });
    expect(server.editBatch({ actorId: 'finite-wood-and-canopy-fixture', edits }).committed).toBe(true);
    for (let x = -2; x >= -26; x--) {
      await move([x + 0.5, 60, -1]);
      await mine([x, 60, 0]);
      await move([x + 0.5, 60, 0.5]);
      await advance(0.3);
    }
    expect(server.getInventory(playerId).slots[0]).toEqual({ itemId: 'wood-block', count: 25 });
    await move([0.5, 60, 0.5]);
    const shelter: [number, number, number][] = [];
    for (const y of [60, 61, 62])
      for (let x = -1; x <= 1; x++)
        for (let z = -1; z <= 1; z++) {
          if (x !== 0 || z !== 0) shelter.push([x, y, z]);
        }
    for (const position of shelter)
      expect(
        (await session.runtime.performAction({ type: 'place', position })).result,
        position.join(','),
      ).toMatchObject({ success: true });
    expect(server.getInventory(playerId).slots[0]).toEqual({ itemId: 'wood-block', count: 1 });
    const hunter = server.spawnAutonomousActor({
      id: 'shelter-hunter',
      archetype: 'night-stalker',
      position: [0.5, 60, 2.1],
    });
    let wraps = 0,
      previous = server.worldTime,
      blockedAtNight = 0;
    const phases = new Set<string>();
    for (let period = 0; period < 20; period++) {
      await advance(60);
      const time = server.worldTime;
      if (time < previous) wraps++;
      previous = time;
      phases.add(time >= 6 && time < 18 ? 'day' : 'night');
      if (time < 6 || time >= 18) {
        expect(server.applyActorAuthorityAction(hunter.id, { type: 'attack', targetId: playerId })).toMatchObject({
          accepted: false,
        });
        blockedAtNight++;
      }
      expect(server.getPlayerState(playerId).lifecycle).toBe('alive');
      expect(server.getEntity(playerId)?.health).toBe(20);
    }
    expect(wraps).toBe(2);
    expect([...phases].sort()).toEqual(['day', 'night']);
    expect(blockedAtNight).toBeGreaterThan(0);
    expect(server.getVoxel(0, 62, 0)).toBe(5);
    const berries = server.getInventory(playerId).slots.findIndex((slot) => slot?.itemId === 'berry');
    expect(berries).toBeGreaterThanOrEqual(0);
    const hunger = server.getPlayerState(playerId).hunger;
    expect((await session.runtime.performAction({ type: 'use-inventory', slot: berries })).result).toMatchObject({
      success: true,
    });
    expect(server.getPlayerState(playerId).hunger).toBeGreaterThan(hunger);
    await mine([0, 60, 1]);
    await mine([0, 61, 1]);
    let hits = 0;
    for (let attempt = 0; attempt < 20 && server.getPlayerState(playerId).lifecycle === 'alive'; attempt++) {
      const attack = server.applyActorAuthorityAction(hunter.id, { type: 'attack', targetId: playerId });
      if (attack.accepted) hits++;
      await advance(1.5);
    }
    expect(hits).toBeGreaterThan(0);
    expect(server.getPlayerState(playerId).lifecycle).toBe('dead');
    expect(server.getInventory(playerId).slots.every((slot) => slot === null)).toBe(true);
    expect(server.queryEntities({ type: 'world-item' }).some((entity) => entity.stack?.itemId === 'berry')).toBe(true);
    expect((await session.runtime.performAction({ type: 'respawn' })).result).toMatchObject({ success: true });
    await move([0.5, 60, 0.5]);
    await advance(0.5);
    expect(server.getPlayerState(playerId).lifecycle).toBe('alive');
    expect(server.getInventory(playerId).slots.some((slot) => slot?.itemId === 'berry')).toBe(true);
  } finally {
    await session.dispose();
  }
}, 360000);
