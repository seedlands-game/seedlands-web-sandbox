<script lang="ts">
  import { publicAssetUrl } from '../../../client/public-asset-url';
  let { itemId }: { itemId: string | null } = $props();
</script>

{#if itemId}
  <img
    class="item-icon"
    src={publicAssetUrl(import.meta.env.BASE_URL, `assets/items/${itemId}.png`)}
    alt=""
    aria-hidden="true"
  />
{/if}
