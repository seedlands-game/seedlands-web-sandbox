import { describe, expect, it } from 'vitest';
import {
  InventoryPointerGestures,
  inventoryGestureContextIdentity,
  parseInventoryUiSlotAddress,
  type InventoryUiCommand,
} from '../../../src/app/ui/inventory-pointer-gestures';
import type { ArmorSlot } from '@seedlands/stdlib/mod-api';

const slot = (slot: number) => ({ kind: 'inventory' as const, slot });
const equipment = (slot: ArmorSlot) => ({ kind: 'equipment' as const, slot });
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

  it('装备槽支持点击、Shift 快速移动与数字键交换的精确地址', async () => {
    const click = fixture();
    click.gestures.begin({ slot: equipment('helmet'), button: 0, shift: false, time: 100 });
    click.gestures.end(slot(2), false);
    await click.gestures.settled();
    expect(click.commands).toEqual([
      { kind: 'click', slot: equipment('helmet'), button: 0 },
      { kind: 'click', slot: slot(2), button: 0 },
    ]);

    const right = fixture(true);
    right.gestures.begin({ slot: equipment('leggings'), button: 2, shift: false, time: 300 });
    right.gestures.end(equipment('leggings'), false);
    await right.gestures.settled();
    expect(right.commands).toEqual([{ kind: 'click', slot: equipment('leggings'), button: 2 }]);

    const shortcut = fixture();
    shortcut.gestures.begin({ slot: equipment('chestplate'), button: 2, shift: true, time: 500 });
    shortcut.gestures.command({ kind: 'hotbar', slot: equipment('boots'), hotbarSlot: 3 });
    await shortcut.gestures.settled();
    expect(shortcut.commands).toEqual([
      { kind: 'quick-move', slot: equipment('chestplate') },
      { kind: 'hotbar', slot: equipment('boots'), hotbarSlot: 3 },
    ]);
  });

  it('模式、actor 或 station 切换会改变手势上下文，但普通 revision 更新不会', () => {
    const current = { inventoryOpen: true, mode: 'survival', inventoryIdentity: 'actor-a', stationId: 'chest-a' };
    const identity = inventoryGestureContextIdentity(current);
    const withRevision = { ...current, revision: 99 };
    expect(inventoryGestureContextIdentity({ ...current })).toBe(identity);
    expect(inventoryGestureContextIdentity({ ...current, mode: 'creative' })).not.toBe(identity);
    expect(inventoryGestureContextIdentity({ ...current, inventoryIdentity: 'actor-b' })).not.toBe(identity);
    expect(inventoryGestureContextIdentity({ ...current, stationId: 'chest-b' })).not.toBe(identity);
    expect(inventoryGestureContextIdentity(withRevision)).toBe(identity);
  });

  it('只解析数值容器槽与公开的四种 equipment 地址', () => {
    expect(parseInventoryUiSlotAddress('inventory:7')).toEqual(slot(7));
    expect(
      ['helmet', 'chestplate', 'leggings', 'boots'].map((value) => parseInventoryUiSlotAddress(`equipment:${value}`)),
    ).toEqual([equipment('helmet'), equipment('chestplate'), equipment('leggings'), equipment('boots')]);
    expect(parseInventoryUiSlotAddress('equipment:0')).toBeNull();
    expect(parseInventoryUiSlotAddress('equipment:crown')).toBeNull();
    expect(parseInventoryUiSlotAddress('equipment:helmet:extra')).toBeNull();
  });

  it('装备槽失败后不创建后续拖拽手势', async () => {
    const commands: InventoryUiCommand[] = [];
    const gestures = new InventoryPointerGestures(
      () => false,
      async (command) => {
        commands.push(command);
        return false;
      },
      () => undefined,
    );
    gestures.begin({ slot: equipment('helmet'), button: 0, shift: false, time: 100 });
    gestures.end(slot(2), false);
    await gestures.settled();
    expect(commands).toEqual([{ kind: 'click', slot: equipment('helmet'), button: 0 }]);
  });

  it('不从装备槽发送 collect，也不把装备槽加入 distribute', async () => {
    const first = fixture();
    first.gestures.begin({ slot: equipment('helmet'), button: 0, shift: false, time: 100 });
    first.gestures.end(equipment('helmet'), false);
    first.gestures.begin({ slot: equipment('helmet'), button: 0, shift: false, time: 200 });
    first.gestures.end(equipment('helmet'), false);
    await first.gestures.settled();
    expect(first.commands).toEqual([
      { kind: 'click', slot: equipment('helmet'), button: 0 },
      { kind: 'click', slot: equipment('helmet'), button: 0 },
    ]);

    const drag = fixture(true);
    drag.gestures.begin({ slot: slot(0), button: 2, shift: false, time: 100 });
    drag.gestures.enter(equipment('chestplate'));
    drag.gestures.enter(slot(1));
    drag.gestures.end(slot(1), false);
    await drag.gestures.settled();
    expect(drag.commands).toEqual([{ kind: 'distribute', slots: [slot(0), slot(1)], button: 2 }]);
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
