import { describe, expect, it, vi } from 'vitest';
import { BrowserInventoryPointer } from '../../apps/web/src/app/gameplay/browser-inventory-pointer';
import type { AuthorityAction } from '../../packages/game-core/src/compute/authority-worker-protocol';

const actor = { entityId: 'player', epoch: 1, lifetime: 1 };
const inventory = (revision: number) => ({
  version: 1 as const,
  actor,
  revision,
  slots: [],
  hotbarSize: 8,
  cursor: { version: 1 as const, revision, stack: null, origin: null },
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
    const first = client.send({ kind: 'drop', button: 2 });
    const second = client.send({ kind: 'drop', button: 2 });
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(perform).toHaveBeenCalledTimes(1);
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
    const rejected = new BrowserInventoryPointer({
      view: () => ({ inventory: inventory(1) }),
      station: () => null,
      perform: deny,
      changed: vi.fn(),
      failed: vi.fn(),
      succeeded: vi.fn(),
    });
    expect(await rejected.send({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toBe(false);
    expect(deny).toHaveBeenCalledTimes(1);
    deny.mockClear();
    expect(await rejected.send({ kind: 'close' })).toBe(false);
    expect(deny).toHaveBeenCalledTimes(2);
  },
);
