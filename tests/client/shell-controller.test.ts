import { describe, expect, it, vi } from 'vitest';
import { ShellController, sanitizeQuality } from '../../apps/web/src/client/shell/shell-controller';

const port = () => ({
  start: vi.fn(async () => {}),
  startRemote: vi.fn(async () => {}),
  leave: vi.fn(async () => {}),
  pause: vi.fn(),
  abortStart: vi.fn(),
});

describe('游戏外壳异步状态', () => {
  it('进入期间不创建第二个世界，成功后才能游玩', async () => {
    const game = port();
    let resolve!: () => void;
    game.start.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const shell = new ShellController(game);
    const pending = shell.start('oak', 'medium');
    await shell.start('other', 'high');
    expect(game.start).toHaveBeenCalledTimes(1);
    expect(shell.state.phase).toBe('loading');
    resolve();
    await pending;
    expect(shell.state.phase).toBe('playing');
    expect(shell.state.seed).toBe('oak');
  });

  it('启动失败可重试，错误不是假成功', async () => {
    const game = port();
    game.start.mockRejectedValueOnce(new Error('磁盘不可用'));
    const shell = new ShellController(game);
    await shell.start('oak', 'medium');
    expect(shell.state.phase).toBe('menu');
    expect(shell.state.error).toContain('磁盘不可用');
    await shell.start('oak', 'medium');
    expect(shell.state.phase).toBe('playing');
    expect(shell.state.error).toBe('');
  });

  it('保存失败保留暂停世界，重试成功才显示菜单', async () => {
    const game = port();
    const shell = new ShellController(game);
    await shell.start('oak', 'medium');
    shell.pause();
    game.leave.mockRejectedValueOnce(new Error('存档空间不足'));
    await shell.leave();
    expect(shell.state.phase).toBe('paused');
    expect(shell.state.error).toContain('存档空间不足');
    await shell.leave();
    expect(shell.state.phase).toBe('menu');
  });

  it('暂停幂等，菜单不恢复模拟，画质非法值安全回退', async () => {
    const game = port();
    const shell = new ShellController(game);
    shell.resume();
    expect(game.pause).not.toHaveBeenCalled();
    await shell.start('oak', 'low');
    shell.pause();
    shell.pause();
    expect(game.pause).toHaveBeenCalledTimes(1);
    shell.resume();
    expect(game.pause).toHaveBeenLastCalledWith(false);
    expect(sanitizeQuality('extreme')).toBe('medium');
    expect(sanitizeQuality('high')).toBe('high');
  });

  it('运行时故障停止陈旧世界并保留可重试错误', async () => {
    const game = port();
    const shell = new ShellController(game);
    await shell.start('oak', 'medium');
    shell.fail(new Error('Authority Worker失联'));
    expect(shell.state).toMatchObject({ phase: 'menu', error: 'Authority Worker失联' });
    await shell.start('oak', 'medium');
    expect(shell.state).toMatchObject({ phase: 'playing', error: '' });
  });

  it('启动期间的运行时故障不会被迟到的成功结果复活', async () => {
    const game = port();
    let resolve!: () => void;
    game.start.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const shell = new ShellController(game);
    const starting = shell.start('oak', 'medium');
    shell.fail(new Error('Authority启动失联'));
    resolve();
    await starting;
    expect(shell.state).toMatchObject({ phase: 'menu', error: 'Authority启动失联' });
  });

  it('断线会使迟到的保存失败失效，取消连接会终止实际启动', async () => {
    const game = port();
    const shell = new ShellController(game);
    await shell.connectRemote('ws://127.0.0.1:8787/seedlands', 'key', 'medium');
    shell.pause();
    let reject!: (error: Error) => void;
    game.leave.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => (reject = fail)));
    const leaving = shell.leave();
    shell.fail(new Error('Node 已断开'));
    reject(new Error('旧保存失败'));
    await leaving;
    expect(shell.state).toMatchObject({ phase: 'menu', error: 'Node 已断开' });

    let resolve!: () => void;
    game.startRemote.mockImplementationOnce(() => new Promise<void>((done) => (resolve = done)));
    const connecting = shell.connectRemote('ws://127.0.0.1:8787/seedlands', 'key', 'medium');
    shell.cancelStart();
    expect(game.abortStart).toHaveBeenCalledOnce();
    resolve();
    await connecting;
    expect(shell.state.phase).toBe('menu');
  });
});
