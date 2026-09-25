import { describe, expect, it, vi } from 'vitest';
import { BrowserInventoryPointer } from '../../../src/app/gameplay/browser-inventory-pointer';
import type { AuthorityAction } from '../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';

const actor = { entityId: 'player', epoch: 1, lifetime: 1 };
const inventory = (revision: number) => ({
  version: 1 as const,
  actor,
  revision,
  slots: [],
  hotbarSize: 8,
  armor: { helmet: null, chestplate: null, leggings: null, boots: null },
  cursor: { version: 1 as const, revision, stack: null, origin: null },
});

it('装备动作在出队时读取最新 inventory/station revision 并保留原 actor 与 station identity', async () => {
  const station = {
    reference: { entityId: 'chest', epoch: 1, lifetime: 2 },
    position: [0, 0, 0] as const,
    component: { version: 1 as const, entityId: 'chest', revision: 4, kind: 'chest' as const, voxel: 12, slots: [] },
    craftableRecipeIds: [],
    matchedRecipeIds: [],
  };
  let view = { inventory: inventory(3) };
  let currentStation = station;
  const requests: AuthorityAction[] = [];
  const client = new BrowserInventoryPointer({
    view: () => view,
    station: () => currentStation,
    perform: async (action) => {
      requests.push(action);
      view = { inventory: inventory(view.inventory.revision + 1) };
      currentStation = { ...station, component: { ...station.component, revision: station.component.revision + 1 } };
      return { result: { success: true } };
    },
    changed: vi.fn(),
    failed: vi.fn(),
    succeeded: vi.fn(),
  });

  await Promise.all([
    client.send({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 }),
    client.send({ kind: 'quick-move', slot: { kind: 'equipment', slot: 'chestplate' } }),
  ]);

  expect(requests).toMatchObject([
    {
      actor,
      expectedInventoryRevision: 3,
      station: { reference: station.reference, expectedRevision: 4 },
      command: { kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 },
    },
    {
      actor,
      expectedInventoryRevision: 4,
      station: { reference: station.reference, expectedRevision: 5 },
      command: { kind: 'quick-move', slot: { kind: 'equipment', slot: 'chestplate' } },
    },
  ]);
});

it('不向 Authority 发送以 equipment 为 source/target 的非法 bulk command', async () => {
  const perform = vi.fn(async () => ({ result: { success: true } }));
  const failed = vi.fn();
  const changed = vi.fn();
  const client = new BrowserInventoryPointer({
    view: () => ({ inventory: inventory(1) }),
    station: () => null,
    perform,
    changed,
    failed,
    succeeded: vi.fn(),
  });

  expect(
    await client.send({
      kind: 'distribute',
      slots: [{ kind: 'equipment', slot: 'helmet' }],
      button: 0,
    } as unknown as Parameters<BrowserInventoryPointer['send']>[0]),
  ).toBe(false);
  expect(
    await client.send({
      kind: 'collect',
      slot: { kind: 'equipment', slot: 'helmet' },
    } as unknown as Parameters<BrowserInventoryPointer['send']>[0]),
  ).toBe(false);
  expect(perform).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(2);
});

it.each(['invalid-pointer-slot', 'destination-full', 'stale-inventory-revision'])(
  '装备失败 %s 只反馈并刷新，不发布本地 changed 状态',
  async (reason) => {
    const failed = vi.fn();
    const changed = vi.fn();
    const refresh = vi.fn();
    const client = new BrowserInventoryPointer({
      view: () => ({ inventory: inventory(7) }),
      station: () => null,
      perform: vi.fn(async () => ({ result: { success: false, reason } })),
      changed,
      refresh,
      failed,
      succeeded: vi.fn(),
    });

    expect(await client.send({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 })).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledOnce();
  },
);

it('关闭 equipment-origin cursor 不伪造 station context', async () => {
  const equipmentOrigin = {
    inventory: {
      ...inventory(4),
      cursor: {
        version: 1 as const,
        revision: 2,
        stack: { itemId: 'sample:visor', count: 1, instance: { durability: 9 } },
        origin: { kind: 'equipment' as const, slot: 'helmet' as const },
      },
    },
  };
  const perform = vi.fn(async () => ({ result: { success: true } }));
  const client = new BrowserInventoryPointer({
    view: () => equipmentOrigin,
    station: () => null,
    perform,
    changed: vi.fn(),
    failed: vi.fn(),
    succeeded: vi.fn(),
  });

  expect(await client.send({ kind: 'close' })).toBe(true);
  expect(perform).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedInventoryRevision: 4,
      command: { kind: 'close' },
    }),
  );
  expect(perform.mock.calls[0]![0]).not.toHaveProperty('station');
});

