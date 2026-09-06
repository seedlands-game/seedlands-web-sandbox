import { describe, expect, it } from 'vitest';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import type {
  GameplaySnapshotV1,
  GameplaySnapshotV2,
  GameplaySnapshotV3,
} from '../../src/server/gameplay/gameplay-snapshot';
import { legacyPlayerPositionToFeet } from '../../src/server/gameplay/gameplay-snapshot';
import { ItemIds } from '../../src/server/gameplay/item-registry';

const callbacks = {
  getVoxel: () => 0,
  editVoxel: () => ({ committed: false }) as never,
  getWorldTime: () => 9,
};

const createCurrentRuntime = () => {
  const runtime = new GameplayRuntime(callbacks);
  runtime.spawnPlayer({ id: 'player', position: [1, 38.4, -2] });
  runtime.spawnWorldItem([4, 39.8, -2], { itemId: ItemIds.StoneBlock, count: 2 });
  runtime.spawnAutonomous(
    {
      id: 'settler',
      type: 'npc',
      archetype: 'settler',
      position: [6, 39, -2],
      maxHealth: 20,
      health: 20,
    },
    { archetype: 'settler' },
  );
  return runtime;
};

const legacyPosition = (type: string, position: [number, number, number]): [number, number, number] => [
  position[0],
  position[1] + (type === 'player' ? 1.6 : type === 'world-item' ? 0.2 : 0),
  position[2],
];

const asV2 = (current: GameplaySnapshotV3): GameplaySnapshotV2 => {
  return {
    version: 2,
    revision: current.revision,
    gameplayTime: current.gameplayTime,
    worldTime: current.worldTime,
    entitySequence: current.entitySequence,
    simulation: structuredClone(current.simulation),
    entities: current.entities.map((entity) => ({
      ...entity,
      position: legacyPosition(entity.type, entity.position),
    })),
    players: current.players.map((player) => ({
      ...player,
      spawnPosition: legacyPosition('player', player.spawnPosition),
    })),
  };
};

const asV1 = (current: GameplaySnapshotV3): GameplaySnapshotV1 => {
  const v2 = asV2(current);
  return {
    version: 1,
    revision: v2.revision,
    gameplayTime: v2.gameplayTime,
    entitySequence: v2.entitySequence,
    entities: v2.entities.filter((entity) => entity.type !== 'creature' && entity.type !== 'npc'),
    players: v2.players,
  };
};

describe('GameplaySnapshot V3 坐标与物理迁移', () => {
  it('为最早的独立玩家位置记录提供同一眼睛到脚底适配', () => {
    expect(legacyPlayerPositionToFeet([4, 42, 8])).toEqual([4, 40.4, 8]);
    expect(() => legacyPlayerPositionToFeet([4, Number.POSITIVE_INFINITY, 8])).toThrow(/finite/i);
  });

  it('新快照只写 V3，并携带明确的脚底坐标和物理 schema', () => {
    const snapshot = createCurrentRuntime().createSnapshot();

    expect(snapshot).toMatchObject({
      version: 3,
      coordinateSchema: { version: 1, units: 'voxel', entityOrigin: 'body-feet-center' },
      physicsSchema: { version: 1, bodyRegistryVersion: 1 },
    });
    expect(snapshot.entities.find((entity) => entity.id === 'player')?.position).toEqual([1, 38.4, -2]);
    expect(snapshot.entities.find((entity) => entity.id === 'world-item-1')?.position).toEqual([4, 39.8, -2]);
  });

  it.each([
    ['V1', (snapshot: GameplaySnapshotV3) => asV1(snapshot), 1],
    ['V2', (snapshot: GameplaySnapshotV3) => asV2(snapshot), 2],
  ] as const)('迁移%s一次：玩家/出生点从眼睛转脚底、物品从中心转脚底、actor 保持', (_label, legacy, version) => {
    const current = createCurrentRuntime().createSnapshot();
    const raw = legacy(current);
    const untouched = structuredClone(raw);
    const restored = new GameplayRuntime(callbacks);

    expect(restored.restoreSnapshot(raw)).toMatchObject({ version });

    expect(restored.getEntity('player')?.position).toEqual([1, 38.4, -2]);
    expect(restored.getPlayerState('player').spawnPosition).toEqual([1, 38.4, -2]);
    expect(restored.getEntity('world-item-1')?.position).toEqual([4, 39.8, -2]);
    if (version === 2) expect(restored.getEntity('settler')?.position).toEqual([6, 39, -2]);
    expect(raw).toEqual(untouched);

    const migrated = restored.createSnapshot();
    const roundTrip = new GameplayRuntime(callbacks);
    expect(roundTrip.restoreSnapshot(migrated)).toEqual({ version: 3, worldTime: 9 });
    expect(roundTrip.getEntity('player')?.position).toEqual([1, 38.4, -2]);
    expect(roundTrip.getEntity('world-item-1')?.position).toEqual([4, 39.8, -2]);
  });

  it.each([1, 2] as const)('把 V%s 普通 creature 迁移为具名 grazer 身体且不注册旧自治循环', (version) => {
    const current = createCurrentRuntime().createSnapshot();
    const legacy = version === 1 ? asV1(current) : asV2(current);
    legacy.entities.push({
      id: 'legacy-creature',
      type: 'creature',
      kind: 'creature',
      lifecycle: 'active',
      position: [8, 39, -2],
      physicsVelocity: [0, 0, 0],
      health: 12,
      maxHealth: 12,
    });
    const restored = new GameplayRuntime(callbacks);

    expect(restored.restoreSnapshot(legacy)).toMatchObject({ version });
    expect(restored.getEntity('legacy-creature')).toMatchObject({ archetype: 'grazer' });
    expect(restored.simulation.snapshot().actors).not.toContainEqual(
      expect.objectContaining({ entityId: 'legacy-creature' }),
    );
  });

  it('合法 V3 往返不二次迁移，并保留速度、simulation 和玩家状态', () => {
    const source = createCurrentRuntime();
    source.updateEntity('world-item-1', { physicsVelocity: [1, -2, 0.5] });
    source.giveItem('player', { itemId: ItemIds.Berry, count: 3 });
    source.setHungerForDebug('player', 12);
    const snapshot = source.createSnapshot();
    const restored = new GameplayRuntime(callbacks);

    expect(restored.restoreSnapshot(snapshot)).toEqual({ version: 3, worldTime: 9 });
    expect(restored.createSnapshot()).toEqual(snapshot);
  });

  it('无效 V3 与恶意数值会原子拒绝，不覆盖现有运行态', () => {
    const runtime = createCurrentRuntime();
    const before = runtime.createSnapshot();
    const unsupported = structuredClone(before) as unknown as {
      physicsSchema: { version: number; bodyRegistryVersion: number };
    };
    unsupported.physicsSchema.version = 999;
    expect(() => runtime.restoreSnapshot(unsupported)).toThrow(/physics schema/i);
    expect(runtime.createSnapshot()).toEqual(before);

    const invalidNumber = structuredClone(before);
    invalidNumber.entities[0].position[1] = Number.NaN;
    expect(() => runtime.restoreSnapshot(invalidNumber)).toThrow(/gameplay snapshot/i);
    expect(runtime.createSnapshot()).toEqual(before);
  });
});
