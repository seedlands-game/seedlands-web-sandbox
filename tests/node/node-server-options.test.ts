import { describe, expect, it } from 'vitest';
import { parseNodeServerOptions } from '../../src/node/server/node-server-options';

describe('Node 启动配置', () => {
  it('启动必须有显式存档目录，help 不创建世界', () => {
    expect(() => parseNodeServerOptions([])).toThrow('存档目录');
    expect(parseNodeServerOptions(['--help']).help).toBe(true);
    expect(parseNodeServerOptions(['--data-directory', '/tmp/world'])).toMatchObject({
      computeMode: 'worker-thread',
      seedText: 'seedlands',
    });
  });
  it('只接纳有界配置和已知计算模式', () => {
    expect(() => parseNodeServerOptions(['--compute', 'magic', '--data-directory', '/tmp/world'])).toThrow('计算模式');
    expect(() => parseNodeServerOptions(['--data-directory', '--seed', 'abc'])).toThrow('缺少值');
    expect(() => parseNodeServerOptions(['--data-directory', '/tmp/world', '--seed', 'x'.repeat(257)])).toThrow('长度');
  });
});
