import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import InventoryCrafting from '../../../src/app/ui/inventory-crafting.svelte';
import type { ShellState, UiActionPort } from '../../../src/app/ui/ui-contracts';

const empty = (slot: number) => ({ slot, itemId: null, count: 0, name: '空槽位', edible: false });
const actions = {
  setFlight: vi.fn(),
  setActorMode: vi.fn(async () => undefined),
  closeInventory: vi.fn(async () => undefined),
  inventoryPointer: vi.fn(async () => true),
} as unknown as UiActionPort;

const gameplay: ShellState['gameplay'] = {
  station: null,
  inventoryOpen: true,
  inventoryIdentity: 'survival-player',
  cursor: null,
  personalCrafting: {
    slots: Array.from({ length: 4 }, (_, slot) => empty(slot)),
    recipes: [
      {
        id: 'planks',
        name: '木板 × 4',
        pattern: [{ ...empty(0), itemId: 'wood-block', count: 1, name: '原木' }],
        output: { ...empty(0), itemId: 'plank', count: 4, name: '木板' },
        requirements: '原木 × 1',
        matchesGrid: false,
      },
    ],
  },
  lifecycle: 'alive',
  mode: 'survival',
  flightEnabled: false,
  inventory: Array.from({ length: 36 }, (_, slot) => empty(slot)),
  creativeCatalog: [],
  selectedHotbarSlot: 0,
  hotbarSize: 9,
  craftableRecipeIds: [],
  recipes: [],
};

describe('personal crafting inventory UI', () => {
  it('renders four addressable 2x2 slots and one authority-backed result slot', () => {
    const { body } = render(InventoryCrafting, { props: { actions, gameplay } });
    expect(body.match(/data-crafting-slot=/g)).toHaveLength(4);
    expect(body).toContain('aria-label="随身合成槽位"');
    expect(body).toContain('data-personal-craft-result');
    expect(body).toContain('1 个 2×2 配方');
    expect(body).not.toContain('快捷合成');
  });

  it('constrains inventory images to the slot content box', () => {
    const source = readFileSync('apps/web/src/app/ui/primitives/inventory-slot.svelte', 'utf8');
    const bounded = 'calc(100% - var(--classic-slot-icon-inset) - var(--classic-slot-icon-inset))';
    expect(source).toContain('overflow: hidden');
    expect(source).toContain(`width: ${bounded}`);
    expect(source).toContain(`height: ${bounded}`);
    expect(source).toContain(`max-width: ${bounded}`);
    expect(source).toContain(`max-height: ${bounded}`);
    expect(source).toContain('object-fit: contain');
  });
});