describe('浏览器库存意图串行与身份绑定', () => {
  it('连续请求在各自执行时读取新版本，不并发重用旧版本', async () => {
    let view = { inventory: inventory(1) };
    const requests: AuthorityAction[] = [];
    const client = new BrowserInventoryPointer({
      view: () => view,
      station: () => null,
      perform: async (action) => {
        requests.push(action);
        await Promise.resolve();
        view = { inventory: inventory(view.inventory.revision + 1) };
        return { result: { success: true } };
      },
      changed: vi.fn(),
      failed: vi.fn(),
      succeeded: vi.fn(),
    });
    await Promise.all([
      client.send({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 }),
      client.send({ kind: 'click', slot: { kind: 'inventory', slot: 1 }, button: 2 }),
    ]);
    expect(requests).toMatchObject([{ expectedInventoryRevision: 1 }, { expectedInventoryRevision: 2 }]);
  });

  it('前一个动作恢复新 Actor lifetime 后，排队的旧意图不能作用于新 Actor', async () => {
    let view = { inventory: inventory(1) };
    const perform = vi.fn(async () => {
      view = { inventory: { ...inventory(1), actor: { ...actor, lifetime: 2 } } };
      return { result: { success: true } };
    });
    const client = new BrowserInventoryPointer({
      view: () => view,
      station: () => null,
      perform,
      changed: vi.fn(),
      failed: vi.fn(),
      succeeded: vi.fn(),
    });
    const first = client.send({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 });
    const second = client.send({ kind: 'click', slot: { kind: 'equipment', slot: 'boots' }, button: 0 });
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('工位 identity 在排队期间切换时不发送旧 equipment 意图', async () => {
    const firstStation = {
      reference: { entityId: 'chest-a', epoch: 1, lifetime: 2 },
      position: [0, 0, 0] as const,
      component: {
        version: 1 as const,
        entityId: 'chest-a',
        revision: 1,
        kind: 'chest' as const,
        voxel: 12,
        slots: [],
      },
      craftableRecipeIds: [],
      matchedRecipeIds: [],
    };
    let station = firstStation;
    const perform = vi.fn(async () => {
      station = {
        ...firstStation,
        reference: { entityId: 'chest-b', epoch: 1, lifetime: 3 },
        component: { ...firstStation.component, entityId: 'chest-b' },
      };
      return { result: { success: true } };
    });
    const failed = vi.fn();
    const client = new BrowserInventoryPointer({
      view: () => ({ inventory: inventory(1) }),
      station: () => station,
      perform,
      changed: vi.fn(),
      failed,
      succeeded: vi.fn(),
    });

    const first = client.send({ kind: 'click', slot: { kind: 'equipment', slot: 'helmet' }, button: 0 });
    const second = client.send({ kind: 'quick-move', slot: { kind: 'equipment', slot: 'chestplate' } });
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith('工位已关闭或不可达，物品已保留');
  });

  it('通信拒绝走现有反馈且不毒化后续队列', async () => {
    const failed = vi.fn(),
      changed = vi.fn();
    const perform = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ result: { success: true } });
    const client = new BrowserInventoryPointer({
      view: () => ({ inventory: inventory(1) }),
      station: () => null,
      perform,
      changed,
      failed,
      succeeded: vi.fn(),
    });
    expect(await client.send({ kind: 'close' })).toBe(false);
    expect(await client.send({ kind: 'close' })).toBe(true);
    expect(failed).toHaveBeenCalledWith('offline');
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

it('关闭优先用仍可访问的原工位，恢复后没有UI选择也可归原格', async () => {
  const station = {
    reference: { entityId: 'chest', epoch: 1, lifetime: 1 },
    position: [0, 0, 0] as const,
    component: { version: 1 as const, entityId: 'chest', revision: 2, kind: 'chest' as const, voxel: 12, slots: [] },
    craftableRecipeIds: [],
    matchedRecipeIds: [],
  };
  const view = {
    inventory: {
      ...inventory(3),
      cursor: {
        version: 1 as const,
        revision: 1,
        stack: { itemId: 'plank', count: 5 },
        origin: { kind: 'station' as const, reference: station.reference, slot: 0 },
      },
    },
    nearbyStations: [station],
  };
  const perform = vi.fn(async () => ({ result: { success: true } }));
  const client = new BrowserInventoryPointer({
    view: () => view,
    station: () => null,
    perform,
    changed: vi.fn(),
    failed: vi.fn(),
    succeeded: vi.fn(),
  });
  expect(await client.send({ kind: 'close' })).toBe(true);
  expect(perform).toHaveBeenCalledWith(
    expect.objectContaining({ station: { reference: station.reference, expectedRevision: 2 } }),
  );
});

it.each(['stale-inventory-revision', 'stale-station-reference'])(
  '仅关闭在 %s 后以新版本最多重试一次',
  async (reason) => {
    let revision = 1;
    const requests: AuthorityAction[] = [];
    const perform = vi.fn(async (action: AuthorityAction) => {
      requests.push(action);
      revision += 1;
      return requests.length === 1 ? { result: { success: false, reason } } : { result: { success: true } };
    });
    const client = new BrowserInventoryPointer({
      view: () => ({ inventory: inventory(revision) }),
      station: () => null,
      perform,
      changed: vi.fn(),
      failed: vi.fn(),
      succeeded: vi.fn(),
    });
    expect(await client.send({ kind: 'close' })).toBe(true);
    expect(requests).toMatchObject([{ expectedInventoryRevision: 1 }, { expectedInventoryRevision: 2 }]);
    const deny = vi.fn(async () => ({ result: { success: false, reason } }));
    const failed = vi.fn();
    const changed = vi.fn();
    const rejected = new BrowserInventoryPointer({
      view: () => ({ inventory: inventory(1) }),
      station: () => null,
      perform: deny,
      changed,
      failed,
      succeeded: vi.fn(),
    });
    expect(await rejected.send({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toBe(false);
    expect(deny).toHaveBeenCalledTimes(1);
    deny.mockClear();
    failed.mockClear();
    expect(await rejected.send({ kind: 'close' })).toBe(false);
    expect(deny).toHaveBeenCalledTimes(2);
    expect(changed).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
  },
);
