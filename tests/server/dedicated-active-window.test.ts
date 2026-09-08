import { describe, expect, it } from 'vitest';
import { dedicatedActiveWindow } from '../../packages/game-core/src/server/dedicated/dedicated-active-window';

describe('服务端自行决定活动窗口', () => {
  it('默认与 medium 客户端原活动范围一致，并按离玩家远近有序加载', () => {
    const keys = dedicatedActiveWindow({ x: 0.5, z: 0.5 }, 2);
    expect(keys).toHaveLength(50);
    expect(keys.slice(0, 2)).toEqual(['0,0,0', '0,1,0']);
    expect(keys).toContain('-2,0,-2');
    expect(keys).not.toContain('3,0,0');
  });
  it('负坐标跨 Chunk 和最大 high 范围保持确定且有界', () => {
    const keys = dedicatedActiveWindow({ x: -0.5, z: 32 }, 3);
    expect(keys).toHaveLength(98);
    expect(keys.slice(0, 2)).toEqual(['-1,0,1', '-1,1,1']);
    expect(() => dedicatedActiveWindow({ x: Infinity, z: 0 }, 2)).toThrow();
    expect(() => dedicatedActiveWindow({ x: 0, z: 0 }, 4)).toThrow();
  });
});
