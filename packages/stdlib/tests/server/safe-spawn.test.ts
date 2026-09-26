import { testWorldgenExecutableProvider } from '../support/worldgen';
import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { countOpenSpawnDirections, findSafePlayerSpawn } from '../../src/server/gameplay/safe-spawn';
import { GameServer } from '../../src/server/game-server';
import { Voxel } from '../../src/world/voxel';

describe('确定性安全出生', () => {
  it.each([
    'living-world-autonomy',
    'seedlands-shell-journey',
    'seedlands-regression',
    'seedlands-mvp-river',
    'seedlands-mvp-highland',
  ])('实际种子 %s 可找到不改地形的干燥落点', (seedText) => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText,
      generatorVersion: 10,
    });
    const position = findSafePlayerSpawn((x, y, z) => server.getVoxel(x, y, z), 10);
    expect(position).not.toBeNull();
    expect(server.worldRevision).toBe(0);
  });
  it('高于旧出生点的山地也站在地表上方', () => {
    expect(findSafePlayerSpawn((_x, y) => (y <= 70 ? Voxel.Stone : Voxel.Air), 10)).toEqual([0.5, 71, 0.5]);
  });
  it('v2-v10 跳过水域、树冠和头部空间不足，保留首个安全列顺序', () => {
    const voxel = (x: number, y: number, z: number) => {
      if (x === 0 && z === 0) return y <= 12 ? Voxel.Water : Voxel.Air;
      if (x === 0 && z === -4) return y === 13 ? Voxel.Leaves : y <= 10 ? Voxel.Dirt : Voxel.Air;
      return y <= 10 ? Voxel.Grass : Voxel.Air;
    };
    const first = findSafePlayerSpawn(voxel, 10);
    expect(first).toEqual([-3.5, 11, -3.5]);
    const [x, y, z] = first!;
    expect(voxel(Math.floor(x), Math.floor(y), Math.floor(z))).toBe(Voxel.Air);
    expect(voxel(Math.floor(x), Math.floor(y) - 1, Math.floor(z))).toBe(Voxel.Grass);
  });
  it('v11 从相同固定候选中优先选择具有六格开阔方向的出生点', () => {
    const voxel = (x: number, y: number, z: number) => {
      if (y <= 10) return Voxel.Grass;
      if (y === 11 && Math.max(Math.abs(x), Math.abs(z)) === 1) return Voxel.Leaves;
      return Voxel.Air;
    };

    expect(findSafePlayerSpawn(voxel, 10)).toEqual([0.5, 11, 0.5]);
    const v11 = findSafePlayerSpawn(voxel, 11);
    expect(v11).not.toBeNull();
    expect(v11).not.toEqual([0.5, 11, 0.5]);
    expect(Math.max(Math.abs(Math.floor(v11![0])), Math.abs(Math.floor(v11![2])))).toBeGreaterThanOrEqual(4);
  });
  it('v11 避开近树，并以距离和坐标稳定打破完全相同的分数', () => {
    const voxel = (x: number, y: number, z: number) => {
      if (y <= 10) return Voxel.Grass;
      if (x === 0 && z === 0 && y === 11) return Voxel.Wood;
      return Voxel.Air;
    };

    expect(findSafePlayerSpawn(voxel, 11)).toEqual([-7.5, 11, 0.5]);
  });
  it('v11 对同一只读世界重复选择同一个安全出生点', () => {
    const voxel = (x: number, y: number, z: number) => {
      if (y <= 10) return Voxel.Grass;
      if ((x + z) % 8 === 0 && y === 11) return Voxel.Wood;
      if ((x - z) % 12 === 0 && y === 13) return Voxel.Leaves;
      return Voxel.Air;
    };

    const first = findSafePlayerSpawn(voxel, 11);
    expect(first).not.toBeNull();
    for (let iteration = 0; iteration < 8; iteration += 1) expect(findSafePlayerSpawn(voxel, 11)).toEqual(first);
  });
  it('v11 在近区存在安全点时把精细评分读取限制在半径 24 内', () => {
    let maximumHorizontalCoordinate = 0;
    const voxel = (x: number, y: number, z: number) => {
      maximumHorizontalCoordinate = Math.max(maximumHorizontalCoordinate, Math.abs(x), Math.abs(z));
      return y <= 10 ? Voxel.Grass : Voxel.Air;
    };

    expect(findSafePlayerSpawn(voxel, 11)).not.toBeNull();
    expect(maximumHorizontalCoordinate).toBeLessThanOrEqual(24);
  });
  it('v11 把非碰撞植物和逐格一级台阶计为可走通路', () => {
    const voxel = (x: number, y: number, z: number) => {
      const groundY = x > 0 ? Math.min(12, 10 + x) : 10;
      if (y <= groundY) return Voxel.Grass;
      if (x > 0 && x <= 6 && z === 0 && y === groundY + 1) return Voxel.TallGrass;
      if (Math.max(Math.abs(x), Math.abs(z)) === 1 && !(x === 1 && z === 0) && y === 11) return Voxel.Leaves;
      return Voxel.Air;
    };

    expect(countOpenSpawnDirections(voxel, 0, 10, 0)).toBe(3);
  });
  it('v11 近区完全不可用时仍按固定顺序在远区找到安全兜底', () => {
    const voxel = (x: number, y: number, z: number) =>
      Math.max(Math.abs(x), Math.abs(z)) <= 16 ? Voxel.Water : y <= 10 ? Voxel.Grass : Voxel.Air;

    expect(findSafePlayerSpawn(voxel, 11)).toEqual([-19.5, 11, -19.5]);
  });
  it('全水、全实心、无地面都显式不可用', () => {
    for (const voxel of [Voxel.Water, Voxel.Stone, Voxel.Air]) {
      expect(findSafePlayerSpawn(() => voxel, 10)).toBeNull();
      expect(findSafePlayerSpawn(() => voxel, 11)).toBeNull();
    }
  });
});
