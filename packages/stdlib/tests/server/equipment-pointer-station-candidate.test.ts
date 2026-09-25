import { describe, expect, it } from 'vitest';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { buildInventoryPointerCandidate } from '../../src/server/gameplay/modules/inventory-pointer-model';
import type { InventoryPointerActorProjectionV1 } from '../../src/server/gameplay/modules/inventory-pointer-contract';

const content = createGameplayContent({
  items: [
    {
      id: 'sample:visor',
      name: 'Visor',
      itemType: 'armor',
      stackLimit: 1,
      durability: { max: 40 },
      capabilities: [{ type: 'armor', slot: 'helmet', points: 2 }],
    },
  ],
  recipes: [],
  meleeDefinitions: [],
  stations: { definitions: [{ kind: 'workbench', voxel: 11 }], recipes: [], furnaceRecipes: [], fuels: [] },
});
const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const visor = (durability: number) => ({ itemId: 'sample:visor', count: 1, instance: { durability } });
const actor = (overrides: Partial<InventoryPointerActorProjectionV1> = {}): InventoryPointerActorProjectionV1 => ({
  version: 1,
  reference: { entityId: 'pilot', epoch: 1, lifetime: 1 },
  kind: 'player',
  slots: Array(12).fill(null),
  equipment: { selectedSlot: 0, hotbarSize: 4, armor: emptyArmor() },
  lifecycle: 'alive',
  inventoryRevision: 7,
  cursor: { version: 1, revision: 3, stack: null, origin: null, craftingGrid: [null, null, null, null] },
  ...overrides,
});
const candidate = (source: InventoryPointerActorProjectionV1, pointerCommand: unknown) => {
  const reference = { entityId: 'bench', epoch: 1, lifetime: 1 };
  const station = {
    version: 1 as const,
    reference,
    position: [0, 0, 0] as const,
    component: content.stations!.codec.create('bench', 'workbench'),
  };
  return buildInventoryPointerCandidate(content, {
    actor: source,
    station,
    input: {
      actor: source.reference,
      expectedInventoryRevision: source.inventoryRevision,
      station: { reference, expectedRevision: station.component.revision },
      command: pointerCommand,
    },
  });
};

describe('equipment pointer station candidates', () => {
  it('preserves equipment changes for the registered station host to commit atomically', () => {
    const holding = actor({
      cursor: {
        version: 1,
        revision: 3,
        stack: visor(37),
        origin: { kind: 'inventory', slot: 0 },
        craftingGrid: [null, null, null, null],
      },
    });
    const equipped = candidate(holding, {
      kind: 'click',
      slot: { kind: 'equipment', slot: 'helmet' },
      button: 0,
    });
    expect(equipped.equipment.armor.helmet).toEqual(visor(37));

    const wearing = actor({ equipment: { ...actor().equipment, armor: { ...emptyArmor(), helmet: visor(37) } } });
    const moved = candidate(wearing, { kind: 'quick-move', slot: { kind: 'equipment', slot: 'helmet' } });
    expect(moved.equipment.armor.helmet).toBeNull();
    expect(moved.slots[0]).toEqual(visor(37));

    const returning = actor({
      cursor: {
        version: 1,
        revision: 3,
        stack: visor(37),
        origin: { kind: 'equipment', slot: 'helmet' },
        craftingGrid: [null, null, null, null],
      },
    });
    const closed = candidate(returning, { kind: 'close' });
    expect(closed.equipment.armor.helmet).toEqual(visor(37));
    expect(closed.cursor.stack).toBeNull();
    expect(closed.dropIntents).toEqual([]);
  });
});
