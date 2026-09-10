import { describe, expect, it } from 'vitest';
import {
  InventoryPointerGestures,
  type InventoryUiCommand,
} from '../../apps/web/src/app/ui/inventory-pointer-gestures';

const slot = (slot: number) => ({ kind: 'inventory' as const, slot });
function fixture(initiallyHeld = false) {
  let held = initiallyHeld;
  const commands: InventoryUiCommand[] = [];
  const gestures = new InventoryPointerGestures(
    () => held,
    async (command) => {
      commands.push(command);
      if (command.kind === 'click') held = true;
      return true;
    },
    () => undefined,
  );
  return { gestures, commands };
}

describe('库存指针输入顺序', () => {
  it('快速按下移动松开仍先确认拿起，再投递落点，不把拖起误认为均分', async () => {
    const { gestures, commands } = fixture();
    gestures.begin({ slot: slot(0), button: 0, shift: false, time: 100 });
    gestures.enter(slot(8));
    gestures.end(slot(8), false);
    await gestures.settled();
    expect(commands).toEqual([
      { kind: 'click', slot: slot(0), button: 0 },
      { kind: 'click', slot: slot(8), button: 0 },
    ]);
  });
  it('已有持物的右拖批量去重，回经过不多放', async () => {
    const { gestures, commands } = fixture(true);
    gestures.begin({ slot: slot(8), button: 2, shift: false, time: 100 });
    gestures.enter(slot(9));
    gestures.enter(slot(8));
    gestures.enter(slot(10));
    gestures.end(slot(10), false);
    await gestures.settled();
    expect(commands).toEqual([{ kind: 'distribute', slots: [slot(8), slot(9), slot(10)], button: 2 }]);
  });
  it('取消尚未提交的拖拽不产生放置或丢弃', async () => {
    const { gestures, commands } = fixture(true);
    gestures.begin({ slot: slot(8), button: 0, shift: false, time: 100 });
    await gestures.settled();
    gestures.enter(slot(9));
    gestures.cancel();
    gestures.end(null, true);
    await gestures.settled();
    expect(commands).toEqual([]);
  });
  it('双击第二次按压收集，松开不又把持物放回', async () => {
    const { gestures, commands } = fixture();
    gestures.begin({ slot: slot(0), button: 0, shift: false, time: 100 });
    gestures.end(slot(0), false);
    gestures.begin({ slot: slot(0), button: 0, shift: false, time: 200 });
    gestures.end(slot(0), false);
    await gestures.settled();
    expect(commands).toEqual([
      { kind: 'click', slot: slot(0), button: 0 },
      { kind: 'collect', slot: slot(0) },
    ]);
  });
});

it('拿起请求在途时失焦，响应到达也不恢复旧拖拽或窗口外丢弃', async () => {
  let held = false;
  let acknowledge = () => {};
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const commands: InventoryUiCommand[] = [];
  const gestures = new InventoryPointerGestures(
    () => held,
    async (command) => {
      commands.push(command);
      await pending;
      held = true;
      return true;
    },
    () => undefined,
  );
  gestures.begin({ slot: slot(0), button: 0, shift: false, time: 100 });
  await Promise.resolve();
  gestures.cancel();
  acknowledge();
  await gestures.settled();
  gestures.end(null, true);
  await gestures.settled();
  expect(held).toBe(true);
  expect(commands).toEqual([{ kind: 'click', slot: slot(0), button: 0 }]);
});
