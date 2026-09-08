<script lang="ts">
  import { itemIconUrl } from '../../gameplay/asset-image';
  let { itemId }: { itemId: string | null } = $props();
</script>

{#if itemId}
  <img class="item-icon" src={itemIconUrl(itemId, import.meta.env.BASE_URL)} alt="" aria-hidden="true" />
{/if}
