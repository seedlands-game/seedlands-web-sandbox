<script lang="ts">
  import { publicAssetUrl } from '../../../client/presentation/public-asset-url';
  let { itemId }: { itemId: string | null } = $props();
  const assetAliases: Record<string, string> = { 'glowstone-block': 'lantern' };
</script>

{#if itemId}
  <img
    class="item-icon"
    src={publicAssetUrl(import.meta.env.BASE_URL, `assets/items/${assetAliases[itemId] ?? itemId}.png`)}
    alt=""
    aria-hidden="true"
  />
{/if}
