<script lang="ts">
  import { publicAssetUrl } from '../../client/public-asset-url';
  import type { InteractionState } from './ui-contracts';
  import ItemIcon from './primitives/item-icon.svelte';
  let { interaction }: { interaction: InteractionState } = $props();
  const voxelIcons: Record<number, string> = { 1: 'grass', 5: 'leaves', 7: 'snow' };
  const items: Record<number, string> = {
    1: 'dirt-block',
    2: 'dirt-block',
    3: 'stone-block',
    4: 'wood-block',
    5: 'berry',
    6: 'sand-block',
    7: 'stone-block',
    9: 'lantern',
  };
</script>

{#if interaction.target}
  <div
    id="target-card"
    class="game-panel"
    data-target={interaction.target.id}
    data-voxel={interaction.target.voxel}
    aria-label={`目标方块 ${interaction.target.label}`}
  >
    {#if voxelIcons[interaction.target.voxel ?? 0]}
      <img
        class="item-icon"
        src={publicAssetUrl(import.meta.env.BASE_URL, `assets/voxels/${voxelIcons[interaction.target.voxel ?? 0]}.png`)}
        alt=""
      />
    {:else}
      <ItemIcon itemId={items[interaction.target.voxel ?? 0] ?? null} />
    {/if}
    <div class="target-details">
      <strong>{interaction.target.label}</strong>
      {#if interaction.breaking}
        <progress id="break-progress" aria-label="采集进度" max="1" value={interaction.breaking.progress}></progress>
      {:else}<small>Seedlands</small>{/if}
    </div>
    <img class="target-crest" src={publicAssetUrl(import.meta.env.BASE_URL, 'assets/ui/arcane-crest.png')} alt="" />
  </div>
{/if}
