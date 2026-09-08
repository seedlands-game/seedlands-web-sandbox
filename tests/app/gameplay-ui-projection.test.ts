import { describe, expect, it } from 'vitest';
import { projectGameplayUi } from '../../apps/web/src/app/ui/gameplay-ui-projector';

const snapshot = () => ({
  revision: 7,
  player: {
    lifecycle: 'alive' as const,
    health: 12,
    hunger: 9,
    selectedHotbarSlot: 2,
    inventory: [
      { itemId: 'dirt-block', count: 5 },
      null,
      { itemId: 'wood-axe', count: 1 },
      ...Array.from({ length: 21 }, () => null),
    ],
  },
  inventoryOpen: true,
  craftableRecipeIds: ['planks'],
  target: { kind: 'voxel' as const, id: '0,33,-2', label: '原木' },
  breaking: { progress: 0.5, label: '原木' },
});

describe('gameplay retained UI projection', () => {
  it('partitions canonical state into HUD, interaction and shell snapshots', () => {
    const projected = projectGameplayUi(snapshot());

    expect(projected.hud).toMatchObject({
      health: { value: 12, max: 20 },
      hunger: { value: 9, max: 20 },
      selectedHotbarSlot: 2,
    });
    expect(projected.hud.hotbar).toHaveLength(8);
    expect(projected.interaction).toMatchObject({
      target: { kind: 'voxel', id: '0,33,-2', label: '原木' },
      breaking: { progress: 0.5, label: '原木' },
    });
    expect(projected.shell.gameplay).toMatchObject({
      inventoryOpen: true,
      lifecycle: 'alive',
      craftableRecipeIds: ['planks'],
      selectedHotbarSlot: 2,
    });
    expect(projected.shell.gameplay.inventory).toHaveLength(24);
    expect(projected.shell.gameplay.recipes).toEqual([
      expect.objectContaining({ id: 'planks', name: '木板', craftable: true }),
      expect.objectContaining({ id: 'wood-axe', name: '木斧', craftable: false }),
      expect.objectContaining({ id: 'stone-pickaxe', name: '石镐', craftable: false }),
      expect.objectContaining({ id: 'wood-sword', name: '木剑', craftable: false }),
      expect.objectContaining({ id: 'lantern', name: '灯笼', craftable: false }),
    ]);
  });

  it('does not expose mutable canonical inventory references', () => {
    const source = snapshot();
    const projected = projectGameplayUi(source);

    source.player.inventory[0] = { itemId: 'stone-block', count: 64 };
    expect(projected.hud.hotbar[0]).toMatchObject({ itemId: 'dirt-block', count: 5 });
    expect(projected.shell.gameplay.inventory[0]).toMatchObject({ itemId: 'dirt-block', count: 5 });
  });

  it('reuses unchanged retained partitions for channel coalescing', () => {
    const first = projectGameplayUi(snapshot());
    const second = projectGameplayUi(snapshot(), first);

    expect(second.hud).toBe(first.hud);
    expect(second.interaction).toBe(first.interaction);
    expect(second.shell).toBe(first.shell);
  });
});
