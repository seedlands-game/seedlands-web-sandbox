import { expect, it } from 'vitest';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { assembleOverworldPacks } from '@seedlands/stdlib/host';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import type {
  AuthorityAction,
  AuthorityStationAction,
} from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import { GENERATOR_VERSION, Voxel } from '../../../../../../../packages/stdlib/src/world/voxel';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const createComposition = () =>
  assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: (pack.manifest.resources ?? []).map((path) => ({ path, digest: 'c'.repeat(64) })),
      },
    },
  ]);

it('Headless 玩家从有限原料到铁器、金钻石工具和建造，并保持储物与半程恢复', async () => {
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
    let remaining = seconds * 1000;
    while (remaining > 0) {
      const elapsedMs = Math.min(remaining, 60_000);
      const result = await session.world.clock({ kind: 'advance', elapsedMs });
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
      remaining -= elapsedMs;
    }
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
  const equip = async (itemId: string) => {
    if (slot(itemId) >= 9) await action({ type: 'move-inventory', source: slot(itemId), target: 8 });
    await action({ type: 'select-hotbar', slot: slot(itemId) });
  };
  const place = async (itemId: string, position: [number, number, number]) => {
    await equip(itemId);
    await action({ type: 'place', position });
  };
  const mine = async (x: number, voxel: number, tool?: string) => {
    await move([x + 0.5, 60, -1]);
    if (tool) await equip(tool);
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
    for (let x = -51; x <= 4; x++)
      for (let z = -2; z <= 2; z++) {
        edits.push({ x, y: 59, z, value: Voxel.Stone });
        for (let y = 60; y <= 63; y++) edits.push({ x, y, z, value: Voxel.Air });
      }
    for (let x = -2; x >= -9; x--) edits.push({ x, y: 60, z: 0, value: Voxel.Wood });
    for (let x = -10; x >= -20; x--) edits.push({ x, y: 60, z: 0, value: Voxel.Stone });
    edits.push({ x: -21, y: 60, z: 0, value: Voxel.CoalOre });
    edits.push({ x: -25, y: 60, z: 0, value: Voxel.Wood });
    edits.push({ x: -26, y: 60, z: 0, value: Voxel.Sand });
    edits.push({ x: -1, y: 60, z: 0, value: Voxel.Stone });
    for (let x = -27; x >= -38; x--) edits.push({ x, y: 60, z: 0, value: Voxel.DiamondOre });
    for (let x = -39; x >= -50; x--) edits.push({ x, y: 60, z: 0, value: Voxel.GoldOre });
    edits.push({ x: -51, y: 60, z: 0, value: Voxel.Stone });
    for (let x = -22; x >= -24; x--) edits.push({ x, y: 60, z: 0, value: Voxel.IronOre });
    expect(server().editBatch({ actorId: 'finite-resource-fixture', edits }).committed).toBe(true);
    expect(bag().filter(Boolean)).toEqual([]);
    for (let x = -2; x >= -9; x--) await mine(x, Voxel.Wood);
    for (let index = 0; index < 8; index++) await action({ type: 'craft', recipeId: 'planks' });
    await action({ type: 'craft', recipeId: 'sticks' });
    await action({ type: 'craft', recipeId: 'sticks' });
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
    await clock(5);
    expect(station('furnace').component).toMatchObject({ furnace: { progressSeconds: 5, output: null } });
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
    await clock(25);
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
    await mine(-25, Voxel.Wood);
    await mine(-26, Voxel.Sand);
    await mine(-1, Voxel.Stone, 'iron-pickaxe');
    await move([0.5, 60, 0.5]);
    for (const [input, output] of [
      ['wood-block', 'charcoal'],
      ['sand-block', 'glass'],
      ['cobblestone', 'stone-block'],
    ] as const) {
      await put('furnace', input, 0);
      await clock(10);
      expect(station('furnace').component).toMatchObject({
        furnace: { input: null, output: { itemId: output, count: 1 } },
      });
      await stationAction('furnace', {
        kind: 'transfer',
        from: 'station',
        actorSlot: bag().findIndex((entry) => entry === null),
        stationSlot: 2,
        count: 1,
      });
      expect(bag()[slot(output)]?.count).toBe(1);
    }
    await place('glass', [1, 60, 1]);
    const built = await session.world.checkpoint({ kind: 'export' });
    if (!built.ok || !built.data.snapshot) throw new Error('Missing material build save');
    expect(await session.world.checkpoint({ kind: 'restore', snapshot: built.data.snapshot })).toMatchObject({
      ok: true,
    });
    expect(server().getVoxel(1, 60, 1)).toBe(Voxel.Glass);
    expect(bag().filter((entry) => entry?.itemId === 'glass')).toEqual([]);
    const breakGlass = await action({ type: 'begin-break', position: [1, 60, 1] });
    await clock(breakGlass.requiredSeconds! + 0.1);
    expect(server().getVoxel(1, 60, 1)).toBe(Voxel.Air);
    expect(bag().some((entry) => entry?.itemId === 'glass')).toBe(false);
    await move([-26.5, 60, -1]);
    await equip('stone-pickaxe');
    const insufficient = bag().map((entry) => entry && { ...entry, instance: entry.instance && { ...entry.instance } });
    expect((await session.runtime.performAction({ type: 'begin-break', position: [-27, 60, 0] })).result).toMatchObject(
      { success: false },
    );
    expect(bag()).toEqual(
      insufficient.map((entry) => (entry?.instance ? entry : entry && { itemId: entry.itemId, count: entry.count })),
    );
    expect(server().getVoxel(-27, 60, 0)).toBe(Voxel.DiamondOre);
    for (let x = -27; x >= -38; x--) await mine(x, Voxel.DiamondOre, 'iron-pickaxe');
    for (let x = -39; x >= -50; x--) await mine(x, Voxel.GoldOre, 'iron-pickaxe');
    await move([0.5, 60, 0.5]);
    await action({ type: 'craft', recipeId: 'sticks' });
    await craftAtBench('diamond-pickaxe');
    expect(bag()[slot('diamond-pickaxe')]?.instance?.durability).toBe(1561);
    await action({ type: 'craft', recipeId: 'diamond-block' });
    await put('furnace', 'gold-ore', 0, 12);
    // The first coal has 20 seconds left after the earlier six smelts.
    await put('furnace', 'charcoal', 1);
    await clock(100);
    expect(station('furnace').component).toMatchObject({
      furnace: { input: { itemId: 'gold-ore', count: 2 }, output: { itemId: 'gold-ingot', count: 10 } },
    });
    await put('furnace', 'plank', 1, 2);
    await clock(20);
    await stationAction('furnace', {
      kind: 'transfer',
      from: 'station',
      actorSlot: bag().findIndex((entry) => entry === null),
      stationSlot: 2,
      count: 12,
    });
    await craftAtBench('gold-pickaxe');
    await action({ type: 'craft', recipeId: 'gold-block' });
    await place('diamond-block', [-1, 60, 0]);
    await place('gold-block', [-2, 60, 0]);
    await equip('gold-pickaxe');
    expect((await session.runtime.performAction({ type: 'begin-break', position: [-1, 60, 0] })).result).toMatchObject({
      success: false,
    });
    expect(bag()[slot('gold-pickaxe')]?.instance?.durability).toBe(32);
    await mine(-51, Voxel.Stone, 'diamond-pickaxe');
    expect(bag()[slot('diamond-pickaxe')]?.instance?.durability).toBe(1560);
    await move([0.5, 60, 0.5]);
    const preciousSave = await session.world.checkpoint({ kind: 'export' });
    if (!preciousSave.ok || !preciousSave.data.snapshot) throw new Error('Missing precious-material save');
    expect(await session.world.checkpoint({ kind: 'restore', snapshot: preciousSave.data.snapshot })).toMatchObject({
      ok: true,
    });
    expect(server().generatorVersion).toBe(GENERATOR_VERSION);
    expect(bag()[slot('diamond-pickaxe')]?.instance?.durability).toBe(1560);
    expect(server().getVoxel(-1, 60, 0)).toBe(Voxel.DiamondBlock);
    expect(server().getVoxel(-2, 60, 0)).toBe(Voxel.GoldBlock);
    await mine(-1, Voxel.DiamondBlock, 'diamond-pickaxe');
    await mine(-2, Voxel.GoldBlock, 'diamond-pickaxe');
    await action({ type: 'craft', recipeId: 'diamond-block-unpack' });
    await action({ type: 'craft', recipeId: 'gold-block-unpack' });
    expect(bag()[slot('diamond')]?.count).toBe(9);
    expect(bag()[slot('gold-ingot')]?.count).toBe(9);
  } finally {
    session.dispose();
  }
}, 120_000);
