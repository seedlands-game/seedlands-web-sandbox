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
  equipment: {
    helmet: {
      slot: 'helmet',
      itemId: 'iron-helmet',
      count: 1,
      name: '铁头盔',
      edible: false,
      stackLimit: 1,
      durability: { current: 41, max: 165 },
    },
    chestplate: { slot: 'chestplate', itemId: null, count: 0, name: '空胸甲槽', edible: false },
    leggings: { slot: 'leggings', itemId: null, count: 0, name: '空护腿槽', edible: false },
    boots: { slot: 'boots', itemId: null, count: 0, name: '空靴子槽', edible: false },
  },
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

  it('renders four typed equipment slots from committed item presentations', () => {
    const { body } = render(InventoryCrafting, { props: { actions, gameplay } });
    expect(body).toContain('aria-label="装备槽位"');
    expect(body.match(/data-equipment-slot=/g)).toHaveLength(4);
    expect(body).toContain('data-equipment-slot="helmet"');
    expect(body).toContain('data-equipment-slot="chestplate"');
    expect(body).toContain('data-equipment-slot="leggings"');
    expect(body).toContain('data-equipment-slot="boots"');
    expect(body.indexOf('data-equipment-slot="helmet"')).toBeLessThan(body.indexOf('data-equipment-slot="chestplate"'));
    expect(body.indexOf('data-equipment-slot="chestplate"')).toBeLessThan(
      body.indexOf('data-equipment-slot="leggings"'),
    );
    expect(body.indexOf('data-equipment-slot="leggings"')).toBeLessThan(body.indexOf('data-equipment-slot="boots"'));
    expect(body).toContain('铁头盔');
    expect(body).toContain('耐久 41/165');
    expect(body).toContain('空胸甲槽');
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
