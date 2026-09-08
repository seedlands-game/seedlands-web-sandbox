import { describe, expect, it } from 'vitest';
import { CommandHistory } from '../../apps/web/src/app/command-history';

describe('CommandHistory', () => {
  it('没有历史时保持当前草稿不变', () => {
    const history = new CommandHistory(20);

    expect(history.previous('/draft')).toBe('/draft');
    expect(history.next('/draft')).toBe('/draft');
  });

  it('在上下方向键浏览命令并在末尾恢复未执行草稿', () => {
    const history = new CommandHistory(20);
    history.record('/seed');
    history.record('/save');

    expect(history.previous('/draft-not-run')).toBe('/save');
    expect(history.previous()).toBe('/seed');
    expect(history.previous()).toBe('/seed');
    expect(history.next()).toBe('/save');
    expect(history.next()).toBe('/draft-not-run');
    expect(history.next()).toBe('/draft-not-run');
  });

  it('记录失败命令、保留重复项并把历史限制在最近二十条', () => {
    const history = new CommandHistory(20);
    for (let index = 0; index < 21; index += 1) {
      history.record(`/command-${index}`);
    }
    history.record('/unknown');
    history.record('/unknown');

    expect(history.entries()).toHaveLength(20);
    expect(history.previous('')).toBe('/unknown');
    expect(history.previous()).toBe('/unknown');

    for (let index = 0; index < 18; index += 1) history.previous();
    expect(history.previous()).toBe('/command-3');
  });

  it('新输入会结束历史浏览并成为下一次浏览要恢复的草稿', () => {
    const history = new CommandHistory(20);
    history.record('/seed');
    history.record('/save');

    expect(history.previous('draft')).toBe('/save');
    history.resetNavigation();
    expect(history.next('/edited-draft')).toBe('/edited-draft');
    expect(history.previous('/edited-draft')).toBe('/save');
    expect(history.next()).toBe('/edited-draft');
  });
});
