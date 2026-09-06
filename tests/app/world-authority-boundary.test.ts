import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('World 浏览器边界', () => {
  it('只消费注入的 Authority 与计算端口，不导入或创建 GameServer/Worker', async () => {
    const source = await readFile(new URL('../../src/app/world-runtime.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/from ['"]\.\.\/server\/game-server['"]/);
    expect(source).not.toContain('new Worker(');
    expect(source).toContain('WorldAuthorityPort');
    expect(source).toContain('meshWorker: MeshWorkerPort');
  });
});
