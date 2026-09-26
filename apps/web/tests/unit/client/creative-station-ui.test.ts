import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import InventoryCrafting from '../../../src/app/ui/inventory-crafting.svelte';
import type { ShellState, UiActionPort } from '../../../src/app/ui/ui-contracts';

const empty = (slot: number) => ({ slot, itemId: null, count: 0, name: '空槽位', edible: false });
const emptyEquipment = () => ({
  helmet: { ...empty(0), slot: 'helmet' as const, name: '空头盔槽' },
  chestplate: { ...empty(0), slot: 'chestplate' as const, name: '空胸甲槽' },
  leggings: { ...empty(0), slot: 'leggings' as const, name: '空护腿槽' },
  boots: { ...empty(0), slot: 'boots' as const, name: '空靴子槽' },
});
const actions = {
  setFlight: vi.fn(),
  setActorMode: vi.fn(async () => undefined),
  closeInventory: vi.fn(async () => undefined),
  inventoryPointer: vi.fn(async () => true),
} as unknown as UiActionPort;

const gameplay = (station: ShellState['gameplay']['station']): ShellState['gameplay'] => ({
  station,
  inventoryOpen: true,
  inventoryIdentity: 'creative-player',
  cursor: null,
  lifecycle: 'alive',
  mode: 'creative',
  flightEnabled: true,
  equipment: emptyEquipment(),
  inventory: Array.from({ length: 24 }, (_, slot) => empty(slot)),
  creativeCatalog: [{ slot: 0, itemId: 'chest', count: 0, name: '箱子', edible: false }],
  selectedHotbarSlot: 0,
  craftableRecipeIds: [],
  recipes: [],
});

describe('creative station inventory route', () => {
  it('renders the authoritative station slots when a creative player opened a chest', () => {
    const { body } = render(InventoryCrafting, {
      props: {
        actions,
        gameplay: gameplay({
          id: 'station-1',
          revision: 0,
          kind: 'chest',
          name: '箱子',
          slots: Array.from({ length: 24 }, (_, slot) => empty(slot)),
          progress: 0,
          fuelSeconds: 0,
          recipes: [],
        }),
      },
    });
    expect(body).toContain('data-station-kind="chest"');
    expect(body).toContain('aria-label="箱子槽位"');
    expect(body).toContain('aria-label="装备槽位"');
    expect(body.match(/data-equipment-slot=/g)).toHaveLength(4);
  });

  it('keeps E inventory on the creative catalog when no station is selected', () => {
    const { body } = render(InventoryCrafting, { props: { actions, gameplay: gameplay(null) } });
    expect(body).toContain('创造内容目录');
    expect(body).not.toContain('data-station-kind=');
    expect(body).not.toContain('data-equipment-slot=');
  });
});
