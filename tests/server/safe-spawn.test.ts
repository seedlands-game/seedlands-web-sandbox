import { describe, expect, it } from 'vitest';
import { findSafePlayerSpawn } from '../../src/server/gameplay/safe-spawn';
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
    const server = new GameServer({ seedText });
    const position = findSafePlayerSpawn((x, y, z) => server.getVoxel(x, y, z));
    expect(position).not.toBeNull();
    expect(server.worldRevision).toBe(0);
  });
  it('高于旧出生点的山地也站在地表上方', () => {
    expect(findSafePlayerSpawn((_x, y) => (y <= 70 ? Voxel.Stone : Voxel.Air))).toEqual([0.5, 71, 0.5]);
  });
  it('跳过水域、树冠和头部空间不足，固定顺序可重复', () => {
    const voxel = (x: number, y: number, z: number) => {
      if (x === 0 && z === 0) return y <= 12 ? Voxel.Water : Voxel.Air;
      if (x === 0 && z === -4) return y === 13 ? Voxel.Leaves : y <= 10 ? Voxel.Dirt : Voxel.Air;
      return y <= 10 ? Voxel.Grass : Voxel.Air;
    };
    const first = findSafePlayerSpawn(voxel);
    expect(first).not.toBeNull();
    expect(first).not.toEqual([0.5, 14.6, 0.5]);
    expect(findSafePlayerSpawn(voxel)).toEqual(first);
    const [x, y, z] = first!;
    expect(voxel(Math.floor(x), Math.floor(y), Math.floor(z))).toBe(Voxel.Air);
    expect(voxel(Math.floor(x), Math.floor(y) - 1, Math.floor(z))).toBe(Voxel.Grass);
  });
  it('全水、全实心、无地面都显式不可用', () => {
    for (const voxel of [Voxel.Water, Voxel.Stone, Voxel.Air]) expect(findSafePlayerSpawn(() => voxel)).toBeNull();
  });
});
