import { expect, it, vi } from 'vitest';
import { useGameplayHeldItem, useNavigationHeldItem } from '../../../src/app/gameplay/held-item-interaction';
import { ready } from '../client/fixtures/browser-authority';

function input() {
  const gameplay = ready().gameplay;
  const perform = vi.fn().mockResolvedValue({ result: { success: true } });
  return {
    gameplay,
    perform,
    refresh: vi.fn(),
    succeeded: vi.fn(),
    failed: vi.fn(),
    isEdible: vi.fn(() => true),
    consume: vi.fn(),
  };
}

it('the accepted map consumes a real self action with all four selection revisions in Creative', async () => {
  const value = input();
  value.gameplay = {
    ...value.gameplay,
    player: {
      ...value.gameplay.player,
      mode: { version: 1, value: 'creative', revision: 7 },
      creativeCatalog: { version: 1, selectedSlot: 3, revision: 9, hotbar: [null, null, null, 'custom-map'] },
    },
    navigation: { itemId: 'custom-map', slot: 3, kind: 'map', revision: 0, map: null },
  };
  expect(useGameplayHeldItem(value)).toBe(true);
  await vi.waitFor(() => expect(value.succeeded).toHaveBeenCalledOnce());
  expect(value.perform).toHaveBeenCalledExactlyOnceWith({
    type: 'interact',
    intent: 'use',
    target: { kind: 'self' },
    expectedSelection: {
      inventoryRevision: value.gameplay.inventory.revision,
      modeRevision: 7,
      creativeCatalogRevision: 9,
      selectedSlot: 3,
    },
  });
  expect(value.refresh).toHaveBeenCalledOnce();
  expect(value.consume).not.toHaveBeenCalled();
});

it('a rejected or thrown map action reports failure without queuing a save or consuming inventory', async () => {
  for (const failure of [{ result: { success: false, reason: 'interaction-stale' } }, new Error('offline')]) {
    const value = input();
    value.gameplay = { ...value.gameplay, navigation: { itemId: 'map', slot: 0, kind: 'map', revision: 0, map: null } };
    value.perform.mockImplementation(() => {
      if (failure instanceof Error) throw failure;
      return Promise.resolve(failure);
    });
    expect(useNavigationHeldItem(value)).toBe(true);
    await vi.waitFor(() => expect(value.failed).toHaveBeenCalledOnce());
    expect(value.succeeded).not.toHaveBeenCalled();
    expect(value.refresh).not.toHaveBeenCalled();
    expect(value.consume).not.toHaveBeenCalled();
  }
});

it('clock and compass remain read-only and normal Survival food still uses its existing consumer', () => {
  const value = input();
  for (const navigation of [
    { itemId: 'clock', slot: 0, kind: 'clock' as const, worldTime: 6, phase: 0.25 },
    { itemId: 'compass', slot: 0, kind: 'compass' as const, target: [1, 2, 3] as const, turns: 0.5 },
  ]) {
    value.gameplay = { ...value.gameplay, navigation };
    expect(useGameplayHeldItem(value)).toBe(true);
  }
  expect(value.perform).not.toHaveBeenCalled();
  expect(value.consume).not.toHaveBeenCalled();
  value.gameplay = {
    ...value.gameplay,
    navigation: null,
    player: { ...value.gameplay.player, inventory: [{ itemId: 'berry', count: 1 }], selectedSlot: 0 },
  };
  expect(useGameplayHeldItem(value)).toBe(true);
  expect(value.consume).toHaveBeenCalledExactlyOnceWith(0);
  value.gameplay = {
    ...value.gameplay,
    player: { ...value.gameplay.player, mode: { version: 1, value: 'creative', revision: 1 } },
  };
  expect(useGameplayHeldItem(value)).toBe(false);
});
