import { expect, it } from 'vitest';
import { HeadlessSession } from '../../../packages/game-core/src/server/headless/headless-session';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import type {
  AuthorityAction,
  AuthorityStationAction,
} from '../../../packages/game-core/src/compute/authority-worker-protocol';
import { Voxel } from '../../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../../support/core-platform';

const createComposition = () =>
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
  ]);

it('Headless 玩家从有限原料采集，经工作台、石镐、冶炼到铁镐，并保持储物与半程恢复', async () => {
  let session = await HeadlessSession.create({
    seedText: 'overworld-progression-journey',
    platform: testCorePlatform,
    createComposition,
  });
  const actorId = session.runtime.playerId;
  const server = () => session.runtime.server;
  const bag = () => server().getInventory(actorId).slots;
  const slot = (id: string) => {
    const index = bag().findIndex((item) => item?.itemId === id);
    if (index < 0) throw new Error(`Missing acquired item ${id}`);
    return index;
  };
  const action = async (value: AuthorityAction) => {
    const response = await session.runtime.performAction(value);
    expect(response.result, JSON.stringify(value)).toMatchObject({ success: true });
    return response.result as { success: true; requiredSeconds?: number };
  };
  const clock = async (seconds: number) => {
    const result = await session.world.clock({ kind: 'advance', elapsedMs: seconds * 1000 });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  };
  const move = async (position: [number, number, number]) => {
    session.runtime.setPlayerPosition(position);
    await clock(0.05);
  };
  const station = (kind: 'workbench' | 'furnace' | 'chest') => {
    const current = session.runtime.view().nearbyStations?.find((entry) => entry.component.kind === kind);
    if (!current) throw new Error(`Missing reachable station ${kind}`);
    return current;
  };
  const stationAction = async (
    kind: 'workbench' | 'furnace' | 'chest',
    value:
      | Omit<Extract<AuthorityStationAction, { kind: 'transfer' }>, 'type' | 'reference' | 'expectedStationRevision'>
      | { kind: 'craft'; recipeId: string },
  ) => {
    const current = station(kind);
    await action({
      type: 'station',
      reference: current.reference,
      expectedStationRevision: current.component.revision,
      ...value,
    });
  };
  const put = async (kind: 'workbench' | 'furnace' | 'chest', itemId: string, stationSlot: number, count = 1) =>
    stationAction(kind, { kind: 'transfer', from: 'actor', actorSlot: slot(itemId), stationSlot, count });
  const craftAtBench = async (recipeId: string) => {
    const recipe = session.runtime.view().stationRecipes!.find((entry) => entry.id === recipeId)!;
    if (recipe.kind !== 'shaped') throw new Error('Expected shaped recipe');
    for (let index = 0; index < recipe.pattern.length; index++) {
      const input = recipe.pattern[index];
      if (input) await put('workbench', input.itemId, index, input.count);
    }
    await stationAction('workbench', { kind: 'craft', recipeId });
  };
  const place = async (itemId: string, position: [number, number, number]) => {
    await action({ type: 'select-hotbar', slot: slot(itemId) });
    await action({ type: 'place', position });
  };
  const mine = async (x: number, voxel: number, tool?: string) => {
    await move([x + 0.5, 60, -1]);
    if (tool) await action({ type: 'select-hotbar', slot: slot(tool) });
    expect(server().getVoxel(x, 60, 0)).toBe(voxel);
    const result = await action({ type: 'begin-break', position: [x, 60, 0] });
    await clock(result.requiredSeconds! + 0.1);
    expect(server().getVoxel(x, 60, 0)).toBe(Voxel.Air);
    await move([x + 0.5, 60, 0.5]);
    await clock(0.3);
  };
  try {
    await session.world.clock({ kind: 'pause' });
    await session.world.logic({ kind: 'mode', mode: 'scripted' });
    const edits = [];
    for (let x = -26; x <= 4; x++)
      for (let z = -2; z <= 2; z++) {
        edits.push({ x, y: 59, z, value: Voxel.Stone });
        for (let y = 60; y <= 63; y++) edits.push({ x, y, z, value: Voxel.Air });
      }
    for (let x = -2; x >= -9; x--) edits.push({ x, y: 60, z: 0, value: Voxel.Wood });
    for (let x = -10; x >= -20; x--) edits.push({ x, y: 60, z: 0, value: Voxel.Stone });
    edits.push({ x: -21, y: 60, z: 0, value: Voxel.CoalOre });
    for (let x = -22; x >= -24; x--) edits.push({ x, y: 60, z: 0, value: Voxel.IronOre });
    expect(server().editBatch({ actorId: 'finite-resource-fixture', edits }).committed).toBe(true);
    expect(bag().filter(Boolean)).toEqual([]);
    for (let x = -2; x >= -9; x--) await mine(x, Voxel.Wood);
    for (let index = 0; index < 8; index++) await action({ type: 'craft', recipeId: 'planks' });
    await action({ type: 'craft', recipeId: 'workbench' });
    await move([0.5, 60, 0.5]);
    await place('workbench', [2, 60, 0]);
    await craftAtBench('wood-pickaxe');
    expect(bag()[slot('wood-pickaxe')]?.instance?.durability).toBe(60);
    for (let x = -10; x >= -12; x--) await mine(x, Voxel.Stone, 'wood-pickaxe');
    expect(bag()[slot('wood-pickaxe')]?.instance?.durability).toBe(57);
    await move([0.5, 60, 0.5]);
    await craftAtBench('stone-pickaxe');
    for (let x = -13; x >= -20; x--) await mine(x, Voxel.Stone, 'stone-pickaxe');
    await mine(-21, Voxel.CoalOre, 'stone-pickaxe');
    for (let x = -22; x >= -24; x--) await mine(x, Voxel.IronOre, 'stone-pickaxe');
    await move([0.5, 60, 0.5]);
    await craftAtBench('furnace');
    await craftAtBench('chest');
    await place('furnace', [2, 60, 1]);
    await place('chest', [2, 60, -1]);
    await put('furnace', 'raw-iron', 0, 3);
    await put('furnace', 'coal', 1);
    await clock(2.5);
    expect(station('furnace').component).toMatchObject({ furnace: { progressSeconds: 2.5, output: null } });
    const saved = await session.world.checkpoint({ kind: 'export' });
    if (!saved.ok || !saved.data.snapshot) throw new Error('Checkpoint export failed');
    const before = session;
    session = await HeadlessSession.create({
      seedText: 'restore-target',
      platform: testCorePlatform,
      createComposition,
    });
    expect(await session.world.checkpoint({ kind: 'restore', snapshot: saved.data.snapshot })).toMatchObject({
      ok: true,
    });
    before.dispose();
    await clock(12.5);
    expect(station('furnace').component).toMatchObject({
      furnace: { input: null, output: { itemId: 'iron-ingot', count: 3 } },
    });
    await stationAction('furnace', {
      kind: 'transfer',
      from: 'station',
      actorSlot: bag().findIndex((entry) => entry === null),
      stationSlot: 2,
      count: 3,
    });
    await craftAtBench('iron-pickaxe');
    expect(bag()[slot('iron-pickaxe')]).toEqual({ itemId: 'iron-pickaxe', count: 1, instance: { durability: 250 } });
    await put('chest', 'wood-pickaxe', 0);
    expect(station('chest').component).toMatchObject({
      slots: [
        expect.objectContaining({ itemId: 'wood-pickaxe', instance: { durability: 57 } }),
        ...Array(23).fill(null),
      ],
    });
    expect(bag().filter((entry) => entry?.itemId === 'iron-ingot')).toEqual([]);
  } finally {
    session.dispose();
  }
}, 120_000);
