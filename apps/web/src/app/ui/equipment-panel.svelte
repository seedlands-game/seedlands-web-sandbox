<script lang="ts">
  import { ARMOR_SLOTS, type ArmorSlot } from '@seedlands/stdlib/mod-api';
  import type { GameplayEquipmentPresentation } from './gameplay-ui-projector';
  import type { InventoryUiSlot } from './inventory-pointer-gestures';
  import InventorySlot from './primitives/inventory-slot.svelte';

  let {
    equipment,
    onpress,
    onenter,
    onactivate,
  }: {
    equipment: GameplayEquipmentPresentation;
    onpress: (event: PointerEvent, address: InventoryUiSlot) => void;
    onenter: (address: InventoryUiSlot) => void;
    onactivate: (address: InventoryUiSlot) => void;
  } = $props();

  const slotNames: Readonly<Record<ArmorSlot, string>> = {
    helmet: '头盔',
    chestplate: '胸甲',
    leggings: '护腿',
    boots: '靴子',
  };
</script>

<section class="equipment-panel" aria-label="装备槽位">
  <h3>装备</h3>
  <div class="equipment-grid" role="grid">
    {#each ARMOR_SLOTS as slot (slot)}
      <div class="equipment-row">
        <span>{slotNames[slot]}</span>
        <InventorySlot
          item={equipment[slot]}
          address={{ kind: 'equipment', slot }}
          label={`${slotNames[slot]}槽`}
          {onpress}
          {onenter}
          {onactivate}
        />
      </div>
    {/each}
  </div>
</section>

<style>
  .equipment-panel {
    padding: 0 16px 16px 0;
    border-right: 1px solid #83704b60;
  }
  h3 {
    margin: 0 0 10px;
    color: #e6d3ad;
    font-size: 13px;
  }
  .equipment-grid {
    display: grid;
    gap: 6px;
  }
  .equipment-row {
    display: grid;
    grid-template-columns: minmax(42px, 1fr) var(--classic-slot-size);
    align-items: center;
    gap: 8px;
    color: #bfc6b4;
    font-size: 11px;
  }
  @media (max-width: 720px) {
    .equipment-panel {
      padding: 0 0 14px;
      border-right: 0;
      border-bottom: 1px solid #83704b60;
    }
    .equipment-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .equipment-row {
      grid-template-columns: 1fr;
      text-align: center;
    }
  }
</style>
